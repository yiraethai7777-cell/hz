"use strict";

// GL BOT 보이스룸 이벤트 감지 모듈

const VOICE_KEYWORDS = [
    "linvite",
    "livetalk",
    "live_talk",
    "voip"
];

function detect(message) {
    if (!message || typeof message !== "object") {
        return null;
    }

    const attachment =
        message.attachment ??
        message.message?.attachment ??
        null;

    if (!attachment) return null;

    const type = String(
        attachment.type ??
        attachment.chatType ??
        ""
    ).toLowerCase();

    if (!VOICE_KEYWORDS.some(word => type.includes(word))) {
        return null;
    }

    return {
        detected: true,
        type,
        roomId: message.room?.id ?? null
    };
}

module.exports = { detect };
