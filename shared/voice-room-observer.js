'use strict';

// Read-only diagnostic for observing possible VoiceRoom signals in already
// received KakaoForge messages / LOCO pushes. This is NOT a server status API.
const DURATION_MS = 3 * 60 * 1000;
const MAX_WATCHES = 32;
const MAX_EVENTS = 12;
const watches = new Map();
const installed = new WeakSet();
const attachedCarriages = new WeakSet();

// Historical Kakao chat types VOIP=51 and LIVETALK=52. These are only
// potential clues; neither proves a current open-chat VoiceRoom is active.
const candidateTypes = new Set([51, 52]);
const candidateMethod = /(?:VOICEROOM|VOICE_ROOM|VOICECHAT|VOX|LIVETALK|^VRC[A-Z0-9_]*$)/i;

function validId(value) {
  if (value == null) return '';
  const str = String(value);
  return /^[1-9]\d*$/.test(str) ? str : '';
}
function prune(now) {
  for (const [id, watch] of watches) {
    if (watch.until <= now) watches.delete(id);
  }
}
function start(roomId, now = Date.now()) {
  const id = validId(roomId);
  if (!id) throw Error('유효한 채팅방 ID가 필요합니다.');
  prune(now);
  watches.delete(id);
  if (watches.size >= MAX_WATCHES) watches.delete(watches.keys().next().value);
  const watch = { since: now, until: now + DURATION_MS, events: [] };
  watches.set(id, watch);
  return { since: watch.since, until: watch.until, durationMs: DURATION_MS };
}
function stop(roomId) { return watches.delete(validId(roomId)); }
function get(roomId, now = Date.now()) {
  prune(now);
  const w = watches.get(validId(roomId));
  if (!w) return { observing: false, verifiedActive: false, events: [] };
  return {
    observing: true, verifiedActive: false,
    since: w.since, until: w.until, remainingSeconds: Math.ceil((w.until - now) / 1000),
    events: w.events.map(e => ({ ...e })),
  };
}
function record(roomId, candidate, now) {
  const id = validId(roomId);
  const watch = watches.get(id);
  if (!watch || now < watch.since || now >= watch.until) return false;
  // Only protocol metadata; never retain names, chat texts, token fields or bodies.
  watch.events.push({ ...candidate, at: now });
  if (watch.events.length > MAX_EVENTS) watch.events.shift();
  return true;
}

/**
 * Retain only schema names/types and fixed classification labels, never
 * attachment values, message text, user identifiers, URLs, or server payloads.
 * Both hints are UI correlations; neither confirms the server's live state.
 */
function displayHint(text) {
  if (typeof text !== 'string') return '';
  const label = text.trim();
  if (/^보이스룸$/.test(label)) return '개설 표시 후보';
  if (/^(?:\d{1,3}:)?\d{1,3}:\d{2}$/.test(label)) return '종료 표시 후보';
  return '';
}
function safeKind(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'other';
}
function attachmentObject(msg) {
  const raw = msg?.raw?.chatLog || msg?.raw || {};
  const parsed = Array.isArray(msg?.attachmentsRaw) && msg.attachmentsRaw.length
    ? msg.attachmentsRaw : raw.attachment ?? raw.attachments ?? raw.extra;
  let data = parsed;
  if (typeof data === 'string') {
    if (data.length > 8192 || !/^[\s]*[\[{]/.test(data)) return null;
    try { data = JSON.parse(data); } catch { return null; }
  }
  if (!data || typeof data !== 'object') return null;
  const obj = Array.isArray(data) ? data[0] : data;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  return obj;
}
function metadataShape(msg) {
  const obj = attachmentObject(msg);
  if (!obj) return '';
  const keys = Object.keys(obj).sort().filter(k =>
    /^[A-Za-z][A-Za-z0-9_]{0,30}$/.test(k) &&
    !/(?:id|token|auth|secret|key|name|title|text|message|url|link|profile|user|mid|uid|member|nick)/i.test(k)
  ).slice(0, 12);
  return keys.map(k => k + ':' + safeKind(obj[k])).join(',').slice(0, 260);
}
function lifecycleMetadata(msg) {
  const obj = attachmentObject(msg);
  // Published third-party Android references describe vr_invite and vr_bye.
  // Only retain known fixed tokens; unknown attachment values are discarded.
  if (!obj || (obj.type !== 'vr_invite' && obj.type !== 'vr_bye')) return null;
  const meta = { eventType: obj.type };
  // Duration is a non-identifying counter in seconds. Bound it to 48 hours.
  if (Number.isSafeInteger(obj.duration) && obj.duration >= 0 && obj.duration <= 172800) {
    meta.durationSeconds = obj.duration;
  }
  return meta;
}

function observeMessage(msg, now = Date.now()) {
  if (msg?.room?.isOpenChat !== true) return false;
  const type = Number(msg?.message?.type ?? msg?.type);
  if (!candidateTypes.has(type)) return false;
  const room = validId(msg.room.id);
  const watch = watches.get(room);
  if (!watch || now < watch.since || now >= watch.until) return false;
  const candidate = { source: 'message', type };
  const lifecycle = type === 52 ? lifecycleMetadata(msg) : null;
  const hint = displayHint(msg?.message?.text ?? msg?.text);
  const shape = metadataShape(msg);
  if (lifecycle) {
    Object.assign(candidate, lifecycle);
    candidate.phaseHint = lifecycle.eventType === 'vr_invite'
      ? '개설 이벤트 후보(type=vr_invite)' : '종료 이벤트 후보(type=vr_bye)';
  } else if (hint) candidate.phaseHint = hint;
  if (shape) candidate.shape = shape;
  return record(room, candidate, now);
}
function observePush(packet, now = Date.now()) {
  const method = typeof packet?.method === 'string' ? packet.method : '';
  if (!candidateMethod.test(method)) return false;
  const body = packet?.body || {};
  const roomId = validId(body.c ?? body.chatId ?? body.roomId ??
    body.chatRoomId ?? body.chatLog?.chatId ?? body.chatLog?.c);
  if (!roomId) return false; // Never attribute a global signal to an arbitrary room.
  return record(roomId, { source: 'push', method: method.slice(0, 48) }, now);
}
function install(client) {
  if (!client || typeof client.on !== 'function') return false;
  if (installed.has(client)) return true;
  installed.add(client);
  client.on('message', (...args) => {
    const msg = args.length === 1 ? args[0] : args[1];
    observeMessage(msg);
  });
  const attachCarriage = () => {
    const carriage = client._carriage;
    if (!carriage || typeof carriage.on !== 'function' || attachedCarriages.has(carriage)) return;
    attachedCarriages.add(carriage);
    carriage.on('push', packet => observePush(packet));
  };
  client.on('ready', attachCarriage);
  attachCarriage();
  return true;
}
module.exports = {
  DURATION_MS, start, stop, get, observeMessage, observePush, install,
  displayHint, metadataShape, lifecycleMetadata,
};