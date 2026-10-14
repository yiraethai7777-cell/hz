"use strict";

const { Pool } = require("pg");

let pool = null;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL이 설정되지 않았습니다.");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000
    });

    pool.on("error", (err) => {
      console.error("[HZ DB] 연결 오류:", err.message);
    });
  }

  return pool;
}

async function testConnection() {
  const result = await getPool().query(
    "SELECT NOW() AS server_time"
  );

  console.log("[HZ DB] PostgreSQL 연결 성공");
  return result.rows[0];
}

async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  testConnection,
  closeDatabase
};
