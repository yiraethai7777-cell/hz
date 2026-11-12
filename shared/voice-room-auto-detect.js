'use strict';

// Event-driven VoiceRoom lifecycle notices for rooms with management ON.
// Only observes already received Kakao chat type-52 messages. No packet sends,
// media connections, secret collection, or server-active-state assertions.
const { lifecycleMetadata } = require('./voice-room-observer');

const SEEN_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_SEEN = 2048;
const MAX_ROOMS = 256;
const MAX_MESSAGE_AGE_MS = 5 * 60 * 1000;
const seen = new Map();
const lastEvents = new Map();
const installed = new WeakSet();
const pendingOpens = new Map();
const OPEN_EVENT_TIMEOUT_MS = 8000;

function watchOpen(client, roomId) {
  if (!installed.has(client)) return null;
  let resolve, timer;
  const received = new Promise(done => { resolve = done; });
  const watch = {
    confirm: () => resolve(true),
    wait() {
      timer = setTimeout(() => resolve(false), OPEN_EVENT_TIMEOUT_MS);
      return received.finally(() => clearTimeout(timer));
    },
    close() {
      if (pendingOpens.get(roomId) === watch) pendingOpens.delete(roomId);
      clearTimeout(timer);
      resolve(false);
    },
  };
  pendingOpens.set(roomId, watch);
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
  if (pending) pending.confirm();
  else await send(event.roomId, notice(event));
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
  classify, handleMessage, install, last, watchOpen,
};
