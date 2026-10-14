"use strict";

const { createClient } = require("./dist");
const { testConnection } = require("./hz-db");
const { getCommandList } = require("./hz-commands");
const { initAttendance, attend, attendanceRanking } = require("./hz-attendance");

const client = createClient({
  authPath: process.env.KAKAO_AUTH_PATH || "./auth.json",
  debug: process.env.KAKAO_DEBUG === "1",
  autoConnect: true,
  autoReconnect: true,
});

let attendanceReady = false;

client.onReady(() => {
  console.log("[HZ NEW] 카카오톡 연결 완료");
});

client.on("error", (err) => {
  console.error("[HZ NEW] 연결 오류:", err);
});

if (process.env.DATABASE_URL) {
  testConnection().catch((err) => {
    console.error("[HZ DB] 연결 실패:", err);
  });

  initAttendance()
    .then(() => {
      attendanceReady = true;
      console.log("[HZ 출석] 준비 완료");
    })
    .catch((err) => {
      console.error("[HZ 출석] 초기화 실패:", err);
    });
} else {
  console.warn("[HZ DB] DATABASE_URL 없음");
}

// 모든 명령어를 단 하나의 수신 함수에서 처리합니다.
client.onMessage(async (...args) => {
  const msg = args.length === 1 ? args[0] : args[1];
  const chat = args.length === 1 ? (client.chat || client) : args[0];
  if (!msg) return;

  const text = String(msg.message?.text ?? msg.text ?? "").trim();
  if (!["!핑", "!명령어", "!출석", "!출석순위", "!사진테스트"].includes(text)) return;

  const roomId = msg.room?.id;
  if (roomId === undefined || roomId === null) {
    console.error("[HZ NEW] 방 ID 없음:", text);
    return;
  }

  try {
    let reply;


    if (text === "!사진테스트") {


      
      const fsPhoto = require("fs");
      const pathPhoto = require("path");
      const imagePath = "/tmp/hz-stock-test.png";

      const response = await fetch(
        "https://dummyimage.com/800x400/172033/ffffff.png&text=HZ+STOCK+CHART"
      );

      if (!response.ok) {
        throw new Error("이미지 다운로드 실패: " + response.status);
      }

      const imageBuffer = Buffer.from(await response.arrayBuffer());
      fsPhoto.writeFileSync(imagePath, imageBuffer);

      await chat.sendPhoto(roomId, imagePath, {
        text: "📈 HZ 주식 그래프 테스트"
      });


      console.log("[HZ NEW] 사진 전송 성공");


      return;


    }


    if (text === "!핑") {
      reply = "🏓 퐁!";
    } else if (text === "!명령어") {
      reply = getCommandList();
    } else {
      const userId = msg.sender?.id;
      const userName = msg.sender?.name || "알 수 없음";
      if (text === "!출석" && (userId === undefined || userId === null)) {
        console.error("[HZ 출석] 사용자 ID 없음");
        return;
      }
      if (!attendanceReady) {
        reply = "⏳ 출석 시스템을 준비 중입니다.";
      } else if (text === "!출석") {
        reply = await attend(String(roomId), String(userId), String(userName));
      } else {
        reply = await attendanceRanking(String(roomId));
      }
    }

    await chat.sendText(roomId, reply);
    console.log("[HZ NEW] 명령어 처리 성공:", text);
  } catch (err) {
    console.error("[HZ NEW] 명령어 처리 실패:", text, err);
  }
});

console.log("[HZ NEW] 봇 시작 중...");
