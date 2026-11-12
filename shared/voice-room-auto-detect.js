'use strict';

// Event-driven VoiceRoom lifecycle notices for rooms with management ON.
// Only observes already received Kakao chat type-52 messages. No packet sends,
// media connections, secret collection, or server-active-state assertions.
const { lifecycleMetadata, attachmentObject } = require('./voice-room-observer');

const SEEN_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SEEN = 2048;
const MAX_ROOMS = 256;
const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000;
const seen = new Map();
const lastEvents = new Map();
const installed = new WeakSet();
const pendingOpens = new Map();
const OPEN_EVENT_TIMEOUT_MS = 8000;

// These call IDs are kept only briefly in process memory, never logged
// or written to the persistent notification record.
const recentCalls = new Map();
const CALL_TRACK_TTL_MS = 2 * 60 * 1000;
const MAX_RECENT_CALLS = 128;
function callKey(value) {
  const str = value == null ? '' : String(value);
  return /^[1-9]\d{0,18}$/.test(str) &&
    BigInt(str) <= 9223372036854775807n ? str : '';
}
function pruneCalls(now=Date.now()) {
  for (const [room,state] of recentCalls)
    if (state.expiresAt <= now) recentCalls.delete(room);
  while (recentCalls.size > MAX_RECENT_CALLS)
    recentCalls.delete(recentCalls.keys().next().value);
}
function callCorrelation(roomId,callId) {
  pruneCalls();
  const state=recentCalls.get(validId(roomId));
  const id=callKey(callId);
  const same=!!(id && state && state.callId===id);
  return {inviteMatched:same,byeMatched:same&&state.byeMatched===true};
}
function watchOpen(client, roomId) {
  const id=validId(roomId);
  if (!id || !installed.has(client)) return null;
  const observed=new Set();
  let expected='',settled=false,resolve,timer;
  const received=new Promise(done=>{resolve=done;});
  function finish(ok) {
    if (settled) return;
    settled=true;
    clearTimeout(timer);
    if (ok) {
      recentCalls.set(id,{callId:expected,byeMatched:false,
        expiresAt:Date.now()+CALL_TRACK_TTL_MS});
      pruneCalls();
    }
    resolve(ok);
  }
  const watch={
    confirm(callId) {
      const value=callKey(callId);
      if (!value) return;
      if (observed.size < 16) observed.add(value);
      if (expected && value===expected) finish(true);
    },
    wait(callId) {
      expected=callKey(callId);
      if (!expected) { finish(false); return received; }
      if (observed.has(expected)) finish(true);
      if (!settled) {
        timer=setTimeout(()=>finish(false),OPEN_EVENT_TIMEOUT_MS);
        timer.unref?.();
      }
      return received;
    },
    close() {
      if (pendingOpens.get(id)===watch) pendingOpens.delete(id);
      finish(false);
    },
  };
  pendingOpens.set(id,watch);
  return watch;
}

function validId(value) {
  const id = value == null ? '' : String(value);
  return /^[1-9]\d{0,29}$/.test(id) ? id : '';
}

function classify(msg, now = Date.now()) {
  if (msg?.room?.isOpenChat !== true || Number(msg?.message?.type ?? msg?.type) !== 52) return null;
  const roomId = validId(msg.room.id);
  const logId = validId(msg?.message?.logId ?? msg?.logId ??
    msg?.raw?.chatLog?.logId);
  if (!roomId || !logId) return null; // Require stable server log ID to dedupe.
  const lifecycle = lifecycleMetadata(msg);
  if (!lifecycle) return null;

  // Reject old replayed chat logs after reconnection / login.
  const rawTime = msg?.raw?.chatLog?.sendAt ?? msg?.raw?.chatLog?.s;
  if (rawTime !== undefined && rawTime !== null) {
    const n = Number(rawTime);
    if (Number.isFinite(n) && n > 0) {
      const when = n < 1e12 ? n * 1000 : n;
      if (when - now > 60000 || now - when > MAX_MESSAGE_AGE_MS) return null;
    }
  }
  return { roomId, logId, ...lifecycle };
}

