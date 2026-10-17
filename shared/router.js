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
      const context = { roomId, userId: senderId ?? '', userName: msg.sender?.name || '알 수 없음',
        messageId: msg.id ?? msg.message?.id ?? null, text, isBotAccount,
        send: body => chat.sendText(roomId, body) };
      if (text === '!게임작동' || text === '!게임중지') {
        await game.toggle(context);
        return;
      }
      if (await management.message(context)) return;
      if (text !== '!주식시간' && await handleExtraMessage(client, ...args)) return;
      if (/^!출석(?:확인|순위)?(?:\s|$)/.test(text)) return;
      await game.message({ ...context, msg, chat });
    } catch (err) { console.error('[HZ NEW] 메시지 처리 실패:', err); }
  });
}
module.exports = { attachRouter };
