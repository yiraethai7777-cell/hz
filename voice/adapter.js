
"use strict";

// GL BOT 보이스룸 API 연결 모듈
// 실제 음성 연결 API 확인 전까지 서버 요청을 보내지 않습니다.

const reasons = {
    create: "보이스룸 생성 API가 아직 확인되지 않았습니다.",
    join: "보이스룸 참여 API가 아직 확인되지 않았습니다.",
    leave: "보이스룸 퇴장 API가 아직 확인되지 않았습니다.",
    close: "보이스룸 종료 API가 아직 확인되지 않았습니다.",
    status: "보이스룸 상태 조회 API가 아직 확인되지 않았습니다.",
    enableAutoJoin: "참여 API가 없어 자동참여를 활성화할 수 없습니다.",
    disableAutoJoin: "자동참여가 활성화되어 있지 않습니다."
};

function unavailable(action) {
    return async function(roomId) {
        return {
            ok: false,
            reason: reasons[action]
        };
    };
}

module.exports = {
    create: unavailable("create"),
    join: unavailable("join"),
    leave: unavailable("leave"),
    close: unavailable("close"),
    status: unavailable("status"),
    enableAutoJoin: unavailable("enableAutoJoin"),
    disableAutoJoin: unavailable("disableAutoJoin")
};
