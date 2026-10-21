
const fs = require("node:fs");
const path = require("node:path");
const MemberType = {
  OpenChat: {
    Owner: 1,
    Member: 2,
    Manager: 4
  }
};

const FILE = path.join(__dirname, "banned-words.json");
const db = fs.existsSync(FILE)
  ? JSON.parse(fs.readFileSync(FILE, "utf8"))
  : {};

const DEFAULT_BAD_WORDS = ["시발", "씨발", "지랄"];
const INITIAL_BAD_WORD =
  /(?:ㅅ[\s._~!*?-]*ㅂ|ㅆ[\s._~!*?-]*ㅂ|ㅈ[\s._~!*?-]*ㄹ)/u;

const COMMANDS = [
  "금지어추가", "금지어삭제", "금지어목록",
  "금지어켜기", "금지어끄기",
  "홍보허용추가", "홍보허용삭제", "홍보허용목록",
  "홍보금지켜기", "홍보금지끄기"
];

function save() {
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2), "utf8");
}

function roomSettings(roomId) {
  const id = String(roomId);
  if (!db[id]) db[id] = {};

  const r = db[id];
  if (!Array.isArray(r.words)) r.words = [];
  if (!Array.isArray(r.allowedPromoters)) r.allowedPromoters = [];
  if (r.enabled === undefined) r.enabled = true;
  if (r.promoBlocked === undefined) r.promoBlocked = true;
  return r;
}

function normalize(value) {
  return String(value).normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}\u200b-\u200d]/gu, "");
}

function parseWords(input) {
  if (!input?.trim()) return [];
  // 쉼표가 있으면 띄어쓰기 포함 문구도 등록 가능
  const parts = input.includes(",")
    ? input.split(/[,，\n]+/)
    : input.split(/\s+/);

  return [...new Set(parts.map(x => x.trim()).filter(Boolean))];
}

function hasBadWord(text, room) {
  if (INITIAL_BAD_WORD.test(text)) return true;

  const compact = normalize(text);
  return [...DEFAULT_BAD_WORDS, ...room.words]
    .some(w => normalize(w) && compact.includes(normalize(w)));
}

function hasRoomLink(text) {
  const tokens = String(text).match(
    /(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<>"']*)?/gi
  ) || [];

  return tokens.some(token => {
    const cleaned = token.replace(/[)\]}>.,!?]+$/g, "");
    try {
      const url = new URL(
        /^https?:\/\//i.test(cleaned)
          ? cleaned
          : `https://${cleaned}`
      );
      return url.hostname.toLowerCase() === "open.kakao.com"
        && /^\/o\/[a-z0-9]+\/?$/i.test(url.pathname);
    } catch {
      return false;
    }
  });
}

async function handleCommand(chat, msg, room) {
  const text = (msg.message?.text || "").trim();
  const match = text.match(/^#([^\s]+)(?:\s+([\s\S]+))?$/);
  if (!match || !COMMANDS.includes(match[1])) return false;

  const command = match[1];
  const input = match[2] || "";
  const roomId = msg.room.id;

  const isAdmin =
    Number(msg.sender.type) === MemberType.OpenChat.Owner ||
    Number(msg.sender.type) === MemberType.OpenChat.Manager;

  const reply = async text => chat.sendText(roomId, text);

  if (!isAdmin) {
    await reply("방장 또는 부방장만 설정할 수 있습니다.");
    return true;
  }

  if (command === "금지어켜기" || command === "금지어끄기") {
    room.enabled = command === "금지어켜기";
    save();
    await reply(`금지어 필터 ${room.enabled ? "ON" : "OFF"}`);
    return true;
  }

  if (command === "홍보금지켜기" || command === "홍보금지끄기") {
    room.promoBlocked = command === "홍보금지켜기";
    save();
    await reply(`오픈채팅 링크 차단 ${room.promoBlocked ? "ON" : "OFF"}`);
    return true;
  }

  if (command === "금지어목록") {
    await reply(
      `기본 욕설: ${DEFAULT_BAD_WORDS.join(", ")}\n` +
      `초성: ㅅㅂ, ㅆㅂ, ㅈㄹ\n` +
      `추가 금지어: ${room.words.join(", ") || "없음"}`
    );
    return true;
  }

  if (command === "홍보허용목록") {
    await reply(
      "홍보 허용 ID:\n" +
      (room.allowedPromoters.join("\n") || "없음")
    );
    return true;
  }

  if (command === "금지어추가" || command === "금지어삭제") {
    const words = parseWords(input).filter(
      w => w.length <= 40 && normalize(w)
    ).slice(0, 30);

    if (!words.length) {
      await reply("사용법: #금지어추가 광고, 도배, 불법 사이트");
      return true;
    }

    if (command === "금지어추가") {
      const existing = new Set(room.words.map(normalize));
      for (const word of words) {
        if (!existing.has(normalize(word))) {
          room.words.push(word);
          existing.add(normalize(word));
        }
      }
    } else {
      const removing = new Set(words.map(normalize));
      room.words = room.words.filter(
        w => !removing.has(normalize(w))
      );
    }

    save();
    await reply(
      `${command} 처리 완료\n요청: ${words.join(", ")}\n` +
      `현재 추가 금지어: ${room.words.length}개`
    );
    return true;
  }

  if (command === "홍보허용추가" || command === "홍보허용삭제") {
    const ids = input.split(/[,\s]+/)
      .filter(Boolean);

    if (!ids.length || ids.some(id => !/^\d{1,20}$/.test(id))) {
      await reply("사용법: #홍보허용추가 123456789, 987654321");
      return true;
    }

    const allowed = new Set(room.allowedPromoters.map(String));

    for (const id of ids) {
      if (command === "홍보허용추가") allowed.add(id);
      else allowed.delete(id);
    }

    room.allowedPromoters = [...allowed];
    save();
    await reply(`${command} 처리 완료: ${ids.join(", ")}`);
    return true;
  }

  return false;
}

async function handleModeration(chat, msg, client) {
  if (!msg.room?.isOpenChat) return false;
  if (String(msg.sender?.id) === String(client.userId)) return false;

  const roomId = msg.room.id;
  const room = roomSettings(roomId);

  if (await handleCommand(chat, msg, room)) return true;

  const text = msg.message?.text;
  if (typeof text !== "string" || !text) return false;

  const badWord = room.enabled && hasBadWord(text, room);
  const unauthorizedLink =
    room.promoBlocked &&
    hasRoomLink(text) &&
    !room.allowedPromoters.includes(String(msg.sender.id));

  if (!badWord && !unauthorizedLink) return false;

  try {
    if (typeof chat.openChatBlind !== "function") {
      throw new Error("이 KakaoForge 버전에 openChatBlind가 없습니다.");
    }

    await chat.openChatBlind(roomId, msg);

    console.log(
      `[자동 가리기] ${badWord ? "욕설/금지어" : "오픈채팅 홍보"}`
    );
  } catch (err) {
    console.error("[자동 가리기 실패]", err);
  }

  // 차단 대상으로 판단한 메시지는 다른 명령어 처리기로 넘기지 않음
  return true;
}

module.exports = { handleModeration };
