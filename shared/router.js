'use strict';
const { handleExtraMessage } = require('./help');
const { handleModeration } = require('./moderation');

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

      if (await handleModeration(chat, msg, client)) return;
      
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
