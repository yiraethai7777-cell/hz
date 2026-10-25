'use strict';
const {randomInt} = require('node:crypto');
const {getCandidates} = require('./event-draw-test');
const {load:loadSettingsDefault,render,DEFAULTS}=require('./event-settings');

// Shared countdown engine for !이벤진행테스트 and !이벤트시작.
// A win is a reaction result only: no prize payment or message hiding.
const active = new Map();
// One multi-round live event session per room, held until a win or cancellation.
const sessions = new Map();
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

// During the live countdown, only the selected participant may speak.
// Return true only for a message that may safely be hidden. This does not run
// during test events, between rounds, after a result or after cancellation.
function shouldBlind({roomId,senderId,isBotAccount=false,roomBotAdmin=false,msg,text=''}) {
 const room=String(roomId??''),state=active.get(room);
 if(!state||!state.live||state.result||state.session?.cancelled)return false;
 if(state.phase!=='precountdown'&&state.phase!=='counting')return false;
 if(msg?.room?.isOpenChat!==true||isBotAccount)return false;
 const sender=String(senderId??'');
 if(!/^[1-9]\d*$/.test(sender)||sender===state.userId)return false;
 const command=String(text||'').trim();
 // Do not hide an authorized host's attempt to stop or configure the event.
 if((roomBotAdmin||[1,4].includes(Number(msg?.sender?.type))) &&
   /^!(?:게임on|게임off|관리on|관리off|이벤트시작|이벤트중지|이벤설정|이벤속도|이벤공지작성|이벤공지|이벤당첨문구|이벤탈락문구|이벤시간초과문구|이벤초기화)(?=$|\s)/.test(command))
   return false;
 // Do not attempt to blind events without a verifiable chat log ID.
 const logId=msg?.message?.logId??msg?.message?.id??msg?.logId??msg?.id;
 return /^(?:0*[1-9]\d*)$/.test(String(logId??''));
}

// Called for every incoming message, without blocking other command handlers.
function receive({roomId, senderId, text, isBotAccount = false, now = Date.now}) {
  const state = active.get(String(roomId));
  if (!state || !state.userId || state.result || isBotAccount) return false;
  if (String(senderId ?? '') !== state.userId) return false;
  const body = String(text ?? '').trim();
  if (!body || body.startsWith('#') || body.startsWith('!')) return false;
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
  now = Date.now, sleep = delay, loadSettings = loadSettingsDefault,
  testMode = true, session = null, announce = true, excludeId = null, roomBotAdmin=false, randomRoom=false
}) {
  if (msg?.room?.isOpenChat !== true) {
    await sendSafe(client, send, '오픈채팅방에서만 사용할 수 있습니다.');
    return {outcome:'unavailable'};
  }
  if (!roomBotAdmin && ![1,4].includes(Number(msg?.sender?.type))) {
    await sendSafe(client, send, '방장 또는 부방장만 실행할 수 있습니다.');
    return {outcome:'unauthorized'};
  }
  if (typeof client?.getCachedMemberProfiles !== 'function' || typeof mention !== 'function') {
    await sendSafe(client, send, '캐시 인원 또는 멘션 기능이 없습니다.');
    return {outcome:'unavailable'};
  }

  const room = String(roomId);
  if (active.has(room) || (sessions.has(room) && sessions.get(room)!==session)) {
    await sendSafe(client, send, testMode?'이미 카운트 이벤트 테스트가 진행 중입니다.':'이미 카운트 이벤트가 진행 중입니다.');
    return {outcome:'busy'};
  }
  if (client.connected === false) return {outcome:'unavailable'};
  if (session?.cancelled) return {outcome:'cancelled'};

  let resolveSignal;
  const signal = new Promise(resolve => {resolveSignal = resolve;});
  const state = {room, userId:'', phase:'choosing', deadline:Number.POSITIVE_INFINITY, result:null, resolveSignal, signal,
    live:!testMode, session};
  active.set(room, state); // Lock before any await.
  try {
    const settings={...DEFAULTS,...(await loadSettings(roomId))};
    const tickMs=Number(settings.speedMs);
    if(!Number.isSafeInteger(tickMs)||tickMs<35||tickMs>10000)
      throw Error('Invalid event speed setting');
    const members = await client.getCachedMemberProfiles(roomId);
    const candidates = randomRoom ? getCandidates(members, client.userId, {allMembers:true}) : getCandidates(members, client.userId);
    if (!candidates.length) {
      await sendSafe(client, send, randomRoom?'현재 확인된 방 참가자가 없습니다. 방 명단 캐시를 확인해 주세요.':'현재 확인된 APEX 참가자가 없습니다. 방 명단 동기화 중이거나 퇴장자가 제외된 상태일 수 있습니다. !이벤인원테스트로 확인해 주세요.');
      return {outcome:'no-candidates'};
    }
    const eligible = excludeId && candidates.length>1 ? candidates.filter(p=>String(p.id)!==String(excludeId)) : candidates;
    const index = pickRandom(eligible.length);
    if (!Number.isInteger(index) || index < 0 || index >= eligible.length)
      throw Error('Invalid random index');
    const selected = eligible[index];
    const marker = mention(String(selected.id), selected.name);
    if (typeof marker !== 'string' ||
        !marker.startsWith('\u0002') || !marker.includes('\u0003') ||
        !marker.endsWith('\u0004'))
      throw Error('Invalid mention marker');
    state.userId = String(selected.id);
    state.phase='precountdown';
    const variables={name:selected.name,mention:marker,count:candidates.length};

    // The live event start shows only the challenger mention before counting.
    if(testMode && settings.announcement && announce) {
      // Optional per-room notice is posted before displaying the nominee.
      if(!await sendSafe(client,send,
        '📢 APEX 이벤트 공지\n━━━━━━━━━━━━━━\n'+render(settings.announcement,variables)))return;
    }

    // Show only the challenger title and actual Kakao mention in live rounds.
    // Keep the more detailed announcement in the explicit test command.
    const challengerBanner = testMode
      ? '📣📣📣 APEX '+tickMs+'ms 카운트 이벤트 테스트 📣📣📣\n'+
        '━━━━━━━━━━━━━━━━━━\n'+
        '🎯🎯 선택된 사람 🎯🎯\n\n'+
        '👉👉  '+marker+'  👈👈\n\n'+
        '━━━━━━━━━━━━━━━━━━\n'+
        'APEX 후보: '+candidates.length+'명 (캐시 기준)\n'+
        '⏳ 숫자 5가 시작된 다음 답장하세요!\n'+
        '🚫 먼저 답장하면 즉시 탈락\n'+
        '⚙️ 숫자별 추가 대기: '+tickMs+'ms\n'+
        '⚠️ 테스트 전용 · 보상 없음'
      : '🎯🎯 선택된 사람 🎯🎯\n\n👉👉  '+marker+'  👈👈';
    if(!state.result && !await sendSafe(client,send,challengerBanner))return {outcome:'aborted'};

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
    if (state.result === 'cancelled' || session?.cancelled) return {outcome:'cancelled',selectedId:state.userId};
    if (state.result === 'early') {
      console.log('[이벤 진행 테스트] 조기 답변 탈락: room=' + room);
      await sendSafe(client, send, render(settings.earlyMessage,variables)+(testMode?'\n🎯 테스트 종료 · 실제 보상 없음':''));
    } else if (state.result === 'success') {
      console.log('[이벤 진행 테스트] 성공: room=' + room);
      await sendSafe(client, send, '✅ 반응 성공!\n'+render(settings.winMessage,variables,true)+(testMode?'\n🎯 테스트 성공 · 실제 보상 없음':'\n🎯 이벤트 종료'));
    } else {
      state.result = 'expired';
      console.log('[이벤 진행 테스트] 시간 초과: room=' + room);
      await sendSafe(client, send, render(settings.timeoutMessage,variables)+(testMode?'\n🎯 테스트 종료 · 실제 보상 없음':''));
    }
    return {outcome:state.result,selectedId:state.userId};
  } catch(error) {
    state.phase = 'ended';
    state.result = 'aborted';
    console.error('[이벤 진행 테스트] 중단: room=' + room + ' error=' + String(error?.message || error));
    await sendSafe(client, send, testMode?'❌ 이벤트 테스트가 연결 오류 또는 전송 오류로 중단되었습니다.':'❌ 이벤트가 연결 오류 또는 전송 오류로 중단되었습니다.');
    return {outcome:'aborted'};
  } finally {
    state.phase = 'ended';
    if (active.get(room) === state) active.delete(room);
  }
}

