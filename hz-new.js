"use strict";

const { createClient } = require("./dist");

const client = createClient({
  authPath: process.env.KAKAO_AUTH_PATH || "./auth.json",
  debug: process.env.KAKAO_DEBUG === "1",
  autoConnect: true,
  autoReconnect: true,
});

client.onReady(() => {
  console.log("[HZ NEW] 카카오톡 연결 완료");
});

client.on("error", (err) => {
  console.error("[HZ NEW] 연결 오류:", err);
});

console.log("[HZ NEW] 봇 시작 중...");

client.onMessage(async (msg) => {
  const text = String(
    msg.message?.text ?? msg.text ?? ""
  ).trim();

  if (text !== "!핑") return;

  try {
    await client.chat.sendText(
      msg.room.id,
      "🏓 퐁!"
    );

    console.log("[HZ NEW] 핑 응답 성공");
  } catch (err) {
    console.error("[HZ NEW] 핑 응답 실패:", err);
  }
});

// PostgreSQL 연결 확인
const { testConnection } = require("./hz-db");

if (process.env.DATABASE_URL) {
  testConnection().catch((err) => {
    console.error("[HZ DB] 연결 실패:", err.message);
  });
} else {
  console.log("[HZ DB] DATABASE_URL 없음 - DB 테스트 건너뜀");
}

// 명령어 목록 시스템
const { getCommandList } = require("./hz-commands");

client.onMessage(async (msg) => {
  const text = String(
    msg.message?.text ?? msg.text ?? ""
  ).trim();

  if (text !== "!명령어") return;

  try {
    await client.chat.sendText(
      msg.room.id,
      getCommandList()
    );
  } catch (err) {
    console.error("[HZ 명령어] 오류:", err);
  }
});

// 출석 시스템
const {
  initAttendance,
  attend,
  attendanceRanking
} = require("./hz-attendance");

let attendanceReady = false;

if (process.env.DATABASE_URL) {
  initAttendance()
    .then(() => {
      attendanceReady = true;
      console.log("[HZ 출석] 준비 완료");
    })
    .catch((err) => {
      console.error("[HZ 출석] 초기화 실패:", err.message);
    });
}

client.onMessage(async (msg) => {
  const text = String(
    msg.message?.text ?? msg.text ?? ""
  ).trim();

  if (text !== "!출석" && text !== "!출석순위") return;

  const roomId = msg.room?.id;
  const userId = msg.sender?.id;
  const userName = msg.sender?.name;

  if (!roomId || !userId) {
    console.error("[HZ 출석] 방 또는 사용자 ID 확인 실패");
    return;
  }

  try {
    let reply;

    if (!attendanceReady) {
      reply = "⏳ 출석 시스템을 준비 중입니다.";
    } else if (text === "!출석") {
      reply = await attend(
        String(roomId),
        String(userId),
        String(userName || "알 수 없음")
      );
    } else {
      reply = await attendanceRanking(String(roomId));
    }

    await client.chat.sendText(roomId, reply);
  } catch (err) {
    console.error("[HZ 출석] 오류:", err);
  }
});
