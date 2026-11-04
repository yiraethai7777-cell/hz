'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
test('all three Kakao command-block operations require bot or room super-admin',()=>{
 const source=read('manage/commands-v2.js');
 const start=source.indexOf("if(cmd==='!차단'||cmd==='!차단해제'||cmd==='!차단목록')");
 assert.ok(start>=0);
 const body=source.slice(start,start+450);
 assert.match(body,/if\(!ctx\.isBotAccount&&!isSuperAdmin\)/);
 assert.doesNotMatch(body,/isStaff\(/);
});
test('ordinary room managers and customers cannot use customer web command block API',()=>{
 const source=read('api/room-portal.js');
 const start=source.indexOf("if(p==='/api/room-portal/command-blocks')");
 assert.ok(start>=0);
 assert.match(source.slice(start,start+220),/403/);
 assert.doesNotMatch(source.slice(start,start+220),/blocks\.set/);
});
test('master web command blocking remains available to authenticated admin',()=>{
 const source=read('api/routes.js');
 assert.match(source,/p==='\/api\/admin\/command-blocks'/);
 assert.match(source,/actorId:'master:'\+s\.user/);
});
