'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCore}=require('../core'),{createRoomModes}=require('../manage/room-modes'),{createMembership}=require('../manage/membership'),{createProfileWatch}=require('../manage/profile-watch'),{createDeleteWatch}=require('../manage/delete-watch'),{tableFor}=require('../database');
test('room modes preserve legacy defaults; authorized bulk management sets all six, gates commands, persists and isolates games',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-modes-')),out=[],dirty=[],cancelled=[];
 const send=async(r,t)=>{out.push(t);return {status:0,body:{logId:'9000'}};},botId=()=> '9000',onPersist=k=>dirty.push(k);
 let modes;const opts={dir,send,botId,onPersist,isEnabled:r=>modes.manage(r)};
 const membership=createMembership(opts),watcher=createProfileWatch(opts),deletion=createDeleteWatch({...opts,edit:async()=>({status:0})});
 try{
  modes=createRoomModes({dir,botId,onPersist,onManage:(r,on)=>{membership.setAll(r,on);watcher.setAll(r,on);deletion.setAll(r,on);},onGame:(r,on)=>{if(!on)cancelled.push(r);}});
  const core=createCore({send,canExecute:modes.allow});modes.register(core);membership.register(core);watcher.register(core);deletion.register(core);
  for(const [name,section] of [['테스트게임','GAME'],['테스트관리','MANAGEMENT'],['테스트봇','BOT'],['테스트기본','SYSTEM']])core.register({name,section,execute:()=>name});
  const cmd=(text,type=1,r='1000',u='3000')=>core.handle({roomId:r,userId:u,text,msg:{room:{id:r,isOpenChat:true},sender:{id:u,type,name:'회원'}}});
  assert.equal(modes.manage('1000'),true);assert.equal(modes.game('1000'),true);
  await cmd('-관리 off',2);assert.match(out.at(-1),/방장/);assert.equal(modes.manage('1000'),true);
  await cmd('-관리 on',4);assert.match(out.at(-1),/전체 활성화/);
  for(const filename of ['membership-settings.json','profile-watch-settings.json'])assert.deepEqual(Object.values(JSON.parse(fs.readFileSync(path.join(dir,filename)))['1000']),[true,true]);
  for(const filename of ['delete-watch-settings.json','edit-watch-settings.json'])assert.ok(JSON.parse(fs.readFileSync(path.join(dir,filename))).includes('1000'));
  await cmd('-닉변감지 off',4);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'profile-watch-settings.json')))['1000'].nick,false);
  await cmd('-관리 on',4);assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'profile-watch-settings.json')))['1000'].nick,true);
  await cmd('-관리 off');assert.equal(modes.manage('1000'),false);assert.equal(modes.game('1000'),true);
  assert.equal(await cmd('-테스트관리'),false);assert.equal(await cmd('-입장알림 on'),false);assert.equal(await cmd('-테스트게임'),true);assert.equal(await cmd('-테스트기본'),true);assert.equal(await cmd('-테스트봇'),true);
  assert.equal(modes.manage('2000'),true);
  await cmd('-게임 off',4);assert.deepEqual(cancelled,['1000']);assert.equal(await cmd('-테스트게임'),false);assert.equal(await cmd('-테스트게임',2,'2000'),true);
  const restored=createRoomModes({dir,botId});assert.equal(restored.manage('1000'),false);assert.equal(restored.game('1000'),false);assert.equal(tableFor('room-modes.json'),'duke_room_modes');assert.ok(dirty.includes('room-modes.json'));
  await cmd('-게임 on',2,'1000','9000');assert.equal(await cmd('-테스트게임'),true);assert.equal(modes.manage('1000'),false);
  await cmd('-관리 on',1);assert.equal(await cmd('-테스트관리'),true);
 }finally{watcher.stop();deletion.close();fs.rmSync(dir,{recursive:true,force:true});}
});
