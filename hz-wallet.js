"use strict";

const { getPool } = require("./hz-db");

const START_COINS = 1000000;

function amount(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error("금액은 1 이상의 정수여야 합니다.");
  }
  return n;
}

async function initWallet() {
  const db = getPool();

  await db.query(`
    CREATE TABLE IF NOT EXISTS hz_wallets (
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      balance BIGINT NOT NULL DEFAULT 1000000
        CHECK (balance >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (room_id, user_id)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS hz_coin_logs (
      id BIGSERIAL PRIMARY KEY,
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      amount BIGINT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log("[HZ 코인] 테이블 준비 완료");
}

async function ensureWallet(db, roomId, userId, userName) {
  await db.query(`
    INSERT INTO hz_wallets
      (room_id, user_id, user_name, balance)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (room_id, user_id)
    DO UPDATE SET user_name = EXCLUDED.user_name
  `, [roomId, userId, userName, START_COINS]);
}

async function getBalance(roomId, userId, userName) {
  const db = getPool();
  await ensureWallet(db, roomId, userId, userName);

  const result = await db.query(`
    SELECT balance FROM hz_wallets
    WHERE room_id = $1 AND user_id = $2
  `, [roomId, userId]);

  return Number(result.rows[0].balance);
}

async function changeBalance(
  roomId, userId, userName, delta, type, detail = ""
) {
  if (!Number.isSafeInteger(delta) || delta === 0) {
    throw new Error("변경 금액이 올바르지 않습니다.");
  }

  const db = await getPool().connect();

  try {
    await db.query("BEGIN");
    await ensureWallet(db, roomId, userId, userName);

    const result = await db.query(`
      UPDATE hz_wallets
      SET balance = balance + $3
      WHERE room_id = $1 AND user_id = $2
        AND balance + $3 >= 0
      RETURNING balance
    `, [roomId, userId, delta]);

    if (!result.rowCount) {
      throw new Error("코인이 부족합니다.");
    }

    await db.query(`
      INSERT INTO hz_coin_logs
        (room_id, user_id, type, amount, detail)
      VALUES ($1, $2, $3, $4, $5)
    `, [roomId, userId, type, delta, detail]);

    await db.query("COMMIT");
    return Number(result.rows[0].balance);
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
}

async function coinRanking(roomId) {
  const result = await getPool().query(`
    SELECT user_name, balance
    FROM hz_wallets
    WHERE room_id = $1
    ORDER BY balance DESC, user_id ASC
    LIMIT 10
  `, [roomId]);

  if (!result.rows.length) {
    return "아직 코인 사용자가 없습니다.";
  }

  return "🏆 코인 순위\n\n" +
    result.rows.map((row, i) =>
      `${i + 1}위 ${row.user_name} - ` +
      `${Number(row.balance).toLocaleString("ko-KR")}코인`
    ).join("\n");
}

module.exports = {
  START_COINS,
  initWallet,
  ensureWallet,
  getBalance,
  changeBalance,
  coinRanking,
  amount
};
