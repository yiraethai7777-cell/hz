"use strict";

// HZ BOT launcher
// KakaoForge authentication/session setup is intentionally kept separate.
// This launcher uses an existing KakaoForge auth.json produced by your working setup.

const { createClient } = require("./dist");
const { attachHZBot } = require("./hz-bot");

if (!process.env.DATABASE_URL) {
  console.error("[HZ BOT] DATABASE_URL이 없습니다. PostgreSQL 연결 문자열을 설정해주세요.");
  process.exit(1);
}

const client = createClient({
  authPath: process.env.KAKAO_AUTH_PATH || "./auth.json",
  debug: process.env.KAKAO_DEBUG === "1",
  autoConnect: true,
  autoReconnect: true,
});

let attached = false;
client.onReady(async () => {
  if (attached) return;
  attached = true;
  try {
    const info = await attachHZBot(client);
    console.log(`[HZ BOT] 준비 완료 / botUserId=${info.botUserId}`);
  } catch (err) {
    attached = false;
    console.error("[HZ BOT] 초기화 실패:", err);
  }
});

client.on("error", (err) => console.error("[KakaoForge]", err));
