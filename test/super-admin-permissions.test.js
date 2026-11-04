'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
function read(name){return fs.readFileSync(path.join(__dirname,'..',name),'utf8');}
test('power commands permit only bot account or room-scoped super-admin',()=>{
 const src=read('manage/commands-v2.js');
 const start=src.indexOf("if(cmd==='!봇켜기'||cmd==='!봇끄기')");
 assert.ok(start>=0);
 const rule=src.slice(start,start+450);
 assert.match(rule,/!ctx\.isBotAccount&&!isSuperAdmin/);
 assert.doesNotMatch(rule,/isStaff\(/);
});
test('Kakao chat no longer grants or revokes super-admins',()=>{
 const src=read('manage/commands-v2.js');
 assert.match(src,/if\(cmd==='!최고관리자추가'\|\|cmd==='!최고관리자삭제'\|\|cmd==='!최고관리자목록'\)\s*\{\s*\/\/ Super-admin membership is controlled exclusively/);
 assert.doesNotMatch(src,/superRole\.update\(/);
});
test('customer portal cannot modify super-admin through direct API',()=>{
 const api=read('api/room-portal.js');
 assert.match(api,/if\(role==='superAdmin'\)bad\(.+?,403\)/);
 assert.doesNotMatch(api,/require\('\.\.\/shared\/super-admin'\)\.update/);
 const ui=read('room-panel/app.js');
 assert.doesNotMatch(ui,/\['superAdmin','최고관리자',m\.superAdmin\]/);
});
test('authenticated master admin API retains super-admin updates',()=>{
 const api=read('api/routes.js');
 assert.match(api,/if\(p==='\/api\/admin\/super-admins'&&method==='POST'\)/);
 assert.match(api,/role\.update\(room,user,'web:'\+s\.user,action\)/);
});
