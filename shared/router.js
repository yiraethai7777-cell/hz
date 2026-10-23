'use strict';
const { handleExtraMessage } = require('./help');

function attachRouter(client, { game, management, ready = Promise.resolve() }) {
  client.onMessage(async (...args) => {
    const msg = args.length === 1 ? args[0] : args[1];
    const chat = args.length === 1 ? (client.chat || client) : args[0];
    if (msg?.room?.id == null) return;
    const text = String(msg.message?.text ?? msg.text ?? '').trim();
    const roomId = msg.room.id;
    const senderId = msg.sender?.id ?? msg.senderId;
    const isBotAccount = client.userId != null && String(client.userId) !== '0' &&
      senderId != null && String(client.userId) === String(senderId);
    try {
      await ready;
      
      const context = {
  client,
  roomId,
  userId: senderId ?? '',
  userName: msg.sender?.name || '알 수 없음',
  messageId: msg.id ?? msg.message?.id ?? null,
  text,
  isBotAccount,
  senderType: msg.sender?.type,
  botId: client.userId,
  msg,
  resolveTarget: () => require('../manage/targets').resolve({msg,text,roomId,client,db:require('./db').getPool()}),
  unban: typeof client.openChatUnkick === 'function' ? target => client.openChatUnkick(roomId,String(target)) : undefined,
  kick: async target => {
    const id = String(target);
    if (!/^\d{4,}$/.test(id)) throw new Error('정확한 카카오 사용자 ID를 입력해 주세요.');
    if (id === String(client.userId) || id === String(senderId))
      throw new Error('봇 또는 명령 실행자 본인은 내보낼 수 없습니다.');
    if (typeof client.openChatKick !== 'function') throw new Error('내보내기 API를 사용할 수 없습니다.');
    const result = await client.openChatKick(roomId, id);
    console.log('[NEXUS KICK API]', JSON.stringify({ roomId: String(roomId), targetId: id, result }));
    if (result === false || result?.success === false || result?.ok === false ||
        result?.status === 'error' || (typeof result?.status === 'number' && result.status !== 0))
      throw new Error('내보내기 요청 실패: ' + JSON.stringify(result));
    return result;
  },
  send: body => chat.sendText(roomId, body)
};
      if (text === "!테스트") {
        await require("../manage/attendance-image/command")
          .handleTest(client, context);
        return;
      }
      
if (text === '#이벤인원테스트') {
  if (msg.room.isOpenChat !== true) {
    await context.send('오픈채팅방에서만 사용할 수 있습니다.');
    return;
  }

  // 방장(1), 부방장(4)만 테스트 허용
  if (![1, 4].includes(Number(msg.sender?.type))) {
    await context.send('방장 또는 부방장만 사용할 수 있습니다.');
    return;
  }

  try {
    const started = Date.now();

    const members = await client.refreshMemberProfiles(roomId);

    const valid = members.filter(m => m.id && m.name);
    const apex = valid.filter(m =>
      String(m.id) !== String(client.userId) &&
      m.name.normalize('NFKC')
        .replace(/\s+/g, '')
        .toUpperCase()
        .includes('APEX')
    );

    await context.send(
      '🔍 이벤트 인원 조회 결과\n' +
      '━━━━━━━━━━━━━━\n' +
      `조회된 인원: ${members.length}명\n` +
      `닉네임 확인: ${valid.length}명\n` +
      `APEX 추첨 대상: ${apex.length}명\n` +
      `조회 소요: ${Date.now() - started}ms\n` +
      '━━━━━━━━━━━━━━\n' +
      '카카오톡에 표시되는 실제 방 인원과 비교해 주세요.'
    );

  } catch (err) {
    console.error('[이벤 인원 조회 실패]', err);
    await context.send(
      '❌ 인원 조회 실패\nRailway 로그에서 오류를 확인해 주세요.'
    );
  }
  return;
}

      if (text === '#게임작동' || text === '#게임중지') {
        await game.toggle(context);
        return;
      }
      if (await management.message(context)) return;
      if (text !== '#주식시간' && await handleExtraMessage(client, ...args)) return;
      if (/^#출석(?:확인|순위)?(?:\s|$)/.test(text)) return;
      await game.message({ ...context, msg, chat });
    } catch (err) { console.error('[HZ NEW] 메시지 처리 실패:', err); }
  });
}
module.exports = { attachRouter };
