
"use strict";

const adapter = require("./adapter");

const commands = {
    "!보룸생성": ["create", "보이스룸 생성 완료!"],
    "!보룸참여": ["join", "보이스룸 참여 완료!"],
    "!보룸퇴장": ["leave", "보이스룸 퇴장 완료!"],
    "!보룸종료": ["close", "보이스룸 종료 완료!"],
    "!보룸상태": ["status", "보이스룸 상태 확인 완료!"],
    "!보룸자동참여": ["enableAutoJoin", "자동참여 활성화!"],
    "!보룸자동참여중지": ["disableAutoJoin", "자동참여 중지!"]
};

async function handleCommand(ctx) {
    const command = commands[ctx?.text];
    if (!command) return false;

    const [action, successMessage] = command;

    try {
        const result = await adapter[action](ctx.roomId);

        if (result?.ok === true) {
            await ctx.send("🎙️ " + (result.message || successMessage));
        } else {
            await ctx.send(
                "❌ " + (result?.reason || "보이스룸 기능을 사용할 수 없습니다.")
            );
        }
    } catch (error) {
        console.error("[GL VOICE]", error);
        await ctx.send("❌ 보이스룸 처리 중 오류가 발생했습니다.");
    }

    return true;
}

module.exports = { handleCommand };
