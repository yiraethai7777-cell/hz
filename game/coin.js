"use strict";
const { getPool } = require("../shared/db");
const { ensureWallet, getBalance, coinRanking } = require("./wallet");
// Keep amounts as exact decimal strings from parsing through PostgreSQL NUMERIC.
const fmt = n => BigInt(String(n)).toLocaleString("ko-KR");
const ADMIN_GRANT_MAX = 1000000000n;
function validAmount(raw) {
  const input = String(raw ?? "");
  if (!/^[1-9]\d*$/.test(input)) throw new Error("금액은 1 이상의 정수로 입력해 주세요.");
  return input;
}
function sender(msg) {
  const id = msg.sender?.id;
  if (id === undefined || id === null) throw new Error("보낸 사람의 ID를 확인할 수 없습니다.");
  return { id: String(id), name: String(msg.sender?.name || "알 수 없음") };
}
function safeMentionId(v) {
  if (typeof v === "string" && /^\d{4,}$/.test(v)) return v;
  if (typeof v === "bigint" && v > 0n) return v.toString();
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 1000) return String(v);
  return "";
}
function exactMentionId(v) {
  if (v && typeof v === "object" && typeof v.value === "string") return safeMentionId(v.value);
  return safeMentionId(v);
}
function parseMentionAttachment(raw) {
  if (typeof raw === "string") {
    try { return require("lossless-json").parse(raw); } catch (_) { return null; }
  }
  return raw && typeof raw === "object" ? raw : null;
}
function mentionAttachmentRoots(msg) {
  const chatLog = msg.raw?.chatLog ?? msg.raw?.chatlog ?? msg.raw?.chat ?? msg.raw;
  const raw = [chatLog?.attachment, chatLog?.attachments, chatLog?.extra,
    msg.raw?.attachment, msg.message?.attachment,
    ...(Array.isArray(msg.attachmentsRaw) ? msg.attachmentsRaw : [])];
  return raw.map(parseMentionAttachment).filter(Boolean);
}
function mentionTarget(msg) {
  const found = [], seen = new Set();
  const roots = [msg.mentions, msg.message?.mentions, msg.message?.mentionList,
    msg.raw?.mentions, msg.raw?.chat?.mentions, ...mentionAttachmentRoots(msg)];
  function collect(v, context = false, depth = 0) {
    if (!v || depth > 5) return;
    if (Array.isArray(v)) { for (const x of v) collect(x, context, depth + 1); return; }
    if (typeof v !== "object") return;
    if (context) {
      const id = exactMentionId(v.userId ?? v.user_id ?? v.memberId ?? v.user?.id ?? v.id);
      if (id && !seen.has(id)) {
        seen.add(id);
        found.push({ id, name: String(v.name ?? v.nickname ?? v.nickName ?? v.displayName ?? "멘션 사용자").replace(/^@/, "") });
      }
    }
    for (const [key, val] of Object.entries(v)) {
      if (/mention/i.test(key)) collect(val, true, depth + 1);
    }
  }
  for (let i = 0; i < roots.length; i++) collect(roots[i], i < 5);
  if (found.length !== 1) throw new Error("카카오톡에서 한 사람을 실제로 멘션해 주세요. (인식: " + found.length + "명)");
  return found[0];
}
async function resolveCoinRecipient(roomId, target) {
  // A verified mention ID is mandatory; names never determine the recipient.
  const db = getPool();
  const fallback = String(target.name || "").trim();
  const placeholder = !fallback || fallback === "멘션 사용자";
  if (!placeholder) return target;
  // Existing wallet names are preferred. Old game tables are optional.
  const queries = [
    ["SELECT user_name AS name FROM hz_wallets WHERE room_id=$1 AND user_id=$2", [roomId, target.id]],
    ["SELECT name FROM hz_members WHERE room_id=$1 AND user_id=$2", [roomId, target.id]],
    ["SELECT name FROM hz_chat_stats WHERE room_id=$1 AND user_id=$2", [roomId, target.id]]
  ];
  for (const [sql, params] of queries) {
    try {
      const result = await db.query(sql, params);
      const name = String(result.rows[0]?.name || "").trim();
      if (name && name !== "멘션 사용자" && name !== "알 수 없음") {
        return { id: target.id, name };
      }
    } catch (e) {
      // Legacy tables may not exist in the new database.
      if (e.code !== "42P01" && e.code !== "42703") throw e;
    }
  }
  return target;
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
  await getPool().query(`CREATE TABLE IF NOT EXISTS hz_coin_reset_pending (
    room_id TEXT NOT NULL, actor_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(room_id,actor_id)
  )`);
  console.log("[HZ 코인] 송금 중복 방지 및 코인 초기화 테이블 준비 완료");
}
async function transfer({ roomId, from, to, coins, kind, messageId, unlimited = false }) {
  const all = kind === 'TRANSFER' && /^(?:all|전부|모두)$/i.test(String(coins));
  coins = all ? 'all' : validAmount(coins);
  if (!['TRANSFER','GRANT'].includes(kind)) throw new Error('올바르지 않은 거래 종류입니다.');
  // Preserve the existing 1-billion cap for administrator grants only.
  if (kind === 'GRANT' && BigInt(coins) > ADMIN_GRANT_MAX)
    throw new Error("한 번에 최대 10억 코인까지 지급할 수 있습니다.");
  if (!messageId) throw new Error("메시지 고유번호를 확인할 수 없어 안전하게 거래를 중단했습니다.");
  if (from.id === to.id) throw new Error("자기 자신에게 송금하거나 지급할 수 없습니다.");
  const db = await getPool().connect();
  try {
    await db.query("BEGIN");
    // Serialize transfers and room-wide resets with game actions locking hz_rooms.
    await db.query("INSERT INTO hz_rooms(room_id,data) VALUES($1,'{}'::jsonb) ON CONFLICT DO NOTHING",[roomId]);
    await db.query("SELECT room_id FROM hz_rooms WHERE room_id=$1 FOR UPDATE",[roomId]);
    const dedup = await db.query(`INSERT INTO hz_coin_operations(room_id,message_id,operation)
      VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING message_id`, [roomId, messageId, kind]);
    if (!dedup.rowCount) throw new Error("이미 처리된 메시지입니다.");
    // Lock both wallets in stable order to avoid deadlocks between simultaneous transfers.
    const users = [from, to].sort((a,b) => a.id.localeCompare(b.id));
    for (const u of users) await ensureWallet(db, roomId, u.id, u.name);
    for (const u of users) await db.query(`SELECT balance FROM hz_wallets
      WHERE room_id=$1 AND user_id=$2 FOR UPDATE`, [roomId,u.id]);
    if (all) {
      const current = await db.query("SELECT balance FROM hz_wallets WHERE room_id=$1 AND user_id=$2",[roomId,from.id]);
      coins = String(current.rows[0]?.balance ?? '0');
      if (BigInt(coins) <= 0n) throw new Error("송금할 코인이 없습니다.");
      // ALL always transfers the sender's actual wallet balance, even for bot accounts.
      unlimited = false;
    }
    if (kind === "TRANSFER" && !unlimited) {
      const debited = await db.query(`UPDATE hz_wallets SET balance=balance-$3::numeric
        WHERE room_id=$1 AND user_id=$2 AND balance >= $3::numeric RETURNING balance`, [roomId,from.id,coins]);
      if (!debited.rowCount) throw new Error("코인이 부족합니다.");
      await db.query(`INSERT INTO hz_coin_logs(room_id,user_id,type,amount,detail)
        VALUES($1,$2,'TRANSFER_OUT',$3::numeric,$4)`, [roomId,from.id,(-BigInt(coins)).toString(),`받는 사람: ${to.name} (${to.id})`]);
    }
    const credited = await db.query(`UPDATE hz_wallets SET balance=balance+$3::numeric
      WHERE room_id=$1 AND user_id=$2 RETURNING balance`, [roomId,to.id,coins]);
    if (!credited.rowCount) throw new Error("받는 사람의 지갑을 확인할 수 없습니다.");
    await db.query(`INSERT INTO hz_coin_logs(room_id,user_id,type,amount,detail)
      VALUES($1,$2,$3,$4,$5)`, [roomId,to.id,kind === "GRANT" ? "ADMIN_GRANT" : "TRANSFER_IN",coins,`${kind === "GRANT" ? "관리자" : "보낸 사람"}: ${from.name} (${from.id})`]);
    await db.query("COMMIT");
    return { recipientBalance: credited.rows[0].balance, amount:coins };
  } catch (e) {
    await db.query("ROLLBACK"); throw e;
  } finally { db.release(); }
}
async function requestCoinReset(roomId,actorId) {
  const room=String(roomId), actor=String(actorId);
  await getPool().query(`INSERT INTO hz_coin_reset_pending(room_id,actor_id,expires_at)
    VALUES($1,$2,NOW()+INTERVAL '60 seconds')
    ON CONFLICT(room_id,actor_id) DO UPDATE SET expires_at=EXCLUDED.expires_at`,[room,actor]);
}

