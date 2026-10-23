'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {PNG}=require('pngjs');
const {sendPng}=require('../manage/attendance-image/send');
const {createService}=require('../manage/attendance-image/preview');
const png=()=>PNG.sync.write(new PNG({width:1,height:1}));
test('photo adapter uses the existing sendPhoto path and cleans its private file after success and failure',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'photo-test-')),paths=[];
 try{
  const client={connected:true,sendPhoto:async(room,file,options)=>{assert.equal(room,'12345');assert.deepEqual(await fs.readFile(file),png());assert.match(options.text,/테스트/);paths.push(file);return {complete:{status:0},msgId:1};}};
  assert.equal((await sendPng(client,'12345',png(),{tempRoot:root})).confirmed,true);
  assert.deepEqual(await fs.readdir(root),[]);
  client.sendPhoto=async(room,file)=>{paths.push(file);throw Error('upload failed');};
  await assert.rejects(()=>sendPng(client,'12345',png(),{tempRoot:root}),/upload failed/);assert.deepEqual(await fs.readdir(root),[]);
  client.sendPhoto=async()=>({});await assert.rejects(()=>sendPng(client,'12345',png(),{tempRoot:root}),/완료/);assert.deepEqual(await fs.readdir(root),[]);
  assert.notEqual(paths[0],paths[1]);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('preview sends only to one exact test room, with confirmation, connection checks and a cooldown',async()=>{
 let sends=0,clock=100000,rendered;const service=createService({now:()=>clock,render:async data=>{rendered=data;return png();},deliver:async(client,room)=>{assert.equal(room,'9007199254740993123');sends++;return {confirmed:true};}});
 const client={connected:true,getKnownChatRooms:()=>[{id:'9007199254740993123',name:'테스트'},{id:'1',name:'운영방'}]};
 await assert.rejects(()=>service(client,{}),/확인/);assert.equal(sends,0);
 assert.deepEqual(await service(client,{confirm:true}),{confirmed:true,roomName:'테스트'});assert.equal(sends,1);assert.equal(rendered.name,'이미지 전송 테스트');assert.equal(rendered.reward,'30000');
 await assert.rejects(()=>service(client,{confirm:true}),/60초/);clock+=60001;
 client.getKnownChatRooms=()=>[{id:'1',name:'테스트'},{id:'2',name:'테스트'}];await assert.rejects(()=>service(client,{confirm:true}),/여러/);assert.equal(sends,1);
 client.getKnownChatRooms=()=>[{id:'1',name:'다른방'}];await assert.rejects(()=>service(client,{confirm:true}),/찾을 수/);assert.equal(sends,1);
 client.connected=false;await assert.rejects(()=>service(client,{confirm:true}),/연결/);
});
test('preview refuses concurrent sends and does not retry after an upload error',async()=>{
 let release,sends=0;const service=createService({render:()=>new Promise(r=>release=()=>r(png())),deliver:async()=>{sends++;throw Error('failed');}});
 const client={connected:true,getKnownChatRooms:()=>[{id:'123',name:'테스트'}]};
 const first=service(client,{confirm:true});await new Promise(r=>setImmediate(r));await assert.rejects(()=>service(client,{confirm:true}),/60초|전송 중/);release();await assert.rejects(()=>first,/failed/);assert.equal(sends,1);
 await assert.rejects(()=>service(client,{confirm:true}),/60초/);assert.equal(sends,1);
});
test('preview HTTP action requires an admin session and CSRF before invoking any sender',async()=>{
 const auth=require('../api/auth'),preview=require('../manage/attendance-image/preview'),{routes,status}=require('../api/routes');
 const saved={session:auth.session,csrf:auth.csrf,send:preview.sendTest,ready:status.ready,client:status.client};let sends=0;
 const request={method:'POST'},url=new URL('http://localhost/api/admin/attendance-image-test');
 try{
  status.ready=true;status.client={test:true};preview.sendTest=async(client,input)=>{assert.equal(client,status.client);assert.equal(input.confirm,true);sends++;return {confirmed:true};};
  auth.session=async()=>null;await assert.rejects(()=>routes(request,{},url,{confirm:true}),e=>e.status===401);assert.equal(sends,0);
  auth.session=async()=>({user:'admin'});auth.csrf=()=>{const e=Error('CSRF');e.status=403;throw e;};await assert.rejects(()=>routes(request,{},url,{confirm:true}),e=>e.status===403);assert.equal(sends,0);
  auth.csrf=()=>{};assert.equal((await routes(request,{},url,{confirm:true})).confirmed,true);assert.equal(sends,1);
 }finally{auth.session=saved.session;auth.csrf=saved.csrf;preview.sendTest=saved.send;status.ready=saved.ready;status.client=saved.client;}
});
