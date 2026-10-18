
'use strict';

const { handleCoinCommand } = require('./coin');
const { joinGame } = require('./members');
const { performance } = require('node:perf_hooks');

async function message({ text, msg, chat, isBotAccount = false }) {
    const roomId = msg.room?.id;
    if (roomId == null) return;

    if (text === '!게임가입') {
        if (msg.sender?.id == null) {
            await chat.sendText(roomId, '사용자 ID를 확인할 수 없습니다.');
            return;
        }

        await chat.sendText(
            roomId,
            await joinGame(
                roomId,
                msg.sender.id,
                msg.sender.name || '알 수 없음'
            )
        );
        return;
    }

    if (await handleCoinCommand({
        text,
        msg,
        roomId,
        chat,
        isBotAccount
    })) return;

    if (text === '!핑') {
        const start = performance.now();

        await new Promise(resolve => setImmediate(resolve));

        const latency = (performance.now() - start).toFixed(2);

        const result =
            '🏓 NEXUS | 서버 상태\n' +
            '━━━━━━━━━━━━━━\n' +
            '⚡ 서버 처리 지연: ' + latency + 'ms\n' +
            '🟢 서버 상태: 정상 작동\n' +
            '━━━━━━━━━━━━━━';

        await chat.sendText(roomId, result);
        return;
    }
}

module.exports = { message };
