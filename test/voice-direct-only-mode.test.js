'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');

test('live bot startup does not install any Android/Noa voice transport',()=>{
 const source=fs.readFileSync(path.join(root,'hz-new.js'),'utf8');
 assert.doesNotMatch(source,/require\(['"]\.\/shared\/voice-room-noa-bridge['"]\)/);
 assert.doesNotMatch(source,/installFromEnv\(client\)/);
 assert.match(source,/direct-only mode/);
});

test('admin web and API report Railway direct VOX instead of Noa state',()=>{
 const web=fs.readFileSync(path.join(root,'admin-web/admin.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'admin-web/index.html'),'utf8');
 const api=fs.readFileSync(path.join(root,'api/routes.js'),'utf8');
 assert.match(web,/직접 VOX 인증 연동/);
 assert.match(web,/Railway 직접 VOX 상태 확인/);
 assert.doesNotMatch(web,/Noa 브리지 설정|Android\/Noa 상태 확인/);
 assert.match(html,/직접 VOX 상태 확인/);
 assert.match(api,/mode:'vox30-direct'/);
});

test('unconfigured Railway voice adapter never calls a leftover Noa client',async()=>{
 const voice=require('../shared/voice-room');
 const client={voiceRoomAdapter:{kind:'noa-android-experimental',
  create:async()=>{throw Error('Legacy Noa must not be invoked');}}};
 assert.equal(voice.adapterOf(client),null);
});
