"use strict";

const { createAuthByQR } = require("./dist");

async function main() {
  try {
    console.log("[KakaoForge] QR 로그인을 시작합니다.");
    await createAuthByQR({
      authPath: "./auth.json",
      save: true
    });
    console.log("[KakaoForge] 인증 완료. auth.json이 저장되었습니다.");
  } catch (err) {
    console.error("[KakaoForge] 로그인 실패:", err);
    process.exitCode = 1;
  }
}

main();
