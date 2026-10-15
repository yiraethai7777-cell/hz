"use strict";
const fs = require("fs");
const path = require("path");
const root = __dirname;
const attendance = path.join(root, "hz-attendance.js");
const coin = path.join(root, "hz-coin-extra.js");
const replacement = path.join(root, "hz-attendance.updated.js");
if (!fs.existsSync(coin) || !fs.existsSync(attendance) || !fs.existsSync(replacement)) {
  throw new Error("필요한 파일이 없습니다. 압축의 두 JS 파일을 hz 폴더에 넣어 주세요.");
}
const old = fs.readFileSync(coin, "utf8");
const marker = "const to = mentionTarget(msg);";
if (!old.includes(marker)) throw new Error("현재 코인 파일의 멘션 호출 구조가 예상과 달라 수정하지 않았습니다.");
if (old.includes("async function resolveCoinRecipient(")) throw new Error("이미 닉네임 수정이 적용되어 있습니다.");
const resolver = `async function resolveCoinRecipient(roomId, target) {
  // A verified mention ID is mandatory; names never determine the recipient.
  const db = getPool();
  const fallback = String(target.name || "").trim();
  const placeholder = !fallback || fallback === "멘션 사용자";
  if (!placeholder) return target;
  // Existing wallet names are preferred. Old HZ BOT tables are optional.
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
`;
const point = "function messageKey(msg) {";
if (!old.includes(point)) throw new Error("코인 파일에서 함수 삽입 위치를 찾지 못했습니다.");
const updated = old.replace(point, resolver + "\n" + point)
  .replace(marker, "const to = await resolveCoinRecipient(room, mentionTarget(msg));");
// Validate both modules before touching existing files.
const vm = require("vm");
new vm.Script(updated, { filename: "hz-coin-extra.js" });
const newAttendance = fs.readFileSync(replacement, "utf8");
new vm.Script(newAttendance, { filename: "hz-attendance.js" });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.copyFileSync(coin, coin + ".before-three-" + stamp + ".bak");
fs.copyFileSync(attendance, attendance + ".before-three-" + stamp + ".bak");
fs.writeFileSync(coin, updated);
fs.writeFileSync(attendance, newAttendance);
console.log("수정 완료: 송금 닉네임, 출석 디자인, 연속 출석 코인 보상");
console.log("기존 파일 백업 완료. 기존 데이터베이스는 변경하지 않았습니다.");
