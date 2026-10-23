'use strict';
const {randomInt} = require('node:crypto');
const {getCandidates} = require('./event-draw-test');
const {load:loadSettingsDefault,render,DEFAULTS}=require('./event-settings');

// A test-only game: no rewards, punishments or message hiding.
const active = new Map();
// Sending through KakaoForge is queued (normally >=400ms); never use
// 175ms of wall-clock time to cut off the five countdown messages.
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
  if (state.phase !== 'counting' || now() >= state.deadline) return false;
  state.result = 'success';
  state.resolveSignal();
  console.log('[이벤 진행 테스트] 카운트 진행 중 채팅 감지: room=' + state.room);
  return true;
}

async function start({
  client, roomId, msg, send, mention, pickRandom = randomInt,
  now = Date.now, sleep = delay, loadSettings = loadSettingsDefault
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
    await sendSafe(client, send, '이미 카운트 이벤트 테스트가 진행 중입니다.');
    return;
  }
  if (client.connected === false) return;

  let resolveSignal;
  const signal = new Promise(resolve => {resolveSignal = resolve;});
  const state = {room, userId:'', phase:'choosing', deadline:Number.POSITIVE_INFINITY, result:null, resolveSignal, signal};
  active.set(room, state); // Lock before any await.
  try {
    const settings={...DEFAULTS,...(await loadSettings(roomId))};
    const tickMs=Number(settings.speedMs);
    if(!Number.isSafeInteger(tickMs)||tickMs<35||tickMs>10000)
      throw Error('Invalid event speed setting');
    const members = await client.getCachedMemberProfiles(roomId);
    const candidates = getCandidates(members, client.userId);
    if (!candidates.length) {
      await sendSafe(client, send, '현재 확인된 APEX 참가자가 없습니다. 방 명단 동기화 중이거나 퇴장자가 제외된 상태일 수 있습니다. #이벤인원테스트로 확인해 주세요.');
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
    const variables={name:selected.name,mention:marker,count:candidates.length};

    if(settings.announcement) {
      // Optional per-room notice is posted before displaying the nominee.
      if(!await sendSafe(client,send,
        '📢 APEX 이벤트 공지\n━━━━━━━━━━━━━━\n'+render(settings.announcement,variables)))return;
    }

    // Highlight the actual Kakao mention in its own message.
    // Answering before first 5 is delivered is disqualifying.
    state.phase='precountdown';
    if(!await sendSafe(client,send,
      '📣📣📣 APEX '+tickMs+'ms 카운트 이벤트 테스트 📣📣📣\n'+
      '━━━━━━━━━━━━━━━━━━\n'+
      '🎯🎯 선택된 도전자 🎯🎯\n\n'+
      '👉👉  '+marker+'  👈👈\n\n'+
      '━━━━━━━━━━━━━━━━━━\n'+
      'APEX 후보: '+candidates.length+'명 (캐시 기준)\n'+
      '⏳ 숫자 5가 시작된 다음 답장하세요!\n'+
      '🚫 먼저 답장하면 즉시 탈락\n'+
      '⚙️ 숫자별 추가 대기: '+tickMs+'ms\n'+
      '⚠️ 테스트 전용 · 보상 없음'))return;

    console.log('[이벤 진행 테스트] 카운트 준비: room='+room+
      ' candidateCount='+candidates.length+' tickMs='+tickMs);

    // The first "5" opens the response window. Wait 35ms *after each
    // completed send*, not from the first "5", so Kakao's slower send
    // queue cannot cause an early 5 -> 4 -> timeout sequence.
    // The last "1" closes the response window 35ms after its send.
    for (let remaining=5; remaining>=1; remaining--) {
      if (state.result) break;
      if (client.connected === false) throw Error('Connection closed during countdown');
      if (!await sendSafe(client, send, '⏳ ' + remaining))
        throw Error('Countdown delivery failed');
      if (state.result) break;
      if (remaining === 5) {
        state.phase = 'counting';
        console.log('[이벤 진행 테스트] 카운트 시작: room=' + room + ' tickWaitMs=' + tickMs);
      }
      if (remaining === 1) state.deadline = now() + tickMs;
      await Promise.race([sleep(tickMs), signal]);
    }

    if (client.connected === false) throw Error('Connection closed during event');
    state.phase = 'ended';
    if (state.result === 'early') {
      console.log('[이벤 진행 테스트] 조기 답변 탈락: room=' + room);
      await sendSafe(client, send, render(settings.earlyMessage,variables)+'\n🎯 테스트 종료 · 실제 보상 없음');
    } else if (state.result === 'success') {
      console.log('[이벤 진행 테스트] 성공: room=' + room);
      await sendSafe(client, send, '✅ 반응 성공!\n'+render(settings.winMessage,variables,true)+'\n🎯 테스트 성공 · 실제 보상 없음');
    } else {
      state.result = 'expired';
      console.log('[이벤 진행 테스트] 시간 초과: room=' + room);
      await sendSafe(client, send, render(settings.timeoutMessage,variables)+'\n🎯 테스트 종료 · 실제 보상 없음');
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
