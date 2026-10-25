'use strict';

// Passive event-member diagnostic: never request a live member roster.
// Cached members are observations, NOT verified current room membership.
const runningRooms = new Set();

async function safeReply(client, send, message) {
  if (client?.connected === false) {
    console.warn('[이벤 인원 테스트] 안내 전송 생략: 카카오톡 연결 끊김');
    return false;
  }
  try {
    await send(message);
    return true;
  } catch (err) {
    console.warn('[이벤 인원 테스트] 안내 전송 실패:', String(err?.message || err));
    return false;
  }
}

async function handle({client, roomId, msg, roomBotAdmin=false, send}) {
  if (msg?.room?.isOpenChat !== true) {
    await safeReply(client, send, '오픈채팅방에서만 사용할 수 있습니다.');
    return;
  }
  if (!roomBotAdmin && ![1, 4].includes(Number(msg?.sender?.type))) {
    await safeReply(client, send, '방장 또는 부방장만 사용할 수 있습니다.');
    return;
  }
  if (typeof client?.getCachedMemberProfiles !== 'function') {
    await safeReply(client, send, '캐시 인원 테스트 기능을 사용할 수 없습니다.');
    return;
  }

  const room = String(roomId);
  if (runningRooms.has(room)) {
    await safeReply(client, send, '이미 이벤트 인원 캐시를 확인하고 있습니다.');
    return;
  }
  if (client.connected === false) {
    console.warn('[이벤 인원 테스트] 시작 불가: 카카오톡 연결 끊김');
    return;
  }

  runningRooms.add(room);
  const started=Date.now();
  console.log('[이벤 인원 테스트] 캐시 확인 시작: room=' + room);
  try {
    // Deliberately no MEMLIST or CHATONROOM: both were involved in unstable
    // connection periods. A cache result must never be treated as a full roster.
    const members=await client.getCachedMemberProfiles(roomId);
    if(!Array.isArray(members))throw new Error('Invalid cached member result');
    const valid=members.filter(m=>m?.id && typeof m.name==='string' && m.name.trim());
    const apex=valid.filter(m=>
      String(m.id)!==String(client.userId) &&
      m.name.normalize('NFKC').replace(/\s+/g,'').toUpperCase().includes('APEX')
    );
    console.log('[이벤 인원 테스트] 캐시 확인 완료: room=' + room +
      ' cached=' + members.length + ' named=' + valid.length +
      ' apexCandidates=' + apex.length + ' elapsedMs=' + (Date.now()-started));

    await safeReply(client,send,
      '🔍 이벤트 인원 캐시 테스트\n' +
      '━━━━━━━━━━━━━━\n' +
      '캐시에서 확인된 인원: ' + members.length + '명\n' +
      '닉네임 확인: ' + valid.length + '명\n' +
      'APEX 후보(캐시 기준): ' + apex.length + '명\n' +
      '조회 소요: ' + (Date.now()-started) + 'ms\n' +
      '━━━━━━━━━━━━━━\n' +
      '⚠️ 실제 전체 인원과 현재 참여 여부는 확인되지 않았습니다.\n' +
      '이 결과만으로 실제 이벤트 추첨을 진행하면 안 됩니다.');
  } catch(err) {
    console.error('[이벤 인원 테스트] 캐시 확인 실패: room='+room+
      ' error='+String(err?.message||err));
    await safeReply(client,send,'❌ 캐시 인원 확인 실패\nRailway 로그를 확인해 주세요.');
  } finally {
    runningRooms.delete(room);
  }
}

module.exports={handle};
