"use strict";
// One-time patch: replace mentionTarget in hz-coin-extra.js only.
const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "hz-coin-extra.js");
if (!fs.existsSync(file)) throw new Error("hz-coin-extra.js 파일을 같은 폴더에 넣어 주세요.");
const original = fs.readFileSync(file, "utf8");
const start = original.indexOf("function mentionTarget(msg) {");
const end = original.indexOf("function messageKey(msg) {", start);
if (start < 0 || end < 0 || end <= start) throw new Error("멘션 함수 위치를 찾지 못했습니다. 원본을 변경하지 않았습니다.");
const replacement = `function safeMentionId(v) {
  if (typeof v === "string" && /^\\d{4,}$/.test(v)) return v;
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
`;
const updated = original.slice(0, start) + replacement + original.slice(end);
const backup = file + ".before-mention-fix.bak";
if (!fs.existsSync(backup)) fs.copyFileSync(file, backup);
fs.writeFileSync(file, updated, "utf8");
console.log("멘션 수정 완료. 백업:", backup);
