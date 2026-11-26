'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createGameCooldowns}=require('../game/cooldowns'),{createQuiz}=require('../game/quiz'),{createTyping}=require('../game/typing'),{createCore}=require('../core'),{createRoomModes}=require('../manage/room-modes'),{tableFor}=require('../database');
test('cooldown settings are room and game scoped, permission checked, persistent and immediately enforced',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-cooldowns-'));let at=100;const out=[],dirty=[],botId=()=> '9000',send=async(r,t)=>{out.push(t);return {body:{logId:'9000'}};};
 const cfg=createGameCooldowns({dir,botId,onPersist:k=>dirty.push(k)}),modes=createRoomModes({botId});
 const core=createCore({send,clock:()=>at,canExecute:modes.allow});cfg.register(core);modes.register(core);
 const opts={send,now:()=>at,clock:()=>at,pick:n=>0,delay:()=>({}),clear:()=>{},logger:{log(){},error(){}}};
 const q=createQuiz({...opts,getCooldown:r=>cfg.get(r,'퀴즈')*1000}),t=createTyping({...opts,getCooldown:r=>cfg.get(r,'타자게임')*1000});q.register(core);t.register(core);
 const cmd=(text,type=1,r='1000',u='3000')=>core.handle({roomId:r,userId:u,text,receivedAt:at,msg:{room:{id:r,isOpenChat:true},sender:{id:u,type,name:'회원'},message:{type:1,logId:'8000'}}});
 try{
  assert.equal(cfg.get('1000','퀴즈'),30);assert.equal(cfg.get('1000','타자게임'),0);
  await cmd('-게임쿨타임 퀴즈 60',2);assert.match(out.at(-1),/방장/);assert.equal(cfg.get('1000','퀴즈'),30);
  await cmd('-게임쿨타임 퀴즈 60초',4);await cmd('-게임쿨타임 타자게임 10');assert.equal(cfg.get('1000','퀴즈'),60);assert.equal(cfg.get('1000','타자게임'),10);
  for(const bad of ['-1','86401','1.5','1e3']){await cmd('-게임쿨타임 퀴즈 '+bad);assert.match(out.at(-1),/사용법/);}
  assert.equal(cfg.get('1000','퀴즈'),60);assert.equal(cfg.get('2000','퀴즈'),30);
  await cmd('-퀴즈');q.cancel('1000');await cmd('-타자게임');t.cancel('1000');at+=5000;
  await cmd('-퀴즈');assert.match(out.at(-1),/55초 후/);await cmd('-타자게임');assert.match(out.at(-1),/5초 후/);
  await cmd('-게임쿨타임 퀴즈 0',2,'1000','9000');await cmd('-퀴즈');assert.match(out.at(-1),/QUIZ/);q.cancel('1000');
  at+=5000;await cmd('-타자게임');assert.match(out.at(-1),/TYPING/);t.cancel('1000');
  await cmd('-게임쿨타임');assert.match(out.at(-1),/퀴즈 : 없음 \(0초\)/);assert.match(out.at(-1),/타자게임 : 10초/);
  const restored=createGameCooldowns({dir,botId});assert.equal(restored.get('1000','퀴즈'),0);assert.equal(restored.get('1000','타자게임'),10);assert.equal(tableFor('game-cooldowns.json'),'duke_game_cooldowns');assert.ok(dirty.includes('game-cooldowns.json'));
  await cmd('-관리 off');await cmd('-게임 off');await cmd('-게임쿨타임 타자게임 20',4);assert.equal(cfg.get('1000','타자게임'),20);
 }finally{q.reset();t.reset();fs.rmSync(dir,{recursive:true,force:true});}
});