async function startUntilWinner(args){
 const {client,roomId,msg,send}=args;
 const room=String(roomId);
 if(msg?.room?.isOpenChat!==true){
  await sendSafe(client,send,'오픈채팅방에서만 사용할 수 있습니다.');return 'unavailable';
 }
 if(!args.roomBotAdmin&&![1,4].includes(Number(msg?.sender?.type))){
  await sendSafe(client,send,'방장 또는 부방장만 실행할 수 있습니다.');return 'unauthorized';
 }
 if(sessions.has(room)||active.has(room)){
  await sendSafe(client,send,'이미 이벤트가 진행 중입니다.');return 'busy';
 }
 // Retain a lock between rounds as well as during the countdown.
 const session={cancelled:false};
 sessions.set(room,session);
 let lastSelected=null,rounds=0;
 const pause=args.betweenRounds||(()=>delay(500));
 try{
  while(!session.cancelled){
   if(client?.connected===false)return 'unavailable';
   const result=await start({...args,session,testMode:false,
     announce:rounds===0,excludeId:lastSelected});
   if(session.cancelled||result?.outcome==='cancelled')return 'cancelled';
   if(result?.outcome==='success')return 'success';
   if(!['early','expired'].includes(result?.outcome))return result?.outcome||'aborted';
   rounds++;
   lastSelected=result.selectedId;
   // Stop only on a real winner, explicit cancellation, disconnection
   // or unrecoverable error; never end after a timed-out round.
   // Move straight to the next challenger without another intro message.
   await pause();
  }
  return 'cancelled';
 }finally{
  if(sessions.get(room)===session)sessions.delete(room);
 }
}
async function stopUntilWinner({client,roomId,msg,send,roomBotAdmin=false}){
 if(msg?.room?.isOpenChat!==true){
  await sendSafe(client,send,'오픈채팅방에서만 사용할 수 있습니다.');return false;
 }
 if(!roomBotAdmin&&![1,4].includes(Number(msg?.sender?.type))){
  await sendSafe(client,send,'방장 또는 부방장만 중지할 수 있습니다.');return false;
 }
 const room=String(roomId),session=sessions.get(room);
 if(!session){
  await sendSafe(client,send,'현재 진행 중인 이벤트가 없습니다.');return false;
 }
 session.cancelled=true;
 const current=active.get(room);
 if(current&&!current.result){
  current.result='cancelled';
  current.resolveSignal();
 }
 await sendSafe(client,send,'⏹️ 이벤트가 중지되었습니다.');
 return true;
}
module.exports = {start, receive, shouldBlind, startUntilWinner, stopUntilWinner};
