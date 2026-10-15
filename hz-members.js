"use strict";
const { getPool } = require("./hz-db");
const { ensureWallet } = require("./hz-wallet");
const BONUS = 100000;
const fmt = n => Number(n).toLocaleString("ko-KR");
async function initMembers() {
  const db = getPool();
  await db.query(`CREATE TABLE IF NOT EXISTS hz_game_members (
    room_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(room_id,user_id))`);
}
async function isMember(roomId,userId,db=getPool()) {
  const result = await db.query("SELECT 1 FROM hz_game_members WHERE room_id=$1 AND user_id=$2",[String(roomId),String(userId)]);
  return result.rowCount > 0;
}
async function joinGame(roomId,userId,userName) {
  const room=String(roomId), user=String(userId), name=String(userName);
  const db=await getPool().connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",[room,user]);
    await ensureWallet(db,room,user,name);
    const inserted=await db.query(`INSERT INTO hz_game_members(room_id,user_id,user_name)
      VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id`,[room,user,name]);
    let bonus=0;
    if (inserted.rowCount) {
      // 기존 지갑은 마이그레이션 때 eligible=false. 잔액 보존 및 과거 초기 지급 중복 방지.
      const credit=await db.query(`UPDATE hz_wallets SET balance=balance+$3, signup_bonus_eligible=FALSE
        WHERE room_id=$1 AND user_id=$2 AND signup_bonus_eligible=TRUE
          AND balance <= 9223372036854775807::bigint-$3 RETURNING balance`,[room,user,BONUS]);
      if (credit.rowCount) {
        bonus=BONUS;
        await db.query(`INSERT INTO hz_coin_logs(room_id,user_id,type,amount,detail)
          VALUES($1,$2,'GAME_SIGNUP',$3,'최초 게임 가입 축하금')`,[room,user,BONUS]);
      }
    }
    const wallet=await db.query("SELECT balance FROM hz_wallets WHERE room_id=$1 AND user_id=$2",[room,user]);
    await db.query("COMMIT");
    const balance=wallet.rows[0].balance;
    return inserted.rowCount
      ? `🎮 HZ 게임 가입 완료!\n━━━━━━━━━━━━━━\n👤 이름: ${name}\n🪙 가입 축하금: ${fmt(bonus)}코인\n💰 현재 잔액: ${fmt(balance)}코인${bonus ? '' : '\n📌 기존 지갑 잔액은 그대로 유지됩니다.'}`
      : `🎮 이미 가입된 사용자입니다.\n━━━━━━━━━━━━━━\n👤 이름: ${name}\n🪙 현재 코인: ${fmt(balance)}코인`;
  } catch(e) { await db.query("ROLLBACK"); throw e; }
  finally { db.release(); }
}
module.exports={initMembers,isMember,joinGame};
