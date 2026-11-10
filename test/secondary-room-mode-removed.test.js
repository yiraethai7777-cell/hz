'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('retired secondary room-game handlers are removed while main game switch survives',()=>{
 const router=source('shared/router.js');
 for(const token of ['!방게임시작','!방게임종료','!방게임명령어','roomGameAliases','roomGameStyle',"'roomGame'"])
  assert.equal(router.includes(token),false,token);
 assert.match(router,/text === '!게임on' \|\| text === '!게임off'/);
 assert.match(router,/await game\.toggle\(context\)/);
 assert.match(router,/await game\.message\(/);
});

test('retired secondary room-management switch and aliases are removed',()=>{
 const commands=source('manage/commands-v2.js');
 for(const token of ['!방관리시작','!방관리종료','!방관리명령어','!방경고','!방강퇴','ROOM_HELP','ROOM_ALIASES','roomManageAlias',"'roomManage'"])
  assert.equal(commands.includes(token),false,token);
 assert.match(commands,/if\(!ctx\.isBotAccount&&!await enabled\(db,room\)\)/);
 // Standard NEXI management commands, privileges and roles must remain intact.
 for(const token of ['!관리on','!관리off','!경고','!kick','!삭제감지on','isRoomBotAdmin'])
  assert.ok(commands.includes(token),token);
});

test('join/leave notices cannot be triggered through removed room-management flag',()=>{
 const manage=source('manage/index.js');
 assert.equal(manage.includes("data->>'roomManage'"),false);
 assert.ok((manage.match(/if \(!await enabled\(room\)\) return;/g)||[]).length===2);
 for(const token of ['async function join(','async function leave('])
  assert.ok(manage.includes(token),token);
});
