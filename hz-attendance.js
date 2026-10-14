"use strict";

const { getPool } = require("./hz-db");

function todayKST() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function timeKST(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

async function initAttendance() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS hz_new_attendance (
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      attend_date DATE NOT NULL,
      attended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, user_id, attend_date)
    )
  `);

  console.log("[HZ 출석] 테이블 준비 완료");
}

async function attend(roomId, userId, userName) {
  const db = getPool();
  const date = todayKST();

  const inserted = await db.query(`
    INSERT INTO hz_new_attendance
      (room_id, user_id, user_name, attend_date)
    VALUES ($1, $2, $3, $4::date)
    ON CONFLICT DO NOTHING
    RETURNING attended_at
  `, [roomId, userId, userName, date]);

  const ranking = await db.query(`
    SELECT user_id, user_name, attended_at
    FROM hz_new_attendance
    WHERE room_id = $1 AND attend_date = $2::date
    ORDER BY attended_at ASC, user_id ASC
  `, [roomId, date]);

  const position = ranking.rows.findIndex(
    row => row.user_id === userId
  );

  if (position === -1) {
    throw new Error("출석 기록을 확인할 수 없습니다.");
  }

  const record = ranking.rows[position];

  if (inserted.rowCount === 0) {
    return (
      "📅 이미 출석했습니다!\n" +
      "👤 " + record.user_name + "\n" +
      "🕒 " + timeKST(record.attended_at) + "\n" +
      "🏆 오늘 " + (position + 1) + "번째 출석"
    );
  }

  return (
    "✅ 출석 완료!\n" +
    "👤 " + userName + "\n" +
    "📅 " + date + "\n" +
    "🕒 " + timeKST(record.attended_at) + "\n" +
    "🏆 오늘 " + (position + 1) + "번째 출석"
  );
}

async function attendanceRanking(roomId) {
  const result = await getPool().query(`
    SELECT user_name, attended_at
    FROM hz_new_attendance
    WHERE room_id = $1 AND attend_date = $2::date
    ORDER BY attended_at ASC, user_id ASC
    LIMIT 3
  `, [roomId, todayKST()]);

  if (result.rows.length === 0) {
    return "📅 오늘 출석한 사람이 없습니다.";
  }

  const medals = ["🥇", "🥈", "🥉"];

  return (
    "🏆 오늘의 출석 순위\n\n" +
    result.rows.map((row, i) =>
      medals[i] + " " + row.user_name +
      " (" + timeKST(row.attended_at) + ")"
    ).join("\n")
  );
}

module.exports = {
  initAttendance,
  attend,
  attendanceRanking
};
