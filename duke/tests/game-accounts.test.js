'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCore}=require('../core'),{createGameAccounts}=require('../game/accounts');
test('game enrollment is room scoped, persistent, exact ID, duplicate safe and open chat only',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-game-')),out=[],dirty=[],send=async(r,t)=>out.push(t);
 try{
  const opts={dir,botId:()=> '9000',now:()=>1700000000000,onPersist:k=>dirty.push(k)};
  let g=createGameAccounts(opts),core=createCore({send});g.register(core);
  const userId='18500479612113742';
  const cmd=(roomId='1000',u=userId,isOpenChat=true,text='-게임가입')=>core.handle({roomId,userId:u,text,msg:{room:{id:roomId,isOpenChat},sender:{name:'회원'}}});
  await cmd('1000',userId,false);assert.equal(g.get('1000',userId),null);
  await cmd('1000','9000');assert.equal(g.get('1000','9000').coins,10000);assert.match(out.at(-1),/가입이 완료/);
  await cmd('1000','9000');assert.equal(g.get('1000','9000').coins,10000);assert.match(out.at(-1),/이미 게임에 가입/);
  await cmd('1000',userId,true,'-게임가입 추가');assert.equal(g.get('1000',userId),null);
  await Promise.all([cmd(),cmd()]);assert.match(out.at(-2),/가입이 완료/);assert.match(out.at(-2),/보유 코인 : 10,000 코인/);assert.match(out.at(-1),/이미 게임에 가입/);
  assert.deepEqual(g.get('1000',userId),{joinedAt:1700000000000,coins:10000,inventory:{},name:'회원'});
  assert.deepEqual(dirty,['game-accounts/1000.json','game-accounts/1000.json']);
  g=createGameAccounts(opts);core=createCore({send});g.register(core);await cmd();assert.match(out.at(-1),/이미 게임에 가입/);
  await cmd('2000');assert.ok(g.get('2000',userId));assert.equal(dirty.length,3);
  await cmd('2000',userId,true,'-도움말');assert.match(out.at(-1),/-게임가입/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('wallet, room ranking and atomic transfer with replay protection, validation, reply and restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-coins-')),out=[],send=async(r,t)=>out.push(t);
 try{
  const opts={dir,getName:(r,u)=>u==='3000'?'보낸사람':u==='4000'?'받는사람':'다른회원',fetchMessage:async(r,l)=>({room:{id:r},message:{logId:l,type:1},sender:{id:'4000',name:'받는사람'}})};
  let g=createGameAccounts(opts),core=createCore({send});g.register(core);
  let log=8000;
  const cmd=(text,u='3000',extra={},r='1000')=>core.handle({roomId:r,userId:u,text,msg:{room:{id:r,isOpenChat:true},sender:{name:opts.getName(r,u)},message:{logId:String(++log),type:1},...extra}});
  await cmd('-지갑');assert.match(out.at(-1),/-게임가입/);
  await cmd('-게임가입');await cmd('-게임가입','4000');await cmd('-지갑');assert.match(out.at(-1),/10,000 코인/);assert.match(out.at(-1),/재산 순위 : 1위/);assert.match(out.at(-1),/\u200b{1200}/);assert.doesNotMatch(out.at(-1).split('\u200b'.repeat(1200))[0],/보유 코인|재산 순위/);
  const mention={mentions:[{userId:'4000',name:'받는사람'}]},request={...mention,message:{logId:'12345678901234567',type:1}};
  await cmd('-송금 @받는사람 5000','3000',request);assert.match(out.at(-1),/남은 잔액 : 5,000 코인/);assert.match(out.at(-1),/\u200b{1200}/);assert.doesNotMatch(out.at(-1).split('\u200b'.repeat(1200))[0],/보낸 사람|받는 사람|송금 금액|남은 잔액/);
  assert.equal(g.get('1000','3000').coins,5000);assert.equal(g.get('1000','4000').coins,15000);
  await cmd('-송금 @받는사람 5000','3000',request);assert.equal(g.get('1000','3000').coins,5000);
  for(const value of ['0','-1','1.5','1e3','9007199254740992','6000'])await cmd('-송금 @받는사람 '+value,'3000',mention);
  await cmd('-송금 @가짜 100','3000');await cmd('-송금 @본인 100','3000',{mentions:[{userId:'3000'}]});await cmd('-송금 @미가입 100','3000',{mentions:[{userId:'5000'}]});
  assert.equal(g.get('1000','3000').coins,5000);
  await cmd('-코인순위');assert.match(out.at(-1),/1위 \| 받는사람 : 15,000 코인/);assert.match(out.at(-1),/2위 \| 보낸사람 : 5,000 코인/);assert.doesNotMatch(out.at(-1).split('\u200b'.repeat(1200))[0],/가입 인원|15,000|5,000/);assert.match(out.at(-1),/\u200b{1200}/);
  await cmd('-송금 1000','3000',{message:{logId:'87654321',type:26,attachment:{src_userId:'4000',src_logId:'6000'}}});
  assert.equal(g.get('1000','3000').coins,4000);
  await Promise.all([cmd('-송금 @받는사람 3000','3000',mention),cmd('-송금 @받는사람 3000','3000',mention)]);
  assert.equal(g.get('1000','3000').coins,1000);assert.equal(g.get('1000','4000').coins,19000);
  g=createGameAccounts(opts);core=createCore({send});g.register(core);
  await cmd('-송금 @받는사람 5000','3000',request);assert.equal(g.get('1000','3000').coins,1000);
  await cmd('-게임가입','3000',{},'2000');assert.equal(g.get('2000','3000').coins,10000);assert.equal(g.get('2000','4000'),null);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('bot-only coin adjustments and expandable inventory with exact durable balances',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-admin-coins-')),out=[],send=async(r,t)=>out.push(t);
 try{
  const opts={dir,botId:()=> '9000',getName:(r,u)=>u==='3000'?'회원':'봇',fetchMessage:async(r,l)=>({room:{id:r},message:{logId:l,type:1},sender:{id:'3000',name:'회원'}})};
  let g=createGameAccounts(opts),core=createCore({send});g.register(core);let log=10000;
  const cmd=(text,u='9000',extra={},r='1000')=>core.handle({roomId:r,userId:u,text,msg:{room:{id:r,isOpenChat:true},sender:{name:opts.getName(r,u)},message:{logId:String(++log),type:1},...extra}});
  await cmd('-인벤','3000');assert.match(out.at(-1),/-게임가입/);
  await cmd('-게임가입','3000');await cmd('-인벤','3000');assert.match(out.at(-1),/보유 아이템 종류 : 0개/);assert.match(out.at(-1),/\[ 곡괭이 \]/);assert.match(out.at(-1),/\u200b{1200}/);
  await cmd('-코인지급 3000 1000','3000');assert.match(out.at(-1),/봇 계정만/);
  await cmd('-코인회수 3000 1000','3000');assert.match(out.at(-1),/봇 계정만/);assert.equal(g.get('1000','3000').coins,10000);
  const req={message:{logId:'12345678901234567',type:1}};
  await cmd('-코인지급 3000 5000','9000',req);assert.match(out.at(-1),/현재 잔액 : 15,000/);assert.equal(g.get('1000','3000').coins,15000);
  await cmd('-코인지급 3000 5000','9000',req);assert.equal(g.get('1000','3000').coins,15000);
  await cmd('-코인회수 @회원 3000','9000',{mentions:[{userId:'3000',name:'회원'}]});assert.equal(g.get('1000','3000').coins,12000);
  await cmd('-코인회수 3000 12001');await cmd('-코인지급 3000 -5');await cmd('-코인지급 3000 9007199254740991');await cmd('-코인지급 4000 10');assert.equal(g.get('1000','3000').coins,12000);assert.equal(g.get('1000','4000'),null);
  await cmd('-코인회수 2000','9000',{message:{logId:'87654321',type:26,attachment:{src_userId:'3000',src_logId:'6000'}}});assert.equal(g.get('1000','3000').coins,10000);
  g=createGameAccounts(opts);core=createCore({send});g.register(core);await cmd('-코인지급 3000 5000','9000',req);assert.equal(g.get('1000','3000').coins,10000);
  const file=path.join(dir,'game-accounts','1000.json'),data=JSON.parse(fs.readFileSync(file));data.users['3000'].inventory={rod:{name:'나무 낚시대',category:'낚시대',quantity:1},fish:{name:'붕어',category:'물고기',quantity:3}};fs.writeFileSync(file,JSON.stringify(data));
  g=createGameAccounts(opts);core=createCore({send});g.register(core);await cmd('-인벤','3000');assert.match(out.at(-1),/나무 낚시대 × 1/);assert.match(out.at(-1),/붕어 × 3/);
  await cmd('-도움말','3000');assert.match(out.at(-1),/\[ 봇계정 전용 명령어 \][\s\S]*-코인지급[\s\S]*-코인회수[\s\S]*\[ 게임 명령어 \][\s\S]*-인벤/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
