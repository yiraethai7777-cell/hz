'use strict';

// Pure role decoder for the three lists delivered by the KakaoTalk Android
// Vox30Manager.queryVoiceRoomMemberList callback (not a direct VOX request).
// This module does NOT authenticate or acquire a moderator permission.
const MAX_I64 = 9223372036854775807n;

function idString(value) {
  if (typeof value !== 'string' && typeof value !== 'bigint' &&
      !(typeof value === 'number' && Number.isSafeInteger(value))) return '';
  const text = String(value);
  if (!/^[1-9]\d{0,18}$/.test(text)) return '';
  if (BigInt(text) > MAX_I64) return '';
  return text;
}

function normalizedSet(list) {
  if (!Array.isArray(list) || list.length > 10000) return null;
  const ids = new Set();
  for (const value of list) {
    const text = idString(value);
    if (!text) return null;
    ids.add(text);
  }
  return ids;
}

function decodeMembership(reply, currentUserId) {
  const unknown = {parsed:false, role:'unknown', moderatorCount:null};
  const target = idString(currentUserId);
  if (!target || !reply || typeof reply !== 'object' ||
      reply.resCode !== 0) return unknown;

  const moderators = normalizedSet(reply.moderatorUserIdList);
  const speakers = normalizedSet(reply.speakerUserIdList);
  const listeners = normalizedSet(reply.listenerUserIdList);
  if (!moderators || !speakers || !listeners) return unknown;

  // A single account cannot safely be in multiple roles; discard a stale or
  // internally inconsistent callback rather than awarding moderator rights.
  const memberships = [moderators,speakers,listeners].filter(set=>set.has(target));
  if (memberships.length > 1) return unknown;

  return {
    parsed: true,
    role: moderators.has(target) ? 'moderator'
      : speakers.has(target) ? 'speaker'
      : listeners.has(target) ? 'listener' : 'absent',
    moderatorCount: moderators.size,
  };
}

module.exports = {idString, normalizedSet, decodeMembership};
