'use strict';

// Isolated event roster diagnostic: no game or moderation switch required.
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

async function handle({client, roomId, msg, send}) {
  if (msg?.room?.isOpenChat !== true) {
    await safeReply(client, send, '오픈채팅방에서만 사용할 수 있습니다.');
    return;
  }
  if (![1, 4].includes(Number(msg?.sender?.type))) {
    await safeReply(client, send, '방장 또는 부방장만 사용할 수 있습니다.');
    return;
  }
  if (typeof client?.refreshMemberProfiles !== 'function') {
    await safeReply(client, send, '이벤트 인원 조회 기능을 사용할 수 없습니다.');
    return;
  }

  const room = String(roomId);
  if (runningRooms.has(room)) {
    await safeReply(client, send, '이미 이벤트 인원을 조회하고 있습니다.');
    return;
  }
  if (client.connected === false) {
    console.warn('[이벤 인원 테스트] 시작 불가: 카카오톡 연결 끊김');
    return;
  }

  runningRooms.add(room);
  const started = Date.now();
  console.log('[이벤 인원 테스트] 조회 시작: room=' + room);
  try {
    const members = await client.refreshMemberProfiles(roomId, {
      allowChatOnRoomFallback: true,
      onProgress(progress) {
        console.log('[이벤 인원 테스트] 조회 진행: room=' + room +
          ' page=' + progress.page +
          ' pageMembers=' + progress.pageMembers +
          ' totalMembers=' + progress.totalMembers +
          ' hasMore=' + progress.hasMore +
          ' source=' + progress.source +
          ' status=' + progress.status +
          ' responseKeys=' + (progress.responseKeys || []).join(',') +
          ' bodyKeys=' + (progress.bodyKeys || []).join(','));
      }
    });
    if (!Array.isArray(members)) throw new Error('Invalid member profile result');

    const valid = members.filter(m => m?.id && typeof m.name === 'string' && m.name.trim());
    const apex = valid.filter(m =>
      String(m.id) !== String(client.userId) &&
      m.name.normalize('NFKC').replace(/\s+/g, '').toUpperCase().includes('APEX')
    );
    const elapsed = Date.now() - started;
    console.log('[이벤 인원 테스트] 조회 완료: room=' + room +
      ' members=' + members.length + ' named=' + valid.length +
      ' apex=' + apex.length + ' elapsedMs=' + elapsed);

    await safeReply(client, send,
      '🔍 이벤트 인원 조회 결과\n' +
      '━━━━━━━━━━━━━━\n' +
      '조회된 인원: ' + members.length + '명\n' +
      '닉네임 확인: ' + valid.length + '명\n' +
      'APEX 추첨 대상: ' + apex.length + '명 (닉네임 확인 기준)\n' +
      (valid.length < members.length ? '⚠️ 닉네임이 없는 인원이 있어 전체 추첨 대상은 미확정입니다.\n' : '') +
      '조회 소요: ' + elapsed + 'ms\n' +
      '━━━━━━━━━━━━━━\n' +
      '카카오톡에 표시되는 실제 방 인원과 비교해 주세요.');
  } catch (err) {
    const elapsed = Date.now() - started;
    console.error('[이벤 인원 테스트] 조회 실패: room=' + room +
      ' elapsedMs=' + elapsed + ' error=' + String(err?.message || err));
    await safeReply(client, send,
      '❌ 이벤트 인원 조회 실패\nRailway 로그에서 [이벤 인원 테스트]를 확인해 주세요.');
  } finally {
    runningRooms.delete(room);
  }
}

module.exports = {handle};
