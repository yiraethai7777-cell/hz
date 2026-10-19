
'use strict';

const { handleCoinCommand } = require('./coin');
const { joinGame } = require('./members');
const { performance } = require('node:perf_hooks');

async function message({ text, msg, chat, isBotAccount = false }) {
    const roomId = msg.room?.id;
    if (roomId == null) return;

    if (text === '!게임가입') {
        if (msg.sender?.id == null) {
            await chat.sendText(
                roomId,
                '사용자 ID를 확인할 수 없습니다.'
            );
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
        // 1. 서버 이벤트 루프 처리 지연 측정
        const serverStart = performance.now();

        await new Promise(resolve => setImmediate(resolve));

        const serverLatency =
            (performance.now() - serverStart).toFixed(2);

        // 2. 카카오톡 메시지 전송 요청 시간 측정
        const messageStart = performance.now();

        await chat.sendText(
            roomId,
            ' NEXUS | 메시지 전송 속도 측정 중...'
        );

        const messageLatency =
            (performance.now() - messageStart).toFixed(2);

        // 3. 측정 결과 출력
        
const result =
    'NEXUS | STATUS\n' +
    '━━━━━━━━━━━━━━\n' +
    'Server Latency : ' + serverLatency + 'ms\n' +
    'Message Latency: ' + messageLatency + 'ms\n' +
    '━━━━━━━━━━━━━━\n' +
    'Status: ONLINE';


        await chat.sendText(roomId, result);
        return;
    }
}

module.exports = { message };
