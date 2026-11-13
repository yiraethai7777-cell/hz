'use strict';

// In-memory receiver for CURRENT voice-room invitation coordinates.
// This is only the endpoint-discovery part of a standalone VOX joiner.
// It does not authenticate, send VOX packets, join, or retain media data.
const { isIP } = require('node:net');
const { attachmentObject } = require('./voice-room-observer');

// A live VOX room can last up to 48 hours, not five minutes.
const TTL_MS = 48 * 60 * 60 * 1000;
const LIVE_REPLAY_MAX_AGE_MS = 5 * 60 * 1000;
const HISTORY_REQUEST_COOLDOWN_MS = 60 * 1000;
const MAX_HISTORY_MESSAGES = 100;
const historyRequests = new Map();
const MAX_ROOMS = 128;
const MAX_I64 = 9223372036854775807n;
const roomEvents = new Map();

function positiveId(value) {
  if (typeof value !== 'string' && !Number.isSafeInteger(value)) return '';
  const input = String(value);
  if (!/^[1-9]\d{0,19}$/.test(input)) return '';
  const number = BigInt(input);
  return number <= MAX_I64 ? input : '';
}
function portNumber(value) {
  const number = typeof value === 'string' && /^\d{1,5}$/.test(value)
    ? Number(value) : value;
  return Number.isSafeInteger(number) && number >= 1 && number <= 65535
    ? number : 0;
}
function messageTime(msg, now, maxAge=LIVE_REPLAY_MAX_AGE_MS) {
  const value = msg?.raw?.chatLog?.sendAt ?? msg?.raw?.chatLog?.s;
  if (value == null) return now;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ts = n < 1e12 ? n * 1000 : n;
  return ts > now + 60000 || now - ts > maxAge ? null : ts;
}
function prune(now) {
  for (const [id, record] of roomEvents) {
    if (now - record.at > TTL_MS) roomEvents.delete(id);
  }
  while (roomEvents.size > MAX_ROOMS) {
    roomEvents.delete(roomEvents.keys().next().value);
  }
}
function observe(msg, now = Date.now(), {fromHistory=false}={}) {
  if (msg?.room?.isOpenChat !== true ||
      Number(msg?.message?.type ?? msg?.type) !== 52) return false;
  const roomId = positiveId(msg?.room?.id);
  const logId = positiveId(msg?.message?.logId ?? msg?.raw?.chatLog?.logId ?? msg?.logId);
  const sendAt = messageTime(msg, now,
    fromHistory?TTL_MS:LIVE_REPLAY_MAX_AGE_MS);
  if(fromHistory && !(
    msg?.raw?.chatLog?.sendAt!=null || msg?.raw?.chatLog?.s!=null
  ))return false;
  if (!roomId || !logId || sendAt == null) return false;
  const attachment = attachmentObject(msg);
  if (!attachment || !['vr_invite', 'vr_bye'].includes(attachment.type)) return false;
  prune(now);
  const old = roomEvents.get(roomId);
  if (old && BigInt(logId) <= BigInt(old.logId)) return false;
  if (attachment.type === 'vr_bye') {
    // Tombstone prevents an older replayed invite from looking active.
    roomEvents.delete(roomId);
    roomEvents.set(roomId, { at: sendAt, logId, phase: 'ended', endpoint: null });
    return true;
  }

  const callId = positiveId(attachment.callId);
  const ipv4 = typeof attachment.csIP === 'string' && isIP(attachment.csIP) === 4
    ? attachment.csIP : '';
  const ipv6 = typeof attachment.csIP6 === 'string' && isIP(attachment.csIP6) === 6
    ? attachment.csIP6 : '';
  const port = portNumber(attachment.csPort);
  const endpoint = callId && (ipv4 || ipv6) && port
    ? { roomId, callId, hostV4: ipv4, hostV6: ipv6, port } : null;
  roomEvents.delete(roomId);
  roomEvents.set(roomId, { at: sendAt, logId, phase: 'invite', endpoint });
  prune(now);
  return true;
}
function status(roomId, now = Date.now()) {
  prune(now);
  const record = roomEvents.get(positiveId(roomId));
  return {
    phase: record?.phase ?? 'unknown',
    endpointReady: Boolean(record?.endpoint),
    verifiedJoined: false,
    protocolReady: false,
  };
}
// Internal-only coordinates for a FUTURE authenticated transport implementation.
// Never display this object in chats or log it; callId/server IP are sensitive.
function resolve(roomId, now = Date.now()) {
  prune(now);
  const record = roomEvents.get(positiveId(roomId));
  return record?.phase === 'invite' && record.endpoint ? { ...record.endpoint } : null;
}

