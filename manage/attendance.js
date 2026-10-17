"use strict";

const { getPool } = require("../shared/db");
const { ensureWallet } = require("../game/wallet");
const BASE_REWARD = 30000;
const STREAK_BONUS = 1000;
const fmt = n => Number(n).toLocaleString("ko-KR");

function todayKST() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}
function timeKST(date) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).format(date);
}
function dateString(v) {
  if (typeof v === "string") return v.slice(0, 10);
  return new Date(v).toISOString().slice(0, 10);
}
function previousDate(date) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
async function streak(db, roomId, userId, date) {
  const result = await db.query(`
    SELECT attend_date::text AS day FROM hz_new_attendance
    WHERE room_id=$1 AND user_id=$2 AND attend_date <= $3::date
    ORDER BY attend_date DESC
  `, [roomId, userId, date]);
  let expected = date, count = 0;
  for (const row of result.rows) {
    if (dateString(row.day) !== expected) break;
    count++;
    expected = previousDate(expected);
  }
  return count;
}
async function initAttendance() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS hz_new_attendance (
      room_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL,
      attend_date DATE NOT NULL,
      attended_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, user_id, attend_date)
    )
  `);
  console.log("[HZ 출석] 테이블 준비 완료");
}
async function attend(roomId, userId, userName) {
  const room = String(roomId), user = String(userId), name = String(userName);
  const date = todayKST();
  const db = await getPool().connect();
  let isNew = false, reward = 0, days = 0, record;
  try {
    await db.query("BEGIN");
    // This lock serializes first attendance for the same room/user, including concurrent messages.
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [room, user]);
    const inserted = await db.query(`
      INSERT INTO hz_new_attendance(room_id,user_id,user_name,attend_date)
      VALUES($1,$2,$3,$4::date) ON CONFLICT DO NOTHING RETURNING attended_at
    `, [room, user, name, date]);
    isNew = inserted.rowCount > 0;
    const current = await db.query(`
      SELECT user_name,attended_at FROM hz_new_attendance
      WHERE room_id=$1 AND user_id=$2 AND attend_date=$3::date
    `, [room, user, date]);
    if (!current.rowCount) throw new Error("출석 기록을 확인할 수 없습니다.");
    record = current.rows[0];
    days = await streak(db, room, user, date);
    if (isNew) {
      reward = BASE_REWARD + (days - 1) * STREAK_BONUS;
      if (!Number.isSafeInteger(reward)) throw new Error("출석 보상 계산 오류");
      await ensureWallet(db, room, user, name);
      const updated = await db.query(`
        UPDATE hz_wallets SET balance=balance+$3
        WHERE room_id=$1 AND user_id=$2
          AND balance <= 9223372036854775807::bigint-$3
        RETURNING balance
      `, [room, user, reward]);
      if (!updated.rowCount) throw new Error("코인 잔액 한도를 초과했습니다.");
      await db.query(`
        INSERT INTO hz_coin_logs(room_id,user_id,type,amount,detail)
        VALUES($1,$2,'ATTENDANCE',$3,$4)
      `, [room, user, reward, `출석 ${days}일 연속 (기본 ${BASE_REWARD}, 보너스 ${reward - BASE_REWARD})`]);
    }
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
  const ranking = await getPool().query(`
    SELECT user_id FROM hz_new_attendance
    WHERE room_id=$1 AND attend_date=$2::date
    ORDER BY attended_at ASC,user_id ASC
  `, [room, date]);
  const position = ranking.rows.findIndex(row => row.user_id === user);
  const lines = [
    `📅 ${isNew ? name : record.user_name}`,
    "━━━━━━━━━━━━━━",
    isNew ? "✅ 출석 완료!" : "📌 오늘 이미 출석했습니다!",
    `📆 출석 날짜: ${date}`,
    `🕒 출석 시간: ${timeKST(record.attended_at)}`,
    `🏆 오늘 ${position + 1}번째 출석`,
    `🔥 연속 출석: ${days}일`
  ];
  if (isNew) {
    lines.push("", `🪙 기본 보상: ${fmt(BASE_REWARD)}코인`,
      `🎁 연속 보너스: ${fmt(reward - BASE_REWARD)}코인`,
      `💰 총 획득: ${fmt(reward)}코인`);
  } else {
    lines.push("", "🪙 오늘의 출석 보상은 이미 지급되었습니다.");
  }
  return lines.join("\n");
}
async function attendanceRanking(roomId) {
  const result = await getPool().query(`
    SELECT user_name,attended_at FROM hz_new_attendance
    WHERE room_id=$1 AND attend_date=$2::date
    ORDER BY attended_at ASC,user_id ASC LIMIT 3
  `, [String(roomId), todayKST()]);
  if (!result.rows.length) return "📅 오늘 출석한 사람이 없습니다.";
  const medals = ["🥇", "🥈", "🥉"];
  return "🏆 오늘의 출석 순위\n\n" + result.rows.map((row, i) =>
    `${medals[i]} ${row.user_name} (${timeKST(row.attended_at)})`
  ).join("\n");
}
module.exports = { initAttendance, attend, attendanceRanking };
