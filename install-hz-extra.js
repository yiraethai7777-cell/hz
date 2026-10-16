"use strict";
// Run inside ~/hz. Backups are created automatically; legacy hz-bot.js is untouched.
const fs=require("fs");
const path=require("path");
const target=path.resolve("start.js");
if(!fs.existsSync(target)||!fs.existsSync("hz-extra-commands.js"))throw Error("~/hz에서 실행하고 추가 모듈이 있는지 확인하세요.");
let src=fs.readFileSync(target,"utf8");
if(src.includes("attachExtraCommands(client)")){
  console.log("이미 설치되어 있습니다.");process.exit(0);
}
const anchor='const { attachHZBot } = require("./hz-bot");';
const old='    const info = await attachHZBot(client);';
if(!src.includes(anchor)||!src.includes(old))throw Error("start.js 형식이 예상과 달라 수정을 중단했습니다.");
src=src.replace(anchor,anchor+'\nconst { attachExtraCommands } = require("./hz-extra-commands");');
src=src.replace(old,`    // Suppress only the legacy !명령어 reply so our compact reply is not duplicated.
    // Other legacy commands remain unchanged.
    const register = client.onMessage;
    client.onMessage = function (handler) {
      return register.call(this, async (...args) => {
        const msg = args.length === 1 ? args[0] : args[1];
        const command = String(msg?.message?.text ?? msg?.text ?? "").trim();
        if (command === "!명령어") return;
        return handler(...args);
      });
    };
    let info;
    try {
      info = await attachHZBot(client);
    } finally {
      client.onMessage = register;
    }
    await attachExtraCommands(client);`);
const backup=target+".before-extra-"+new Date().toISOString().replace(/[:.]/g,"-")+".bak";
fs.copyFileSync(target,backup);
fs.writeFileSync(target,src,"utf8");
console.log("설치 준비 완료:",target);
console.log("원본 백업:",backup);