// On-demand, read-only LOCO history recovery. It never forwards history
// messages to the chat router and never logs or persists call coordinates.
// The SYNCMSG response is not guaranteed to contain past logs on all servers.
async function recover(client, roomId, now=Date.now()) {
  const id=positiveId(roomId);
  if(!id)return {recovered:false,reason:'invalid-room'};
  prune(now);
  if(roomEvents.get(id)?.phase==='ended')
    return {recovered:false,reason:'ended'};
  if(resolve(id,now))return {recovered:true,reason:'cached'};
  if(client?.connected!==true || typeof client?._carriage?.syncMsg!=='function')
    return {recovered:false,reason:'history-unavailable'};
  const previous=historyRequests.get(id);
  if(previous && now-previous.at<HISTORY_REQUEST_COOLDOWN_MS){
    if(previous.pending)return previous.pending;
    return {recovered:!!resolve(id,now),reason:'recently-checked'};
  }
  const pending=(async()=>{
    try{
      // Query only this joined room. Never emit messages or modify cursors:
      // that could trigger commands or expose historical user content.
      const reply=await client._carriage.syncMsg({
        chatId:id,cur:0,max:0,cnt:MAX_HISTORY_MESSAGES,
      });
      const body=reply?.body??reply;
      const logs=Array.isArray(body?.chatLogs)?body.chatLogs:
        Array.isArray(body?.logs)?body.logs:
        Array.isArray(body?.messages)?body.messages:[];
      const ordered=logs.slice(0,MAX_HISTORY_MESSAGES).filter(log=>
        log&&typeof log==='object'&&!Array.isArray(log) &&
        positiveId(log.logId??log.msgId??log.id)
      ).sort((a,b)=>{
        const x=BigInt(positiveId(a.logId??a.msgId??a.id));
        const y=BigInt(positiveId(b.logId??b.msgId??b.id));
        return x<y?-1:x>y?1:0;
      });
      let observed=0;
      for(const log of ordered){
        const msg={
          room:{id,isOpenChat:true},
          message:{type:Number(log.type??log.msgType??log.t??0),
            logId:positiveId(log.logId??log.msgId??log.id)},
          raw:{chatLog:log},
        };
        if(observe(msg,now,{fromHistory:true}))observed++;
      }
      // Even a non-empty history batch might not contain the current
      // voice-room start, so report no match rather than inventing access.
      console.info('[VOICE JOIN] bounded history recovery '+
        JSON.stringify({logsExamined:ordered.length,lifecycleEvents:observed,
          endpointReady:!!resolve(id,now)}));
      return {recovered:!!resolve(id,now),
        reason:resolve(id,now)?'history':'no-current-invite'};
    }catch{
      console.warn('[VOICE JOIN] bounded history lookup failed');
      return {recovered:false,reason:'history-unavailable'};
    }
  })();
  historyRequests.set(id,{at:now,pending});
  const result=await pending;
  historyRequests.set(id,{at:now,pending:null});
  if(historyRequests.size>MAX_ROOMS){
    historyRequests.delete(historyRequests.keys().next().value);
  }
  return result;
}

const installed = new WeakSet();
function install(client) {
  if (!client || typeof client.on !== 'function') return false;
  if (installed.has(client)) return true;
  installed.add(client);
  client.on('message', (...args) => {
    try {
      observe(args.length === 1 ? args[0] : args[1]);
    } catch {
      // Never log messages, raw attachments, call IDs, or VOX endpoints.
      console.warn('[VOICE JOIN] received an unusable VOX invitation');
    }
  });
  return true;
}
module.exports = { observe, status, resolve, recover, install, positiveId, portNumber, TTL_MS };
