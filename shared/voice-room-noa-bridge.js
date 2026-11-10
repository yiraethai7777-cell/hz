'use strict';

// Opt-in experimental bridge to Noa's Android VOX create endpoint.
// Noa requires a separately running rooted Android/Redroid instance.
// HTTP acknowledgement is NOT proof that the KakaoTalk server created a room.
const TIMEOUT_MS = 12000;
const MAX_JSON_BYTES = 65536;

function bridgeConfig(baseUrl, token) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) throw Error('브리지 주소가 없습니다.');
  let url;
  try { url = new URL(baseUrl.trim()); } catch { throw Error('브리지 주소 형식이 올바르지 않습니다.'); }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password ||
      url.search || url.hash || url.port === '0') {
    throw Error('HTTPS 브리지 주소만 사용할 수 있습니다.');
  }
  if (typeof token !== 'string' || token.trim().length < 16 ||
      /[\r\n]/.test(token)) throw Error('브리지 인증 토큰이 없거나 너무 짧습니다.');
  url.pathname = url.pathname.replace(/\/+$/, '') + '/';
  return { url, token: token.trim() };
}

function roomKey(value) {
  const id = String(value ?? '');
  if (!/^[1-9]\d{0,29}$/.test(id)) throw Error('올바른 오픈채팅방 ID가 필요합니다.');
  return id;
}

