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
  assert.deepEqual(g.get('1000',userId),{joinedAt:1700000000000,coins:10000,inventory:{}});
  assert.deepEqual(dirty,['game-accounts/1000.json','game-accounts/1000.json']);
  g=createGameAccounts(opts);core=createCore({send});g.register(core);await cmd();assert.match(out.at(-1),/이미 게임에 가입/);
  await cmd('2000');assert.ok(g.get('2000',userId));assert.equal(dirty.length,3);
  await cmd('2000',userId,true,'-도움말');assert.match(out.at(-1),/-게임가입/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
