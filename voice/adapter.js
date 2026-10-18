"use strict";

// GL BOT 보이스룸 API 연결 모듈
// 실제 생성·참여 API가 확인되기 전까지 해당 작업은 실행하지 않습니다.

const reasons = {
    create: "보이스룸 생성 API가 아직 확인되지 않았습니다.",
    join: "보이스룸 참여 API가 아직 확인되지 않았습니다.",
    leave: "보이스룸 퇴장 API가 아직 확인되지 않았습니다.",
    close: "보이스룸 종료 API가 아직 확인되지 않았습니다.",
    enableAutoJoin: "참여 API가 없어 자동참여를 활성화할 수 없습니다.",
    disableAutoJoin: "자동참여가 활성화되어 있지 않습니다."
};

function unavailable(action) {
    return async function() {
        return {
            ok: false,
            reason: reasons[action]
        };
    };
}

function parseContent(content) {
    if (typeof content === "string") {
        try {
            return JSON.parse(content);
        } catch {
            return null;
        }
    }
    return content && typeof content === "object"
        ? content
        : null;
}

async function status(roomId, client) {
    if (!client?._carriage?.chatInfo) {
        return {
            ok: false,
            reason: "KakaoForge 채팅방 조회 기능을 사용할 수 없습니다."
        };
    }

    try {
        const response = await client._carriage.chatInfo(roomId);

        if (
            response?.status !== undefined &&
            Number(response.status) !== 0
        ) {
            return {
                ok: false,
                reason: "채팅방 정보 조회 실패 (상태 코드: " +
                    response.status + ")"
            };
        }

        const chat = response?.chatInfo ??
            response?.chat ??
            response;

        const metas = chat?.chatMetas ??
            response?.chatMetas ??
            [];

        const metaList = Array.isArray(metas)
            ? metas
            : Object.values(metas || {});

        const liveMeta = metaList.find(
            meta => Number(meta?.type) === 11
        );

        const content = parseContent(liveMeta?.content);

        if (typeof content?.liveon === "boolean") {
            return {
                ok: true,
                message: content.liveon
                    ? "보이스룸 상태: 진행 중 (메타데이터 기준)"
                    : "보이스룸 상태: 종료 상태 (메타데이터 기준)"
            };
        }

        return {
            ok: true,
            message: "보이스룸 상태: 확인 불가\n" +
                "채팅방 조회는 성공했지만 보이스룸 상태 정보가 없습니다."
        };

    } catch (error) {
        console.error("[GL VOICE STATUS]", error);

        return {
            ok: false,
            reason: "채팅방 정보 조회 중 오류가 발생했습니다."
        };
    }
}

module.exports = {
    create: unavailable("create"),
    join: unavailable("join"),
    leave: unavailable("leave"),
    close: unavailable("close"),
    status,
    enableAutoJoin: unavailable("enableAutoJoin"),
    disableAutoJoin: unavailable("disableAutoJoin")
};