function createNoaBridge({ baseUrl, token, actorUserId, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS }) {
  const config = bridgeConfig(baseUrl, token);
  // A separately logged-in Android account is explicitly opt-in. Without it,
  // preserve the legacy same-account rule to avoid unintended account switching.
  const separateActor = actorUserId !== undefined && actorUserId !== null && String(actorUserId).trim() !== '';
  const configuredActorId = separateActor ? roomKey(actorUserId) : null;
  if (typeof fetchImpl !== 'function') throw Error('HTTP 클라이언트를 사용할 수 없습니다.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000)
    throw Error('브리지 요청 제한 시간이 올바르지 않습니다.');

  async function request(path, method, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(new URL(path, config.url), {
        method, redirect: 'error', signal: controller.signal,
        headers: {
          'Authorization': 'Bearer ' + config.token,
          'Accept': 'application/json',
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      });
      // Never echo backend error bodies, URLs, API tokens or session data.
      if (!response.ok) throw Error('브리지 HTTP 응답: ' + Number(response.status || 0));
      if (Number(response.headers?.get?.('content-length') || 0) > MAX_JSON_BYTES)
        throw Error('브리지 응답 크기 초과');
      const raw = await response.text();
      if (raw.length > MAX_JSON_BYTES) throw Error('브리지 응답 크기 초과');
      const data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('브리지 응답 형식 오류');
      return data;
    } catch (error) {
      if (error?.message?.startsWith('브리지 ')) throw error;
      throw Error('브리지 통신 실패 또는 응답 확인 불가');
    } finally {
      clearTimeout(timer);
    }
  }

  // Validate the actual Android account, not merely that a token is accepted.
  // Legacy mode requires the Railway bot account. Explicit actor mode requires
  // the configured Noa user ID; Railway's bot login and auth.json are untouched.
  async function requireActorIdentity(botUserId) {
    if (botUserId !== undefined) roomKey(botUserId);
    const expected = separateActor ? configuredActorId : roomKey(botUserId);
    const state = await request('api/status', 'GET');
    if (String(state.currentUserId ?? '') !== expected ||
        state.androidAvailable !== true || state.kakaoHookActive !== true ||
        state.voxControlActive !== true) {
      throw Error('Noa 실행 계정 또는 Android VOX 상태를 확인하지 못했습니다.');
    }
  }

  // A dedicated Android actor must know the exact OM room before mutation.
  // Noa's open-profile participants are not always marked isMine; leave actual
  // membership/room creation permissions to Noa and the KakaoTalk server.
  async function requireActorRoom(chatId) {
    if (!separateActor) return;
    const room = await request('api/rooms/' + chatId, 'GET');
    if (String(room.chatId ?? '') !== chatId || room.roomType !== 'OM')
      throw Error('Noa 실행 계정에서 대상 오픈채팅방을 확인하지 못했습니다.');
  }

  return {
    kind: 'noa-android-experimental',
    async create({ roomId, title, botUserId }) {
      const chatId = roomKey(roomId);
      const name = String(title ?? '').trim();
      if (!name || name.length > 40 || /[\x00-\x1f\x7f]/.test(name))
        throw Error('보이스룸 제목이 올바르지 않습니다.');
      if (separateActor || botUserId !== undefined) await requireActorIdentity(botUserId);
      await requireActorRoom(chatId);
      const result = await request('api/vox/voice-rooms', 'POST', { chatId, title: name });
      // Noa's OK indicates its Android callback was accepted, not server activation.
      return {
        requestAccepted: result.ok === true && String(result.chatId ?? '') === chatId,
        verified: false,
      };
    },
    async status({ roomId, botUserId }) {
      const chatId = roomKey(roomId);
      if (separateActor || botUserId !== undefined) await requireActorIdentity(botUserId);
      await requireActorRoom(chatId);
      const result = await request('api/vox/status', 'GET');
      const vr = result.voiceroom;
      const inSameRoom = result.moduleLoaded === true && vr && vr.idle === false &&
        String(vr.chatId ?? '') === chatId;
      return {
        roomId: chatId, verified: false,
        localSession: true, localActive: Boolean(inSameRoom),
        ...(result.moduleLoaded === true && vr && vr.idle === false && !inSameRoom
          ? { localBusyOtherRoom: true } : {}),
        statusKnown: result.moduleLoaded === true && vr && typeof vr.idle === 'boolean',
      };
    },
    async join({ roomId, botUserId }) {
      const chatId = roomKey(roomId);
      await requireActorIdentity(botUserId);
      await requireActorRoom(chatId);
      // Noa resolves VOX join-info from its logged-in Android KakaoTalk database.
      // Never derive host/callId from old chat attachment and never send VOX packets from LOCO.
      const result = await request('api/vox/voice-rooms/join', 'POST', { chatId });
      return {
        requestAccepted: result.ok === true && String(result.chatId ?? '') === chatId,
        verified: false,
      };
    },
    async leave({ roomId, botUserId }) {
      const chatId = roomKey(roomId);
      await requireActorIdentity(botUserId);
      await requireActorRoom(chatId);
      // This leaves only Noa's Android voice session, not the whole open chat room.
      const result = await request('api/vox/leave', 'POST', { chatId, kind: 'voiceroom' });
      return {
        requestAccepted: result.ok === true && String(result.chatId ?? '') === chatId &&
          result.kind === 'voiceroom',
        verified: false,
      };
    },
    // Deliberately NO stop(): leaving one's Android audio session does not
    // prove the KakaoTalk voice room itself has ended.
  };
}

function installFromEnv(client, env = process.env, fetchImpl) {
  // Commands are always registered; usable Noa credentials connect automatically.
  // Missing credentials mean no transport, not a disabled command.
  if (!env.NEXI_VOICE_NOA_URL || !env.NEXI_VOICE_NOA_TOKEN) return false;
  try {
    if (!client || typeof client !== 'object') throw Error('클라이언트 없음');
    client.voiceRoomAdapter = createNoaBridge({
      baseUrl: env.NEXI_VOICE_NOA_URL, token: env.NEXI_VOICE_NOA_TOKEN,
      actorUserId: env.NEXI_VOICE_NOA_ACTOR_USER_ID, fetchImpl,
    });
    console.log('[VOICE BRIDGE] experimental Noa adapter enabled (Android host required)');
    return true;
  } catch {
    console.warn('[VOICE BRIDGE] invalid experimental configuration; bridge disabled');
    return false;
  }
}

module.exports = { createNoaBridge, installFromEnv, bridgeConfig };
