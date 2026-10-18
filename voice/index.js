"use strict";

// GL BOT Voice Room Module
// 보이스룸 기능 진입점

const adapter = require("./adapter");

async function handleCommand(ctx) {
    const { text, roomId, send } = ctx;

    if (text === "!보룸생성") {
        const result = await adapter.create(roomId);
        await send(result.ok
            ? "🎙️ 보이스룸 생성 완료!"
            : "❌ " + result.reason);
        return true;
    }

    return false;
}

module.exports = { handleCommand };
