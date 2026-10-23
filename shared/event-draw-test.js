'use strict';

const {randomInt} = require('node:crypto');

// This is a mention-delivery test only. A cached roster is not a verified
// current membership list, and no winner/prize is finalized by this command.
const activeRooms = new Set();
const lastSuccessByRoom = new Map();
const COOLDOWN_MS = 60 * 1000;

function isApex(name) {
  return typeof name === 'string' &&
    name.normalize('NFKC').replace(/\s+/g, '').toUpperCase().includes('APEX');
}

function getCandidates(members, botId) {
  if (!Array.isArray(members)) throw Error('Invalid cached member list');
  const unique = new Set();
  return members.filter(m => {
    const id = String(m?.id || '');
    if (!/^[1-9]\d*$/.test(id) ||
        id === String(botId) ||
        typeof m?.name !== 'string' || !m.name.trim() ||
        !isApex(m.name) || unique.has(id)) return false;
    unique.add(id);
    return true;
  });
}

async function safeSend(client, send, content) {
  if (client?.connected === false) {
    console.warn('[이벤 추첨 테스트] 응답 생략: 카카오톡 연결 끊김');
    return false;
  }
  try {
    await send(content);
    return true;
  } catch (error) {
    console.error('[이벤 추첨 테스트] 메시지 전송 실패:', String(error?.message || error));
    return false;
  }
}

async function handle({client, roomId, msg, send, mention, pickRandom = randomInt, now = Date.now}) {
  if (msg?.room?.isOpenChat !== true) {
    await safeSend(client,send,'오픈채팅방에서만 사용할 수 있습니다.');
    return;
  }
  if (![1,4].includes(Number(msg?.sender?.type))) {
    await safeSend(client,send,'방장 또는 부방장만 사용할 수 있습니다.');
    return;
  }
  if (typeof client?.getCachedMemberProfiles !== 'function') {
    await safeSend(client,send,'캐시 참가자 조회 기능을 사용할 수 없습니다.');
    return;
  }
  if (typeof mention !== 'function') {
    await safeSend(client,send,'카카오톡 멘션 기능을 사용할 수 없습니다.');
    return;
  }

  const room=String(roomId);
  if (activeRooms.has(room)) {
    await safeSend(client,send,'이미 이벤트 추첨 테스트가 진행 중입니다.');
    return;
  }
  const lastSuccess=lastSuccessByRoom.get(room);
  const remaining=lastSuccess==null?0:COOLDOWN_MS-(now()-lastSuccess);
  if(remaining>0) {
    await safeSend(client,send,'멘션 테스트는 60초 간격으로 가능합니다. '+Math.ceil(remaining/1000)+'초 후 다시 실행해 주세요.');
    return;
  }
  if (client.connected === false) {
    console.warn('[이벤 추첨 테스트] 연결 안 됨: room='+room);
    return;
  }

  activeRooms.add(room);
  try {
    // No MEMLIST, MEMBER or CHATONROOM calls. Use only observed profiles.
    const members=await client.getCachedMemberProfiles(roomId);
    const candidates=getCandidates(members,client.userId);
    console.log('[이벤 추첨 테스트] 캐시 후보 확인: room='+room+
      ' cached='+(members?.length ?? '?')+' apex='+candidates.length);
    if (candidates.length===0) {
      await safeSend(client,send,'APEX 닉네임 후보가 캐시에 없습니다. 먼저 #이벤인원테스트로 확인해 주세요.');
      return;
    }

    const index=pickRandom(candidates.length);
    if (!Number.isInteger(index) || index<0 || index>=candidates.length)
      throw Error('Invalid random candidate index');
    const target=candidates[index];
    const marker=mention(String(target.id),target.name);
    if(typeof marker!=='string' ||
       !marker.startsWith('\u0002') ||
       !marker.includes('\u0003') ||
       !marker.endsWith('\u0004'))
      throw Error('Real mention marker unavailable');

    const body='🎲 APEX 랜덤 추첨·멘션 테스트\n'+
      '━━━━━━━━━━━━━━\n'+
      '캐시 후보: '+candidates.length+'명\n'+
      '선정 대상: '+marker+'\n'+
      '━━━━━━━━━━━━━━\n'+
      '⚠️ 멘션 확인용 테스트입니다. 실제 당첨·보상은 없습니다.\n'+
      '캐시 목록은 현재 참여자 명단과 다를 수 있습니다.';
    const sent=await safeSend(client,send,body);
    if(sent) {
      lastSuccessByRoom.set(room,now());
      console.log('[이벤 추첨 테스트] 멘션 전송 완료: room='+room+
        ' candidates='+candidates.length);
    }
  } catch(error) {
    console.error('[이벤 추첨 테스트] 실행 실패: room='+room+
      ' error='+String(error?.message || error));
    await safeSend(client,send,'❌ 이벤트 추첨·멘션 테스트에 실패했습니다. Railway 로그를 확인해 주세요.');
  } finally {
    activeRooms.delete(room);
  }
}

module.exports={handle,getCandidates,isApex};
