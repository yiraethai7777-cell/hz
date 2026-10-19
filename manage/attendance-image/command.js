
"use strict";

const { kstDate } = require("./data");
const { renderAttendance } = require("./render");
const { sendPng } = require("./send");

const running = new Set();

async function handleTest(client, context) {
  const { roomId, userName, send } = context;
  const key = String(roomId);

  if (running.has(key)) {
    await send("⏳ 이미지 전송 테스트가 진행 중입니다.");
    return;
  }

  running.add(key);

  try {
    await send("🖼️ NEXUS 출석 이미지를 생성하고 있습니다.");

    const today = kstDate();

    const image = await renderAttendance({
      name: userName || "이름 없음",
      today,
      attendanceDate: today,
      streak: 1,
      total: 1,
      reward: "30000",
      dates: [today]
    });

    console.log("[NEXUS IMAGE TEST] 생성 완료", {
      roomId: key,
      bytes: image.length
    });

    const result = await sendPng(client, key, image);

    if (!result.confirmed) {
      throw new Error("사진 전송 완료를 확인하지 못했습니다.");
    }

    await send(
      "✅ NEXUS 이미지 전송 완료\n" +
      "👤 사용자: " + userName + "\n" +
      "📅 날짜: " + today + "\n" +
      "📌 실제 출석 및 코인 기록은 변경되지 않았습니다."
    );

  } catch (error) {
    console.error("[NEXUS IMAGE TEST ERROR]", error);

    await send(
      "❌ 출석 이미지 테스트 실패\n" +
      "오류: " + String(error.message || error).slice(0, 250) +
      "\nRailway 로그에서 상세 오류를 확인해 주세요."
    ).catch(err => {
      console.error("[NEXUS IMAGE TEST REPLY ERROR]", err);
    });

  } finally {
    running.delete(key);
  }
}

module.exports = { handleTest };
