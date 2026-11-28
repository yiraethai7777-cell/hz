'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCore}=require('../core'),{registerValorant}=require('../valorant/register');
test('Valorant help, usage and missing configuration',async()=>{
 const messages=[],core=createCore({send:async(r,t)=>messages.push(t)});
 registerValorant(core,{env:{}});
 await core.handle({roomId:'1',userId:'10',text:'-도움말'});
 assert.match(messages.at(-1),/\[ 발로란트 명령어 \][\s\S]*-발로전적/);
 assert.equal(messages.at(-1).split('-발로전적').length,2);
 await core.handle({roomId:'1',userId:'10',text:'-발로전적'});
 assert.match(messages.at(-1),/사용법: -발로전적/);
 await core.handle({roomId:'1',userId:'10',text:'-발로전적 Player#KR1'});
 assert.match(messages.at(-1),/전적 조회 서비스를 사용할 수 없습니다/);
});
test('Valorant cooldown is per user across rooms, and allows another user',async()=>{
 const messages=[],requests=[],core=createCore({send:async(r,t)=>messages.push(t)});
 registerValorant(core,{env:{HENRIKDEV_API_KEY:'test-key'},fetcher:async(url,opts)=>{
  requests.push(url);
  assert.equal(opts.headers.Authorization,'test-key');
  return {ok:true,json:async()=>({status:200,data:url.includes('/matches/')?[]:{account_level:12}})};
 }});
 const call=(roomId,userId,text='-발로전적 Tester#KR1')=>core.handle({roomId,userId,text});
 await call('1','100');
 assert.match(messages.at(-1),/DUKE|𝗗𝗨𝗞𝗘/);
 assert.equal(requests.length,4);
 await call('2','100','-발로전적 Other#KR1');
 assert.match(messages.at(-1),/전적 조회는 120초 후/);
 assert.equal(requests.length,4);
 await call('1','200');
 assert.match(messages.at(-1),/𝗗𝗨𝗞𝗘/);
 assert.equal(requests.length,4);
});

test('saved Riot IDs are durable, numbered, duplicate-safe, and private to the requesting user',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-valorant-')),keys=[],messages=[];
 const setup=()=>{const core=createCore({send:async(r,t)=>messages.push(t)});registerValorant(core,{dir,onPersist:k=>keys.push(k),env:{}});return core;};
 try{
  let core=setup();const call=(userId,text,roomId='1')=>core.handle({userId,text,roomId});
  await call('301','-발로저장 Player#KR1');assert.match(messages.at(-1),/계정을 저장하였습니다/);
  await call('301','-발로저장 player#kr1');assert.match(messages.at(-1),/이미 저장된/);
  await call('301','-발로저장 Second#AP1 ap');assert.match(messages.at(-1),/2\/20개/);
  await call('302','-발로저장');assert.match(messages.at(-1),/저장된 계정이 없습니다/);
  assert.equal(keys.length,2);assert.equal(keys[0],'valorant-accounts/301.json');
  core=setup();
  await call('301','-발로저장','2');assert.match(messages.at(-1),/1\. Player#KR1[\s\S]*2\. Second#AP1/);
  await call('302','-발로전적 1');assert.match(messages.at(-1),/저장된 계정 번호/);
  await call('301','-발로전적 2');assert.match(messages.at(-1),/전적 조회 서비스를 사용할 수 없습니다/);
  await call('301','-도움말');assert.match(messages.at(-1),/-발로저장 :/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
