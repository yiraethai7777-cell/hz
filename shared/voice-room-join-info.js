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
function trustedHistoryId(value) {
  if(typeof value==='string'||Number.isSafeInteger(value))
    return positiveId(value);
  if(value && typeof value==='object' &&
     typeof value.toString==='function'){
    try{return positiveId(value.toString());}catch{return '';}
  }
  return '';
}
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
async function recover(client, roomId, now=Date.now(), {maxLogId}={}) {
  const id=positiveId(roomId);
  if(!id)return {recovered:false,reason:'invalid-room'};
  prune(now);
  if(roomEvents.get(id)?.phase==='ended')
    return {recovered:false,reason:'ended'};
  if(resolve(id,now))return {recovered:true,reason:'cached'};
  if(client?.connected!==true || typeof client?._carriage?.syncMsg!=='function')
    return {recovered:false,reason:'history-unavailable'};
  // LOCO SYNCMSG history uses a known latest logId as its upper bound.
  // The invoking #보룸참가 event supplies an exact server-issued logId.
  // A request with max=0 may legitimately return no history.
  const hint=trustedHistoryId(maxLogId)||
    trustedHistoryId(client?._chatRooms?.get?.(id)?.lastChatLogId)||
    trustedHistoryId(client?._chatRooms?.get?.(id)?.lastLogId)||'';
  const previous=historyRequests.get(id);
  if(previous && now-previous.at<HISTORY_REQUEST_COOLDOWN_MS){
    if(previous.pending)return previous.pending;
    // A newer message anchor can unlock history that was empty earlier.
    const newer=hint && (!previous.maxLogId ||
      BigInt(hint)>BigInt(previous.maxLogId));
    if(!newer)return {recovered:!!resolve(id,now),reason:'recently-checked'};
  }
  const pending=(async()=>{
    const MAX_HISTORY_PAGES=3;
    let cursor='0',total=0,lifecycleEvents=0,pages=0;
    let upper=hint||'0',reason='history-empty';
    try{
      while(pages<MAX_HISTORY_PAGES && total<MAX_HISTORY_MESSAGES*MAX_HISTORY_PAGES){
        // Read only, never emit returned chat logs to event handlers.
        const reply=await client._carriage.syncMsg({
          chatId:id,cur:cursor==='0'?0:cursor,
          max:upper==='0'?0:upper,cnt:MAX_HISTORY_MESSAGES,
        });
        if(reply?.status!==undefined && Number(reply.status)!==0)
          return {recovered:false,reason:'history-unavailable'};
        const body=reply?.body??reply;
        const logs=Array.isArray(body?.chatLogs)?body.chatLogs:
          Array.isArray(body?.logs)?body.logs:
          Array.isArray(body?.messages)?body.messages:[];
        const valid=logs.slice(0,MAX_HISTORY_MESSAGES).filter(log=>
          log&&typeof log==='object'&&!Array.isArray(log) &&
          trustedHistoryId(log.logId??log.msgId??log.id)
        );
        const ordered=valid.sort((a,b)=>{
          const x=BigInt(trustedHistoryId(a.logId??a.msgId??a.id));
          const y=BigInt(trustedHistoryId(b.logId??b.msgId??b.id));
          return x<y?-1:x>y?1:0;
        });
        pages++;total+=ordered.length;
        for(const log of ordered){
          const msg={
            room:{id,isOpenChat:true},
            message:{type:Number(log.type??log.msgType??log.t??0),
              logId:trustedHistoryId(log.logId??log.msgId??log.id)},
            raw:{chatLog:log},
          };
          if(observe(msg,now,{fromHistory:true}))lifecycleEvents++;
        }
        if(resolve(id,now) || roomEvents.get(id)?.phase==='ended')break;
        if(ordered.length)reason='no-current-invite';
        // The response may include unrelated messages. Avoid unbounded
        // reverse scans and only advance if the server returned a full page.
        if(ordered.length<MAX_HISTORY_MESSAGES)break;
        const first=trustedHistoryId(ordered[0].logId??
          ordered[0].msgId??ordered[0].id);
        if(!first||first===cursor)break;
        cursor=first;
      }
      const recovered=!!resolve(id,now);
      if(recovered)reason='history';
      else if(roomEvents.get(id)?.phase==='ended')reason='ended';
      console.info('[VOICE JOIN] bounded history recovery '+
        JSON.stringify({logsExamined:total,pages,anchorPresent:!!hint,
          lifecycleEvents,endpointReady:recovered,reason}));
      return {recovered,reason};
    }catch{
      console.warn('[VOICE JOIN] bounded history lookup failed');
      return {recovered:false,reason:'history-unavailable'};
    }
  })();
  historyRequests.set(id,{at:now,maxLogId:hint,pending});
  const result=await pending;
  historyRequests.set(id,{at:now,maxLogId:hint,pending:null});
  if(historyRequests.size>MAX_ROOMS){
    historyRequests.delete(historyRequests.keys().next().value);
  }
  return result;
}


