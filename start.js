"use strict";

// HZ BOT launcher
// KakaoForge authentication/session setup is intentionally kept separate.
// This launcher uses an existing KakaoForge auth.json produced by your working setup.

const { createClient } = require("./dist");
const { attachHZBot } = require("./hz-bot");


// Render Web Service health endpoint
const http = require("http");

const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";

const healthServer = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("HZ BOT OK");
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not Found");
});

healthServer.listen(PORT, HOST, () => {
  console.log(`[WEB] Health server listening on ${HOST}:${PORT}`);
});

// Optional periodic self-request.
// Set KEEP_ALIVE_URL to your Render /health URL.
const KEEP_ALIVE_URL = process.env.KEEP_ALIVE_URL;

if (KEEP_ALIVE_URL) {
  const ping = async () => {
    try {
      const response = await fetch(KEEP_ALIVE_URL);
      console.log(`[KEEP ALIVE] ${response.status}`);
    } catch (err) {
      console.error("[KEEP ALIVE ERROR]", err?.message || err);
    }
  };

  // First check shortly after startup, then every 14 minutes.
  setTimeout(ping, 10_000);
  setInterval(ping, 14 * 60 * 1000);
} else {
  console.log("[KEEP ALIVE] KEEP_ALIVE_URL ë¯¸ì¤ì ");
}

if (!process.env.DATABASE_URL) {
  console.error("[HZ BOT] DATABASE_URLì´ ììµëë¤. PostgreSQL ì°ê²° ë¬¸ìì´ì ì¤ì í´ì£¼ì¸ì.");
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
    console.log(`[HZ BOT] ì¤ë¹ ìë£ / botUserId=${info.botUserId}`);
  } catch (err) {
    attached = false;
    console.error("[HZ BOT] ì´ê¸°í ì¤í¨:", err);
  }
});

client.on("error", (err) => console.error("[KakaoForge]", err));
process.on("uncaughtExceptionMonitor", (err) => {
  console.error("[치명적 오류]", err);
});

process.on("unhandledRejection", (err) => {
  console.error("[처리되지 않은 Promise 오류]", err);
  process.exitCode = 1;
  process.exit(1);
});
