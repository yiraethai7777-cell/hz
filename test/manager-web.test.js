'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const sites=[
 ['admin-web/index.html','admin-web/admin.js'],
 ['admin-web/room-portals.html','admin-web/room-portals.js'],
 ['room-panel/index.html','room-panel/app.js'],
 ['public-web/index.html','public-web/app.js']
];
test('all three web roles have distinct branded pages',()=>{
 const master=read('admin-web/index.html'),issuer=read('admin-web/room-portals.html');
 const room=read('room-panel/index.html'),publicHome=read('public-web/index.html');
 for(const html of [master,issuer,room,publicHome]){
  assert.match(html,/카카오톡 매니저/);
  assert.doesNotMatch(html,/\bNEXI\b/);
 }
 assert.match(issuer,/id="permissions"/);
 assert.match(room,/id="memberDialog"/);
 assert.match(publicHome,/id="management"/);
 assert.match(room,/room-panel\/style\.css/);
 assert.match(master,/admin\/manager\.css/);
 assert.match(publicHome,/manager-home\.css/);
});
test('each website uses valid JavaScript and its required elements exist',()=>{
 for(const [htmlPath,jsPath] of sites){
  const html=read(htmlPath),js=read(jsPath);
  new vm.Script(js,{filename:jsPath});
  const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
  for(const match of js.matchAll(/\$\(['"]#([\w-]+)['"]\)/g)){
   assert.ok(ids.has(match[1]),jsPath+' references missing #'+match[1]);
  }
 }
});
test('the web server registers independent master, room and public assets',()=>{
 const server=read('api/server.js');
 for(const uri of ['/admin','/admin/room-portals','/room-panel','/manager-home.css','/admin/manager.css']){
  assert.ok(server.includes(uri),uri+' must be served');
 }
});
test('scoped actions require a room portal session, permission, and explicit kick confirmation',()=>{
 const api=read('api/room-portal.js');
 new vm.Script(api,{filename:'api/room-portal.js'});
 for(const name of ['notes','kick','game','quiz','fishing'])assert.ok(api.includes("'"+name+"'"));
 assert.match(api,/sessionCandidate\?\.slug===requestedSite/);
 assert.match(api,/allowed\(s,'notes'\)/);
 assert.match(api,/allowed\(s,'kick'\)/);
 assert.match(api,/body\.confirm!=='KICK_CONFIRMED'/);
 assert.match(api,/member\.type/);
 assert.match(api,/isSuperAdmin\(s\.room_id,user\)/);
 assert.match(api,/gl_room_portal_notes/);
 assert.match(api,/csrf/i);
});
test('room game flags trigger fast-quiz in-memory refresh after database changes',()=>{
 const api=read('api/room-portal.js');
 const session=read('shared/session.js');
 const runtime=read('shared/runtime.js');
 assert.match(api,/syncQuizRoom\(room\)/);
 assert.match(session,/async function refreshQuizRoom\(roomId\)/);
 assert.match(runtime,/async function syncQuizRoom\(room\)/);
});
