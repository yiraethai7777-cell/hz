'use strict';

// In-memory receiver for CURRENT voice-room invitation coordinates.
// This is only the endpoint-discovery part of a standalone VOX joiner.
// It does not authenticate, send VOX packets, join, or retain media data.
const { isIP } = require('node:net');
const { attachmentObject } = require('./voice-room-observer');

const TTL_MS = 5 * 60 * 1000;
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
function messageTime(msg, now) {
  const value = msg?.raw?.chatLog?.sendAt ?? msg?.raw?.chatLog?.s;
  if (value == null) return now;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ts = n < 1e12 ? n * 1000 : n;
  return ts > now + 60000 || now - ts > TTL_MS ? null : ts;
}
function prune(now) {
  for (const [id, record] of roomEvents) {
    if (now - record.at > TTL_MS) roomEvents.delete(id);
  }
  while (roomEvents.size > MAX_ROOMS) {
    roomEvents.delete(roomEvents.keys().next().value);
  }
}
function observe(msg, now = Date.now()) {
  if (msg?.room?.isOpenChat !== true ||
      Number(msg?.message?.type ?? msg?.type) !== 52) return false;
  const roomId = positiveId(msg?.room?.id);
  const logId = positiveId(msg?.message?.logId ?? msg?.raw?.chatLog?.logId ?? msg?.logId);
  const sendAt = messageTime(msg, now);
  if (!roomId || !logId || sendAt == null) return false;
  const attachment = attachmentObject(msg);
  if (!attachment || !['vr_invite', 'vr_bye'].includes(attachment.type)) return false;
  prune(now);
  const old = roomEvents.get(roomId);
  if (old && BigInt(logId) <= BigInt(old.logId)) return false;
  if (attachment.type === 'vr_bye') {
    // Tombstone prevents an older replayed invite from looking active.
    roomEvents.delete(roomId);
    roomEvents.set(roomId, { at: now, logId, phase: 'ended', endpoint: null });
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
  roomEvents.set(roomId, { at: now, logId, phase: 'invite', endpoint });
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
module.exports = { observe, status, resolve, install, positiveId, portNumber, TTL_MS };