function prune(now) {
  for (const [key, expiry] of seen) {
    if (expiry <= now) seen.delete(key);
  }
  while (seen.size > MAX_SEEN) seen.delete(seen.keys().next().value);
  while (lastEvents.size > MAX_ROOMS) lastEvents.delete(lastEvents.keys().next().value);
}

function last(roomId) {
  const stored = lastEvents.get(validId(roomId));
  return stored ? { ...stored } : null;
}

function notice(event) {
  if (event.eventType === 'vr_invite') {
    return '🎙️ 카카오톡 관리 매니저 | 보이스룸 개설 감지\n' +
      '이 방의 보이스룸 개설 이벤트(vr_invite)를 수신했습니다.\n' +
      '※ 실제 서버의 현재 활성 상태를 조회한 결과는 아닙니다.';
  }
  return '🎙️ 카카오톡 관리 매니저 | 보이스룸 종료 감지\n' +
    '이 방의 보이스룸 종료 이벤트(vr_bye)를 수신했습니다.' +
    (event.durationSeconds !== undefined ? '\n진행 시간: ' + event.durationSeconds + '초' : '') +
    '\n※ 실제 서버의 현재 활성 상태를 조회한 결과는 아닙니다.';
}

async function handleMessage(msg, { isManaged, isBotEnabled, send }, now = Date.now()) {
  const event = classify(msg, now);
  if (!event) return false;
  if (typeof isManaged !== 'function' || typeof isBotEnabled !== 'function' ||
      typeof send !== 'function') return false;

  const key = event.roomId + ':' + event.logId;
  prune(now);
  if (seen.has(key)) return false;
  const pending = event.eventType === 'vr_invite' ? pendingOpens.get(event.roomId) : null;
  const payload = pending || event.eventType==='vr_bye' ? attachmentObject(msg) : null;
  const eventCallId=callKey(payload?.callId);
  if (!pending) {
    // Ordinary automatic notices require both management and bot power.
    if (!await isManaged(event.roomId)) return false;
    if (!await isBotEnabled(event.roomId)) return false;
    if (seen.has(key)) return false;
  }
  seen.set(key, now + SEEN_TTL_MS);
  lastEvents.delete(event.roomId);
  lastEvents.set(event.roomId, {
    eventType: event.eventType,
    phase: event.eventType === 'vr_invite' ? '개설 이벤트 수신' : '종료 이벤트 수신',
    durationSeconds: event.durationSeconds,
    observedAt: now,
    verifiedActive: false,
  });
  prune(now);
  if (pending) {
    pending.confirm(eventCallId);
    // Room-level invitation alone is not proof that this bot's VOX call
    // was activated. Only the expected callId can confirm this watch.
  } else {
    if (event.eventType==='vr_bye' && eventCallId) {
      const state=recentCalls.get(event.roomId);
      if (state && state.expiresAt>Date.now() && state.callId===eventCallId) {
        state.byeMatched=true;
        console.info('[VOICE VOX30] matching LOCO vr_bye observed '+
          JSON.stringify({sameCall:true,durationSeconds:event.durationSeconds??null}));
      }
    }
    await send(event.roomId, notice(event));
  }
  return true;
}

function install(client, deps) {
  if (!client || typeof client.on !== 'function' || !deps) return false;
  if (installed.has(client)) return true;
  installed.add(client);
  client.on('message', (...args) => {
    const msg = args.length === 1 ? args[0] : args[1];
    if (!classify(msg)) return;
    void handleMessage(msg, deps).catch(() => {
      // Avoid logging message bodies, attachment content, credentials, or IDs.
      console.warn('[VOICE AUTO] management lookup or notification failed');
    });
  });
  return true;
}

module.exports = {
  classify, handleMessage, install, last, watchOpen, callCorrelation,
};