async function resetRoomCoins({roomId,actorId,messageId}) {
  const room=String(roomId),actor=String(actorId);
  if (!messageId) throw new Error("메시지 고유번호를 확인할 수 없습니다.");
  const db=await getPool().connect();
  try {
    await db.query("BEGIN");
    // The same room lock used by the game engine protects legacy points from racing.
    await db.query("INSERT INTO hz_rooms(room_id,data) VALUES($1,'{}'::jsonb) ON CONFLICT DO NOTHING",[room]);
    const roomRow=await db.query("SELECT data FROM hz_rooms WHERE room_id=$1 FOR UPDATE",[room]);
    const pending=await db.query(`SELECT (expires_at>NOW()) AS active FROM hz_coin_reset_pending
      WHERE room_id=$1 AND actor_id=$2 FOR UPDATE`,[room,actor]);
    if (!pending.rows[0]?.active)
      throw new Error("초기화 확인 시간이 만료되었거나 신청 내역이 없습니다. !코인초기화를 다시 입력해 주세요.");
    const dedup=await db.query(`INSERT INTO hz_coin_operations(room_id,message_id,operation)
      VALUES($1,$2,'ROOM_RESET') ON CONFLICT DO NOTHING RETURNING message_id`,[room,String(messageId)]);
    if (!dedup.rowCount) throw new Error("이미 처리된 메시지입니다.");
    // Lock all existing wallets before reading balances: the reset logs and
    // resulting zero balances must describe the same committed snapshot.
    await db.query("SELECT user_id FROM hz_wallets WHERE room_id=$1 ORDER BY user_id FOR UPDATE",[room]);
    const stats=await db.query(`SELECT COUNT(*)::integer AS holders, COALESCE(SUM(balance),0)::text AS total
      FROM hz_wallets WHERE room_id=$1 AND balance<>0`,[room]);
    await db.query(`INSERT INTO hz_coin_logs(room_id,user_id,type,amount,detail)
      SELECT room_id,user_id,'ROOM_RESET',-balance,'방 코인 전체 초기화 · 실행자: '||$2
      FROM hz_wallets WHERE room_id=$1 AND balance<>0`,[room,actor]);
    await db.query("UPDATE hz_wallets SET balance=0 WHERE room_id=$1 AND balance<>0",[room]);
    // Clear the legacy cached points to prevent old game values being shown or
    // re-migrated after the reset. Other player inventory/status is untouched.
    const data=roomRow.rows[0]?.data;
    if (data && data.players && typeof data.players==='object' && !Array.isArray(data.players)) {
      for (const player of Object.values(data.players)) {
        if (player && typeof player==='object') player.points=0;
      }
      await db.query("UPDATE hz_rooms SET data=$2::jsonb,updated_at=NOW() WHERE room_id=$1",
        [room,JSON.stringify(data)]);
    }
    await db.query("DELETE FROM hz_coin_reset_pending WHERE room_id=$1",[room]);
    await db.query("COMMIT");
    return {holders:Number(stats.rows[0].holders),total:String(stats.rows[0].total)};
  } catch(error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {db.release();}
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
async function handleCoinCommand({text,msg,roomId,chat,isBotAccount=false,isSuperAdmin=false}) {
  if (!/^#(코인순위|코인내역|코인송금|코인지급|코인아이디|코인초기화)(?:\s|$)/.test(text)) return false;
  const say = s => chat.sendText(roomId,s);
  try {
    const me = sender(msg);
    const room = String(roomId);
    if (text === "#코인순위") {
      await say(await coinRanking(room));
    } else if (text === "#코인내역") {
      await say(await history(room,me.id));
    } else if (text === "#코인아이디") {
      await say(`🔑 내 사용자 ID: ${me.id}\n관리자 설정용으로만 사용하고 공개 공유는 피하세요.`);
    } else if (/^#코인초기화(?:\s|$)/.test(text)) {
      const authorized=isBotAccount||isSuperAdmin||
        await require('../shared/super-admin').isSuperAdmin(room,me.id);
      if (!authorized) throw new Error("봇 계정 또는 이 방의 최고관리자만 코인을 초기화할 수 있습니다.");
      if (text==="#코인초기화") {
        await requestCoinReset(room,me.id);
        await say("⚠️ 카카오톡 게임 매니저 | 코인 전체 초기화\n이 채팅방의 모든 사용자 코인 잔액을 0으로 변경합니다.\n다른 방의 코인·아이템·포켓몬은 유지됩니다.\n\n60초 안에 !코인초기화 확인 을 입력해야 실행됩니다.");
      } else if (text==="#코인초기화 확인") {
        const result=await resetRoomCoins({roomId:room,actorId:me.id,messageId:messageKey(msg)});
        await say("✅ 카카오톡 게임 매니저 | 코인 초기화 완료\n초기화한 방: 현재 채팅방\n대상 사용자: "+result.holders+"명\n초기화 금액: "+fmt(result.total)+"코인\n전체 잔액: 0코인");
      } else if (text==="#코인초기화 취소") {
        await getPool().query("DELETE FROM hz_coin_reset_pending WHERE room_id=$1 AND actor_id=$2",[room,me.id]);
        await say("✅ 코인 초기화 요청을 취소했습니다.");
      } else {
        throw new Error("사용법: !코인초기화 → !코인초기화 확인 (60초 이내)");
      }
    } else if (text.startsWith("#코인송금 ") || text.startsWith("#코인지급 ")) {
      const grant = text.startsWith("#코인지급 ");
      if (grant) {
        const admins = String(process.env.HZ_ADMIN_IDS || "").split(",").map(s=>s.trim()).filter(Boolean);
        const owners=String(process.env.HZ_OWNER_IDS||process.env.HZ_OWNER_ID||'').split(/[\s,;]+/);
        if (!isBotAccount&&!isSuperAdmin&&!admins.includes(me.id)&&!owners.includes(me.id)) throw new Error("관리자만 코인을 지급할 수 있습니다.");
      }
      const match = /^#코인(?:송금|지급)\s+@.+\s+(\S+)$/.exec(text);
      if (!match) throw new Error(`사용법: !코인${grant ? "지급" : "송금"} (@멘션) (금액)`);
      const amountText=String(match[1]);
      const all=!grant && /^(?:all|전부|모두)$/i.test(amountText);
      const coins=all ? 'all' : validAmount(amountText);
      const to = await resolveCoinRecipient(room, mentionTarget(msg));
      await require('./economy').ensureLinked(room,to.id,to.name);
      const result = await transfer({roomId:room,from:me,to,coins,kind:grant ? "GRANT" : "TRANSFER",messageId:messageKey(msg),unlimited:isBotAccount});
      await say(`${grant ? "🎁 코인 지급 완료" : "💸 코인 송금 완료"}\n받는 사람: ${to.name}\n금액: ${fmt(result.amount)}코인\n받는 사람 잔액: ${fmt(result.recipientBalance)}코인`);
    } else {
      await say("사용법: !정보\n!코인순위\n!코인내역\n!코인송금 (@멘션) (금액 또는 all)\n!코인지급 (@멘션) (금액)\n!코인초기화 (최고관리자 전용)");
    }
  } catch (e) {
    console.error("[HZ 코인]",e);
    await say("❌ " + e.message);
  }
  return true;
}
module.exports = {initCoinExtra,handleCoinCommand,validAmount,mentionTarget,messageKey,transfer,requestCoinReset,resetRoomCoins};
