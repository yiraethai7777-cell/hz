"use strict";

// HZ BOT launcher
// KakaoForge authentication/session setup is intentionally kept separate.
// This launcher uses an existing KakaoForge auth.json produced by your working setup.



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

require("./hz-new").start();
