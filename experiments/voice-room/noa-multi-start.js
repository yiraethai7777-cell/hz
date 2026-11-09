'use strict';

// Directly invokes the EXISTING Noa Android makeVoiceroom hook through the
// NEXI HTTPS bridge for each requested OM chat, one at a time.
// Noa MUST already run on a controlled Android/Redroid device.
// A successful HTTP acknowledgement is NOT confirmation that the Kakao server
// kept the room open; one Android user may be limited to one VOX audio session.
const { createNoaBridge } = require('../../shared/voice-room-noa-bridge');

const MAX_ROOMS = 12;
const MAX_I64 = 9223372036854775807n;

function id(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) ||
      BigInt(value) > MAX_I64) {
    throw new Error('오픈채팅방 ID는 양의 Int64 문자열이어야 합니다.');
  }
  return value;
}

function roomList(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_ROOMS)
    throw new Error('방 ID는 1~12개 입력해 주세요.');
  const ids = values.map(id);
  if (new Set(ids).size !== ids.length)
    throw new Error('중복된 방 ID가 있습니다.');
  return ids;
}

function cleanTitle(value) {
  const title = String(value ?? 'NEXI 보이스룸').trim();
  if (title.length === 0 || title.length > 40 || /[\x00-\x1f\x7f]/.test(title))
    throw new Error('보이스룸 제목은 제어문자 없이 1~40자여야 합니다.');
  return title;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startMultiple({ roomIds, botUserId, title = 'NEXI 보이스룸',
                               adapter, delayMs = 1200, sleep = delay }) {
  const rooms = roomList(roomIds);
  const botId = id(botUserId);
  const name = cleanTitle(title);
  if (!adapter || typeof adapter.create !== 'function')
    throw new Error('Noa Android 후킹 어댑터가 없습니다.');
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 30000)
    throw new Error('방 사이 요청 지연 시간이 올바르지 않습니다.');

  const results = [];
  for (let i = 0; i < rooms.length; i++) {
    const roomId = rooms[i];
    try {
      // Each call checks the Android account is the same NEXI bot user ID,
      // then invokes Noa POST /api/vox/voice-rooms => makeVoiceroom().
      // No implicit leave(), relogin, or automatic retries.
      const reply = await adapter.create({ roomId, title: name, botUserId: botId });
      results.push({
        roomId,
        state: reply?.requestAccepted === true ? 'request_accepted' : 'not_accepted',
        serverVerified: false,
      });
    } catch {
      // Never include response bodies, tokens, transport URLs, or auth data.
      results.push({ roomId, state: 'request_failed', serverVerified: false });
    }
    if (i < rooms.length - 1 && delayMs) await sleep(delayMs);
  }
  return results;
}

async function main(argv = process.argv.slice(2), env = process.env,
                    log = text => console.log(text)) {
  if (argv.includes('--help') || argv.length === 0) {
    log('사용법: NEXI_BOT_USER_ID=... NEXI_VOICE_NOA_URL=https://... ' +
      'NEXI_VOICE_NOA_TOKEN=... node experiments/voice-room/noa-multi-start.js 방ID1 방ID2 ...');
    return 0;
  }
  const rooms = roomList(argv);
  const botUserId = id(env.NEXI_BOT_USER_ID);
  const adapter = createNoaBridge({
    baseUrl: env.NEXI_VOICE_NOA_URL,
    token: env.NEXI_VOICE_NOA_TOKEN,
  });
  const results = await startMultiple({
    roomIds: rooms, botUserId,
    title: env.NEXI_VOICE_TITLE || 'NEXI 보이스룸', adapter,
  });
  for (const result of results) {
    const detail = result.state === 'request_accepted'
      ? 'Android 후킹 개설 요청 접수 (서버 개설·유지 미검증)'
      : 'Android 후킹 개설 요청 실패 또는 접수 확인 불가';
    log(result.roomId + ': ' + detail);
  }
  log('주의: 요청이 접수되어도 여러 보룸이 동시에 유지된다는 보장은 없습니다. ' +
      '각 방의 실제 보룸 화면에서 별도로 확인해야 합니다.');
  return results.every(r => r.state === 'request_accepted') ? 0 : 2;
}

if (require.main === module) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    console.error('VOX 후킹 시작 실패: 환경변수, 봇 ID, 방 ID를 확인해 주세요.');
    process.exitCode = 1;
  });
}

module.exports = { MAX_ROOMS, id, roomList, cleanTitle, startMultiple, main };
