'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('bot power is per-room and defaults to enabled for legacy rooms',async()=>{
 const power=require('../shared/bot-power');
 const db={query:async(sql,args)=>({rows:[{enabled:args[0]==='10001'?'false':null}]})};
 assert.equal(await power.enabled('10001',db),false);
 assert.equal(await power.enabled('10002',db),true);
 assert.equal(await power.enabled('not-a-room',db),false);
});

test('router checks bot OFF before caching messages, prefixes, handlers and permits only !봇켜기',()=>{
 const s=read('shared/router.js');
 const gate=s.indexOf("if(power.rows[0]?.enabled==='false'&&text!=='!봇켜기')return;");
 assert.ok(gate>0);
 assert.ok(gate<s.indexOf('rememberMessage(roomId,msg,text);'));
 assert.ok(gate<s.indexOf('const prefixResult='));
 assert.ok(gate<s.indexOf('const blocks='));
});

test('independent deletion watch honors full bot switch before storing and sending',()=>{
 const entry=read('hz-new.js'),watch=read('manage/delete-watch.js');
 assert.match(entry,/if\(!await require\('\.\/shared\/bot-power'\)\.enabled\(roomId\)\)return;/);
 assert.match(watch,/if\(!await require\('\.\.\/shared\/bot-power'\)\.enabled\(room,db\)\)return false;/);
});

test('other independent jobs honor the per-room bot kill switch',()=>{
 assert.match(read('shared/session.js'),/if\(!await require\('\.\/bot-power'\)\.enabled\(rid,ctx\.pool\)\)return;/);
 assert.match(read('promotion/index.js'),/if\(!await require\('\.\.\/shared\/bot-power'\)\.enabled\(room\)\)return false;/);
 assert.match(read('manage/profile-watch.js'),/if\(!await require\('\.\.\/shared\/bot-power'\)\.enabled\(room,ctx\.pool\)\)return;/);
 assert.match(read('manage/mention-repeat.js'),/if\(!await require\('\.\.\/shared\/bot-power'\)\.enabled\(room\)\)return true;/);
 assert.match(read('manage/commands-v2.js'),/cancelForRoom\(room\)/);
});