// Read-only LOCO CHATINFO fallback: Android shared chat-meta 16 describes
// VoiceRoom state, but its exact JSON content is version-dependent.
// Only a CURRENT liveon=true meta carrying complete, valid coordinates
// is eligible. The contents never enter logs or chat responses.
async function inspectServerVoiceMeta(client,roomId){
  const id=positiveId(roomId);
  if(!id)return {ready:false,reason:'invalid-room'};
  if(client?.connected!==true||typeof client?._carriage?.chatInfo!=='function')
    return {ready:false,reason:'chatinfo-unavailable'};
  try{
    const res=await client._carriage.chatInfo(id);
    if(res?.status!==undefined && Number(res.status)!==0)
      return {ready:false,reason:'chatinfo-rejected'};
    const body=res?.body??res;
    const roomInfo=body?.chatInfo??body?.chatData??body;
    const replyId=trustedHistoryId(roomInfo?.chatId??roomInfo?.id??body?.chatId);
    if(replyId&&replyId!==id)return {ready:false,reason:'room-mismatch'};
    const metas=Array.isArray(roomInfo?.chatMetas)?roomInfo.chatMetas:
      Array.isArray(body?.chatMetas)?body.chatMetas:[];
    const voice=metas.find(m=>{
      try{return Number(m?.type?.valueOf?.()??m?.type)===16;}catch{return false;}
    });
    if(!voice) {
      console.info('[VOICE JOIN] CHATINFO metadata '+JSON.stringify({
        voiceroomMetaSeen:false,endpointReady:false}));
      return {ready:false,reason:'no-voice-meta'};
    }
    let content=voice.content;
    if(typeof content==='string'){
      if(content.length>8192||!content.trim().startsWith('{'))
        return {ready:false,reason:'unsupported-voice-meta'};
      try{content=JSON.parse(content);}
      catch{return {ready:false,reason:'unsupported-voice-meta'};}
    }
    if(!content||typeof content!=='object'||Array.isArray(content))
      return {ready:false,reason:'unsupported-voice-meta'};
    const live=content.liveon===true || content.liveon===1;
    if(!live)return {ready:false,reason:'not-live'};
    const callId=positiveId(content.callId);
    const hostV4=typeof content.csIP==='string'&&isIP(content.csIP)===4?
      content.csIP:'';
    const hostV6=typeof content.csIP6==='string'&&isIP(content.csIP6)===6?
      content.csIP6:'';
    const port=portNumber(content.csPort);
    const completeEndpoint=!!(hostV4&&port);
    const ready=!!callId;
    console.info('[VOICE JOIN] CHATINFO voiceroom metadata '+
      JSON.stringify({voiceroomMetaSeen:true,live:true,
        callIdPresent:!!callId,endpointReady:completeEndpoint}));
    if(!ready)return {ready:false,reason:'incomplete-voice-meta'};
    // When chat metadata has a server-authenticated callId but no socket
    // coordinates, VOX 30000 provides the actual destination in join().
    return {ready:true,reason:completeEndpoint?'current-voice-meta':'meta-call-id-only',
      invitation:{roomId:id,callId,hostV4,hostV6,port,
        source:'authenticated-chatinfo'}};
  }catch{
    console.info('[VOICE JOIN] CHATINFO voice metadata unavailable');
    return {ready:false,reason:'chatinfo-unavailable'};
  }
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
module.exports = { observe, status, resolve, recover, inspectServerVoiceMeta, install, positiveId, portNumber, TTL_MS };
