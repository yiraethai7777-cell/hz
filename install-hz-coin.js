"use strict";
const fs = require("fs");
const file = "hz-new.js";
let src = fs.readFileSync(file,"utf8");
if (!src.includes('const { initWallet, getBalance } = require("./hz-wallet");')) {
  throw new Error("hz-new.js 구조가 예상과 다릅니다. 원본은 수정하지 않았습니다.");
}
if (src.includes("handleCoinCommand")) {
  console.log("이미 코인 기능이 설치되어 있습니다."); process.exit(0);
}
const backup = `hz-new.js.before-coin-${Date.now()}.bak`;
const imports = 'const { initCoinExtra, handleCoinCommand } = require("./hz-coin-extra");\n';
src = src.replace('const { initWallet, getBalance } = require("./hz-wallet");',imports + 'const { initWallet, getBalance } = require("./hz-wallet");');
const initAt = '  initWallet()';
if (!src.includes(initAt)) throw new Error("코인 초기화 위치를 찾지 못했습니다.");
src = src.replace(initAt, '  initCoinExtra().catch(err => console.error("[HZ 코인] 추가 초기화 실패:", err));\n\n' + initAt);
const filterAt = 'if (!["!핑", "!명령어", "!출석", "!출석순위", "!코인"].includes(text)';
if (!src.includes(filterAt)) throw new Error("명령어 필터를 찾지 못했습니다.");
src = src.replace(filterAt, 'if (!/^!(코인|코인순위|코인내역|코인송금|코인지급|코인아이디)(?:\\s|$)/.test(text) && !["!핑", "!명령어", "!출석", "!출석순위", "!코인"].includes(text)');
const tryAt = '  try {\n';
const start = src.indexOf('client.onMessage(');
const at = src.indexOf(tryAt,start);
if (at < 0) throw new Error("명령어 처리 위치를 찾지 못했습니다.");
src = src.slice(0,at) + src.slice(at).replace(tryAt,'  try {\n    if (await handleCoinCommand({ text, msg, roomId, chat })) return;\n');
fs.writeFileSync(backup,fs.readFileSync(file));
fs.writeFileSync(file,src);
console.log("설치 완료. 백업:",backup);
