'use strict';
const {randomInt} = require('node:crypto');
const {getCandidates} = require('./event-draw-test');

// A test-only game: no rewards, punishments or message hiding.
const active = new Map();
const cooldown = new Map();
const COOLDOWN_MS = 60_000;
const TICK_MS = 35; // Nominal countdown gap. Actual sends may be rate-limited.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function sendSafe(client, send, message) {
  if (client?.connected === false) {
    console.warn('[이벤 진행 테스트] 메시지 전송 생략: 연결 끊김');
    return false;
  }
  try {
    await send(message);
    return true;
  } catch (error) {
    console.warn('[이벤 진행 테스트] 메시지 전송 실패:', String(error?.message || error));
    return false;
  }
}

// Called for every incoming message, without blocking other command handlers.
function receive({roomId, senderId, text, isBotAccount = false, now = Date.now}) {
  const state = active.get(String(roomId));
  if (!state || !state.userId || state.result || isBotAccount) return false;
  if (String(senderId ?? '') !== state.userId) return false;
  const body = String(text ?? '').trim();
  if (!body || body.startsWith('#')) return false;
  if (state.phase === 'precountdown') {
    state.result = 'early';
    state.resolveSignal();
    console.log('[이벤 진행 테스트] 카운트 시작 전 답변으로 탈락: room=' + state.room);
    return true;
  }
  if (state.phase !== 'counting') return false;
  state.result = 'success';
  state.resolveSignal();
  console.log('[이벤 진행 테스트] 카운트 진행 중 채팅 감지: room=' + state.room);
  return true;
}

async function start({
  client, roomId, msg, send, mention, pickRandom = randomInt,
  now = Date.now, sleep = delay
}) {
  if (msg?.room?.isOpenChat !== true) {
    await sendSafe(client, send, '오픈채팅방에서만 사용할 수 있습니다.');
    return;
  }
  if (![1,4].includes(Number(msg?.sender?.type))) {
    await sendSafe(client, send, '방장 또는 부방장만 실행할 수 있습니다.');
    return;
  }
  if (typeof client?.getCachedMemberProfiles !== 'function' || typeof mention !== 'function') {
    await sendSafe(client, send, '캐시 인원 또는 멘션 기능이 없습니다.');
    return;
  }

  const room = String(roomId);
  if (active.has(room)) {
    await sendSafe(client, send, '이미 5초 이벤트 테스트가 진행 중입니다.');
    return;
  }
  const last = cooldown.get(room);
  if (last != null && now() - last < COOLDOWN_MS) {
    const remaining = Math.ceil((COOLDOWN_MS - (now() - last))/1000);
    await sendSafe(client, send, remaining + '초 뒤에 다시 테스트할 수 있습니다.');
    return;
  }
  if (client.connected === false) return;

  let resolveSignal;
  const signal = new Promise(resolve => {resolveSignal = resolve;});
  const state = {room, userId:'', phase:'choosing', result:null, resolveSignal, signal};
  active.set(room, state); // Lock before any await.
  try {
    const members = await client.getCachedMemberProfiles(roomId);
    const candidates = getCandidates(members, client.userId);
    if (!candidates.length) {
      await sendSafe(client, send, '캐시에 APEX 후보가 없습니다. #이벤인원테스트를 실행해 주세요.');
      return;
    }
    const index = pickRandom(candidates.length);
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length)
      throw Error('Invalid random index');
    const selected = candidates[index];
    const marker = mention(String(selected.id), selected.name);
    if (typeof marker !== 'string' ||
        !marker.startsWith('\u0002') || !marker.includes('\u0003') ||
        !marker.endsWith('\u0004'))
      throw Error('Invalid mention marker');
    state.userId = String(selected.id);
    // The selected user must wait until the first countdown number is sent.
    state.phase = 'precountdown';

    if (!await sendSafe(client, send,
      '🎯 APEX 5초 반응 이벤트 테스트\n' +
      '━━━━━━━━━━━━━━\n' +
      '후보: ' + candidates.length + '명 (캐시 기준)\n' +
      '도전자: ' + marker + '\n' +
      '⏳ 5 카운트가 시작되면 답장하세요! (숫자당 35ms)\n' +
      '시작 전에 답장하면 즉시 탈락합니다.\n' +
      '━━━━━━━━━━━━━━\n' +
      '⚠️ 테스트 전용 · 실제 당첨이나 보상 없음')) return;

    cooldown.set(room, now());
    console.log('[이벤 진행 테스트] 카운트 준비: room=' + room +
      ' candidateCount=' + candidates.length + ' tickMs=' + TICK_MS);

    // Before the first "5" is delivered, a selected user's answer
    // disqualifies them. Once "5" is delivered, normal chat is valid.
    // Each tick waits 35 ms after a confirmed send. Network delivery and
    // the client's outgoing send queue can make the visible pace slower.
    for (let remaining=5; remaining>=1; remaining--) {
      if (state.result) break;
      if (client.connected === false) throw Error('Connection closed during countdown');
      if (!await sendSafe(client, send, '⏳ ' + remaining)) 
        throw Error('Countdown delivery failed');
      if (state.result) break;
      if (remaining === 5) {
        state.phase = 'counting';
        console.log('[이벤 진행 테스트] 카운트 시작: room=' + room + ' tickMs=' + TICK_MS);
      }
      await Promise.race([sleep(TICK_MS), signal]);
    }

    if (client.connected === false) throw Error('Connection closed during event');
    state.phase = 'ended';
    if (state.result === 'early') {
      console.log('[이벤 진행 테스트] 조기 답변 탈락: room=' + room);
      await sendSafe(client, send, '🚫 탈락! 카운트다운이 시작되기 전에 답장했습니다.\n🎯 테스트 종료 · 실제 보상 없음');
    } else if (state.result === 'success') {
      console.log('[이벤 진행 테스트] 성공: room=' + room);
      await sendSafe(client, send, '✅ 반응 성공! 카운트 진행 중 선택된 참가자의 채팅을 감지했습니다.\n🎯 테스트 성공 · 실제 보상 없음');
    } else {
      state.result = 'expired';
      console.log('[이벤 진행 테스트] 시간 초과: room=' + room);
      await sendSafe(client, send, '⌛ 시간 초과! 카운트가 끝나기 전에 선택된 참가자가 답장하지 않았습니다.\n🎯 테스트 종료 · 실제 보상 없음');
    }
  } catch(error) {
    state.phase = 'ended';
    state.result = 'aborted';
    console.error('[이벤 진행 테스트] 중단: room=' + room + ' error=' + String(error?.message || error));
    await sendSafe(client, send, '❌ 이벤트 테스트가 연결 오류 또는 전송 오류로 중단되었습니다.');
  } finally {
    state.phase = 'ended';
    if (active.get(room) === state) active.delete(room);
  }
}

module.exports = {start, receive};
