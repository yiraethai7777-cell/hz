"use strict";

// GL BOT 보이스룸 API 연결 모듈
// 실제 생성·참여 API가 확인되면 이 파일에 연결합니다.

async function create(roomId) {
    return {
        ok: false,
        reason: "보이스룸 생성 API가 아직 확인되지 않았습니다."
    };
}

async function join(roomId) {
    return {
        ok: false,
        reason: "보이스룸 참여 API가 아직 확인되지 않았습니다."
    };
}

async function leave(roomId) {
    return {
        ok: false,
        reason: "보이스룸 퇴장 API가 아직 확인되지 않았습니다."
    };
}

async function close(roomId) {
    return {
        ok: false,
        reason: "보이스룸 종료 API가 아직 확인되지 않았습니다."
    };
}

module.exports = { create, join, leave, close };
