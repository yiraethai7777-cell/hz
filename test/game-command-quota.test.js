'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const quota=require('../shared/game-rate-limit');

test('only player game commands count; bot, management, help, status do not',()=>{
 for(const cmd of [
  '!낚시','!어망','!물고기판매 전체','!물고기전송 @사람 이름 1',
  '!채굴','!농장','!퀴즈','!정답 서울','!타자게임','!게임가입',
  '!코인송금 2 100','!펫강화','!상점'
 ])assert.equal(quota.isGameCommand(cmd),true,cmd);
 for(const cmd of [
  '!핑','!정보','!게임on','!게임off','!게임상태','!게임정보',
  '!치트 1000','!회수','!초기화','!게임초기화','!코인지급',
  '!퀴즈작동','!낚시중지','!랭킹공개','!경고 @사람 테스트',
  '!관리명령어','!게임명령어','!출석','!도배시작',
  '#낚시','안녕하세요','네','아니요'
 ])assert.equal(quota.isGameCommand(cmd),false,cmd);
});

test('first five commands in 60 seconds pass; sixth blocks exactly five minutes',()=>{
 let time=100000;
 const limiter=quota.createLimiter({now:()=>time});
 for(let i=1;i<=5;i++){
  const r=limiter.check('room-a','user-a','msg-'+i);
  assert.equal(r.allowed,true,'command '+i);
  assert.equal(r.remaining,5-i);
 }
 const banned=limiter.check('room-a','user-a','msg-6');
 assert.deepEqual(banned,{allowed:false,notify:true,blocked:true,retryAfterMs:300000});
 time+=50000;
 const again=limiter.check('room-a','user-a','msg-7');
 assert.equal(again.allowed,false);
 assert.equal(again.notify,false,'no repeated warning');
 assert.equal(again.retryAfterMs,250000);
 time+=249999;
 assert.equal(limiter.check('room-a','user-a','msg-8').allowed,false);
 time+=1;
 assert.equal(limiter.check('room-a','user-a','msg-9').allowed,true,'ban ends on schedule even after spam');
});

test('rolling minute window slides; a message at +60 seconds can replace an old hit',()=>{
 let time=1000000;
 const limiter=quota.createLimiter({now:()=>time});
 for(let i=0;i<5;i++)assert.equal(limiter.check('r','u',String(i)).allowed,true);
 time+=60000;
 assert.equal(limiter.check('r','u','new').allowed,true);
 assert.equal(limiter.check('r','u','new2').allowed,true);
});

test('room and user quotas are isolated and one duplicate log ID cannot double charge',()=>{
 let time=500000;
 const limiter=quota.createLimiter({now:()=>time});
 assert.equal(limiter.check('room1','user1','log1').allowed,true);
 const dup=limiter.check('room1','user1','log1');
 assert.equal(dup.allowed,false);
 assert.equal(dup.duplicate,true);
 assert.equal(dup.notify,false);
 for(let i=2;i<=5;i++)assert.equal(limiter.check('room1','user1','log'+i).allowed,true);
 assert.equal(limiter.check('room1','user1','log6').blocked,true);
 assert.equal(limiter.check('room1','user2','log6').allowed,true);
 assert.equal(limiter.check('room2','user1','log6').allowed,true);
});

test('limiter expires inactive user counters opportunistically without background jobs',()=>{
 let time=60000;
 const limiter=quota.createLimiter({now:()=>time});
 for(let i=0;i<20;i++)limiter.check('r','u'+i,'m');
 assert.equal(limiter.activeUsers(),20);
 time+=61000;
 limiter.check('r','new','m');
 assert.equal(limiter.activeUsers(),1);
});

test('game quota gate is before game processing, with a bot-account exception',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../shared/router.js'),'utf8');
 const quotaGate=source.indexOf("!isBotAccount&&senderId!=null&&gameRateLimit.isGameCommand(text)");
 const nextCall=source.indexOf('await game.message(');
 assert.ok(quotaGate>0&&nextCall>quotaGate);
 assert.ok(source.includes('if(quota.notify)await chat.sendText(roomId,gameRateLimit.NOTICE)'));
});

test('game help includes the per-user limit without changing management help',()=>{
 const {formatCommandHelp}=require('../shared/help');
 assert.match(formatCommandHelp({game:true,manage:true},'게임'),/1분 5회까지, 6번째부터 5분간 제한/);
 assert.doesNotMatch(formatCommandHelp({game:true,manage:true},'관리'),/1분 5회까지/);
});
