"use strict";
const { getPool } = require("./hz-db");
const { ensureWallet, getBalance, coinRanking } = require("./hz-wallet");
const fmt = n => Number(n).toLocaleString("ko-KR");
const MAX = 1000000000;
function validAmount(raw) {
  if (!/^[1-9]\d*$/.test(String(raw || ""))) throw new Error("금액은 1 이상의 정수로 입력해 주세요.");
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n > MAX) throw new Error("한 번에 최대 10억 코인까지 가능합니다.");
  return n;
}
function sender(msg) {
  const id = msg.sender?.id;
  if (id === undefined || id === null) throw new Error("보낸 사람의 ID를 확인할 수 없습니다.");
  return { id: String(id), name: String(msg.sender?.name || "알 수 없음") };
}
function mentionTarget(msg) {
  const candidates = [
    msg.mentions, msg.message?.mentions, msg.message?.mentionList,
    msg.raw?.mentions, msg.raw?.chat?.mentions,
    msg.message?.attachment?.mentions, msg.raw?.chat?.attachment?.mentions
  ];
  const list = candidates.find(x => Array.isArray(x) && x.length > 0);
  if (!list || list.length !== 1) throw new Error("카카오톡에서 한 사람을 실제로 멘션해 주세요.");
  const m = list[0];
  if (!m || typeof m !== "object") throw new Error("멘션 대상 정보를 읽을 수 없습니다.");
  const id = m.userId ?? m.user_id ?? m.user?.id ?? m.member?.id ?? m.accountId ?? m.id;
  if (id === undefined || id === null || String(id).trim() === "") {
    throw new Error("멘션 대상의 고유 ID가 없습니다. 송금하지 않았습니다.");
  }
  return { id: String(id), name: String(m.name ?? m.nickname ?? m.user?.name ?? "멘션 사용자") };
}
function messageKey(msg) {
  const id = msg.id ?? msg.message?.id ?? msg.raw?.chat?.logId ?? msg.raw?.logId ?? msg.logId;
  return id === undefined || id === null || String(id) === "" ? null : String(id);
}
async function initCoinExtra() {
  await getPool().query(`CREATE TABLE IF NOT EXISTS hz_coin_operations (
    room_id TEXT NOT NULL, message_id TEXT NOT NULL,
    operation TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(room_id, message_id)
  )`);
  console.log("[HZ 코인] 송금 중복 방지 테이블 준비 완료");
}
async function transfer({ roomId, from, to, coins, kind, messageId }) {
  if (!messageId) throw new Error("메시지 고유번호를 확인할 수 없어 안전하게 거래를 중단했습니다.");
  if (from.id === to.id) throw new Error("자기 자신에게 송금하거나 지급할 수 없습니다.");
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    const dedup = await db.query(`INSERT INTO hz_coin_operations(room_id,message_id,operation)
      VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING message_id`, [roomId, messageId, kind]);
    if (!dedup.rowCount) throw new Error("이미 처리된 메시지입니다.");
    // Lock both wallets in stable order to avoid deadlocks between simultaneous transfers.
    const users = [from, to].sort((a,b) => a.id.localeCompare(b.id));
    for (const u of users) await ensureWallet(db, roomId, u.id, u.name);
    for (const u of users) await db.query(`SELECT balance FROM hz_wallets
      WHERE room_id=$1 AND user_id=$2 FOR UPDATE`, [roomId,u.id]);
    if (kind === "TRANSFER") {
      const debited = await db.query(`UPDATE hz_wallets SET balance=balance-$3
        WHERE room_id=$1 AND user_id=$2 AND balance >= $3 RETURNING balance`, [roomId,from.id,coins]);
      if (!debited.rowCount) throw new Error("코인이 부족합니다.");
      await db.query(`INSERT INTO hz_coin_logs(room_id,user_id,type,amount,detail)
        VALUES($1,$2,'TRANSFER_OUT',$3,$4)`, [roomId,from.id,-coins,`받는 사람: ${to.name} (${to.id})`]);
    }
    const credited = await db.query(`UPDATE hz_wallets SET balance=balance+$3
      WHERE room_id=$1 AND user_id=$2 AND balance <= 9223372036854775807::bigint-$3 RETURNING balance`, [roomId,to.id,coins]);
    if (!credited.rowCount) throw new Error("받는 사람의 잔액 한도를 초과했습니다.");
    await db.query(`INSERT INTO hz_coin_logs(room_id,user_id,type,amount,detail)
      VALUES($1,$2,$3,$4,$5)`, [roomId,to.id,kind === "GRANT" ? "ADMIN_GRANT" : "TRANSFER_IN",coins,`${kind === "GRANT" ? "관리자" : "보낸 사람"}: ${from.name} (${from.id})`]);
    await db.query("COMMIT");
    return { recipientBalance: credited.rows[0].balance };
  } catch (e) {
    await db.query("ROLLBACK"); throw e;
  } finally { db.release(); }
}
async function history(roomId, userId) {
  const result = await getPool().query(`SELECT type,amount,detail,created_at FROM hz_coin_logs
    WHERE room_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 15`, [roomId,userId]);
  if (!result.rows.length) return "📜 코인 변동 내역이 없습니다. (초기 지급분은 제외)";
  return "📜 최근 코인 내역\n\n" + result.rows.map(r => {
    const sign = BigInt(r.amount) > 0n ? "+" : "";
    const time = new Date(r.created_at).toLocaleString("ko-KR", {timeZone:"Asia/Seoul"});
    return `${time}\n${r.type} ${sign}${fmt(r.amount)}코인\n${r.detail}`;
  }).join("\n\n");
}
async function handleCoinCommand({text,msg,roomId,chat}) {
  if (!/^!(코인|코인순위|코인내역|코인송금|코인지급|코인아이디)(?:\s|$)/.test(text)) return false;
  const say = s => chat.sendText(roomId,s);
  try {
    const me = sender(msg);
    const room = String(roomId);
    if (text === "!코인") {
      const bal = await getBalance(room,me.id,me.name);
      await say(`🪙 ${me.name}님의 코인\n잔액: ${fmt(bal)}코인`);
    } else if (text === "!코인순위") {
      await say(await coinRanking(room));
    } else if (text === "!코인내역") {
      await say(await history(room,me.id));
    } else if (text === "!코인아이디") {
      await say(`🔑 내 사용자 ID: ${me.id}\n관리자 설정용으로만 사용하고 공개 공유는 피하세요.`);
    } else if (text.startsWith("!코인송금 ") || text.startsWith("!코인지급 ")) {
      const grant = text.startsWith("!코인지급 ");
      if (grant) {
        const admins = String(process.env.HZ_ADMIN_IDS || "").split(",").map(s=>s.trim()).filter(Boolean);
        if (!admins.includes(me.id)) throw new Error("관리자만 코인을 지급할 수 있습니다. Railway의 HZ_ADMIN_IDS를 설정해 주세요.");
      }
      const parts = text.split(/\s+/);
      if (parts.length !== 3 || !parts[1].startsWith("@")) throw new Error(`사용법: !코인${grant ? "지급" : "송금"} @멘션 10000`);
      const coins = validAmount(parts[2]);
      const to = mentionTarget(msg);
      const result = await transfer({roomId:room,from:me,to,coins,kind:grant ? "GRANT" : "TRANSFER",messageId:messageKey(msg)});
      await say(`${grant ? "🎁 코인 지급 완료" : "💸 코인 송금 완료"}\n받는 사람: ${to.name}\n금액: ${fmt(coins)}코인\n받는 사람 잔액: ${fmt(result.recipientBalance)}코인`);
    } else {
      await say("사용법: !코인 / !코인순위 / !코인내역 / !코인송금 @멘션 금액 / !코인지급 @멘션 금액");
    }
  } catch (e) {
    console.error("[HZ 코인]",e);
    await say("❌ " + e.message);
  }
  return true;
}
module.exports = {initCoinExtra,handleCoinCommand};
