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
