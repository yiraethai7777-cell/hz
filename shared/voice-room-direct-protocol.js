'use strict';

/**
 * Experimental Railway-only VOX adapter for an authenticated KakaoTalk
 * transport. This module deliberately DOES NOT invent a VOX packet opcode,
 * BSON schema, AES key, or login handshake: those must be provided by a
 * separately verified native transport implementation.
 *
 * Nothing here is enabled by default or touches auth.json / the Noa adapter.
 */

const MAX_TITLE = 40;
const REQUEST_TIMEOUT_MS = 12000;

function positiveId(value, label = 'ID') {
  const text = String(value ?? '');
  if (!/^[1-9][0-9]{0,18}$/.test(text) || BigInt(text) > 9223372036854775807n)
    throw Error(label + ' 형식이 올바르지 않습니다.');
  return text;
}

function voiceTitle(value) {
  const text = String(value ?? '').trim();
  if (!text || [...text].length > MAX_TITLE || /[\x00-\x1f\x7f]/.test(text))
    throw Error('보이스룸 제목이 올바르지 않습니다.');
  return text;
}

function validateWire(wire) {
  // A validated wire client must implement authentication, exact room
  // membership, real VOX request/response and server-side status inspection.
  // Noa's local VOX state cannot substitute for KakaoTalk server evidence.
  const methods = ['identity', 'roomMembership', 'makeVoiceRoom', 'voiceRoomStatus'];
  if (!wire || methods.some(name => typeof wire[name] !== 'function'))
    throw Error('검증된 VOX 통신 클라이언트 구현이 필요합니다.');
  return wire;
}

function withDeadline(action, ms) {
  let timer;
  return Promise.race([
    Promise.resolve().then(action),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('VOX 요청 제한 시간 초과')), ms);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function createDirectVoxBridge({wire, expectedUserId, timeoutMs = REQUEST_TIMEOUT_MS}) {
  validateWire(wire);
  const actorId = positiveId(expectedUserId, 'VOX 실행 계정 ID');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000)
    throw Error('요청 제한 시간이 올바르지 않습니다.');
  // In-flight protection is scoped per authenticated actor. The same account
  // cannot silently overlap two create requests while session semantics are
  // unverified. Other operations cannot release a different request's lock.
  let inFlight = false;

  async function validateSession(roomId, botUserId) {
    if (botUserId !== undefined) positiveId(botUserId, 'Railway 봇 ID');
    const identity = await wire.identity();
    if (!identity || String(identity.userId ?? '') !== actorId || identity.authenticated !== true)
      throw Error('VOX 클라이언트 로그인 계정 확인 실패');
    const membership = await wire.roomMembership(roomId);
    if (!membership || String(membership.chatId ?? '') !== roomId ||
        membership.roomType !== 'OM' || membership.isMember !== true)
      throw Error('VOX 실행 계정의 대상 오픈채팅방 참여를 확인하지 못했습니다.');
  }

  async function status({roomId, botUserId} = {}) {
    const chatId = positiveId(roomId, '오픈채팅방 ID');
    return withDeadline(async () => {
      await validateSession(chatId, botUserId);
      const state = await wire.voiceRoomStatus(chatId);
      const matching = String(state?.chatId ?? '') === chatId;
      const serverVerified = state?.source === 'kakao-server' && matching &&
        (state?.active === true || state?.active === false);
      return {
        roomId: chatId,
        verified: Boolean(serverVerified),
        active: serverVerified ? state.active : undefined,
        voiceRoomId: serverVerified && state.voiceRoomId != null
          ? String(state.voiceRoomId) : undefined,
        statusKnown: Boolean(serverVerified),
      };
    }, timeoutMs);
  }

  async function create({roomId, title, botUserId} = {}) {
    const chatId = positiveId(roomId, '오픈채팅방 ID');
    const roomTitle = voiceTitle(title);
    if (inFlight) throw Error('VOX 계정에서 다른 생성 요청을 처리 중입니다.');
    inFlight = true;
    try {
      return await withDeadline(async () => {
        await validateSession(chatId, botUserId);
        const before = await wire.voiceRoomStatus(chatId);
        if (before?.source === 'kakao-server' && before?.active === true)
          throw Error('대상 채팅방에 보이스룸이 이미 개설되어 있습니다.');
        // makeVoiceRoom MUST be a real, authenticated VOX transport operation.
        // A request acknowledgement is not proof of server-side creation.
        const result = await wire.makeVoiceRoom({chatId, title:roomTitle});
        if (!result || result.requestAccepted !== true)
          return {requestAccepted:false, verified:false};
        const state = await wire.voiceRoomStatus(chatId);
        const verified = state?.source === 'kakao-server' &&
          state.active === true && String(state.chatId ?? '') === chatId;
        return {
          requestAccepted:true,
          verified:Boolean(verified),
          ...(verified && state.voiceRoomId != null
            ? {voiceRoomId:String(state.voiceRoomId)} : {}),
        };
      }, timeoutMs);
    } finally {
      inFlight = false;
    }
  }

  return Object.freeze({kind:'vox-direct-prototype',create,status});
}

module.exports = {createDirectVoxBridge,positiveId,voiceTitle};
