"use strict";

const { getPool } = require("../../shared/db");
const { readSnapshot } = require("./data");
const { renderAttendance } = require("./render");
const { sendPng } = require("./send");

const running = new Set();

async function sendAttendanceImage(client, context) {
  const { roomId, userId, send } = context;

  const room = String(roomId);
  const user = String(userId);
  const key = room + ":" + user;

  if (running.has(key)) return;
  running.add(key);

  try {
    const data = await readSnapshot(getPool(), {
      roomId: room,
      userId: user
    });

    if (!data.attendanceDate) {
      throw new Error("출석 기록을 찾을 수 없습니다.");
    }

    if (data.reward === null) {
      throw new Error("실제 출석 보상을 확인할 수 없습니다.");
    }

    const image = await renderAttendance({
      name: data.name,
      today: data.today,
      attendanceDate: data.attendanceDate,
      streak: data.streak,
      total: data.total,
      reward: data.reward,
      dates: data.dates
    });

    console.log("[ATTENDANCE IMAGE] 생성 완료", {
      roomId: room,
      userId: user,
      bytes: image.length
    });

    const result = await sendPng(client, room, image);

    if (!result.confirmed) {
      throw new Error("이미지 전송 확인 실패");
    }

    console.log("[ATTENDANCE IMAGE] 전송 완료", {
      roomId: room,
      userId: user
    });

  } catch (error) {
    console.error("[ATTENDANCE IMAGE ERROR]", error);

    try {
      await send("⚠️ 출석은 정상 완료되었지만 이미지를 전송하지 못했습니다.");
    } catch (replyError) {
      console.error("[ATTENDANCE IMAGE REPLY ERROR]", replyError);
    }
  } finally {
    running.delete(key);
  }
}

module.exports = { sendAttendanceImage };
