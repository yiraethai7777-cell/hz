"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const adapter = require("../voice/adapter");
const detector = require("../voice/detector");
const voice = require("../voice");

// 보이스룸 관련 첨부 유형 감지
test("보이스룸 이벤트 감지", () => {
    const result = detector.detect({
        room: { id: "12345" },
        attachment: { type: "linvite" }
    });

    assert.equal(result.detected, true);
    assert.equal(result.type, "linvite");
    assert.equal(result.roomId, "12345");
});

// 일반 메시지는 보이스룸 이벤트가 아님
test("일반 메시지 제외", () => {
    assert.equal(
        detector.detect({
            attachment: { type: "text" }
        }),
        null
    );
});

// 실제 API가 없는 상태에서는 생성 실패를 정확히 반환
test("보이스룸 생성 API 상태", async () => {
    const result = await adapter.create("12345");

    assert.equal(result.ok, false);
    assert.ok(result.reason);
});

// 명령어 처리 확인
test("보룸생성 명령어", async () => {
    const messages = [];

    const handled = await voice.handleCommand({
        text: "!보룸생성",
        roomId: "12345",
        send: async text => messages.push(text)
    });

    assert.equal(handled, true);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /API/);
});

// 삭제한 명령어는 처리하지 않음
test("보룸시작 명령어 제외", async () => {
    const handled = await voice.handleCommand({
        text: "!보룸시작",
        roomId: "12345",
        send: async () => {}
    });

    assert.equal(handled, false);
});
