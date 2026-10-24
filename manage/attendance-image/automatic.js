"use strict";

const { getPool } = require("../../shared/db");
const { readSnapshot } = require("./data");
const { renderAttendance } = require("./render");
const { sendPng } = require("./send");

const running = new Set();

async function sendAttendanceImage(client, context) {
  const { roomId, userId, send, onDemand = false } = context;

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
      if (onDemand) {
        await send("📅 오늘 출석 기록이 없습니다. 먼저 !출석을 입력해 주세요.");
        return false;
      }
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

    const result = await sendPng(client, room, image, {
      caption: '📅 ' + data.name + '님의 출석 달력 · ' + data.attendanceDate
    });

    if (!result.confirmed) {
      throw new Error("이미지 전송 확인 실패");
    }

    console.log("[ATTENDANCE IMAGE] 전송 완료", {
      roomId: room,
      userId: user
    });
    return true;

  } catch (error) {
    console.error("[ATTENDANCE IMAGE ERROR]", error);

    try {
      await send(onDemand
        ? "⚠️ 출석 이미지를 전송하지 못했습니다. 잠시 후 다시 !출석이미지를 입력해 주세요."
        : "⚠️ 출석은 정상 완료되었지만 이미지를 전송하지 못했습니다. !출석이미지로 다시 요청할 수 있습니다.");
    } catch (replyError) {
      console.error("[ATTENDANCE IMAGE REPLY ERROR]", replyError);
    }
    return false;
  } finally {
    running.delete(key);
  }
}

module.exports = { sendAttendanceImage };
