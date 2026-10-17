'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRuntime}=require('../shared/runtime');

test('separated game functions preserve player state, pets, quiz and levels',async()=>{
 const runtime=createRuntime({pool:{query:async()=>({rows:[]})}});
 const room=runtime.blankRoom('test');
 const msg={room:{id:'1'},sender:{id:'1001',name:'Alice'},text:'!상점'};
 const db={query:async()=>({rows:[]})};
 let reply=await runtime.handleGame(room,db,msg,false);
 assert.match(reply,/낚시대 상점/);
 const player=room.players['1001'];player.points=123456;
 player.pets={'고양이':0};player.equippedPet='고양이';
 msg.text='!펫강화';reply=await runtime.handleGame(room,db,msg,false);
 assert.match(reply,/강화 완료/);assert.equal(player.pets['고양이'],1);
 assert.ok(player.points<123456);
 msg.text='!퀴즈';reply=await runtime.handleGame(room,db,msg,false);
 assert.match(reply,/제한 시간/);assert.ok(room.quiz.answers.length);
 assert.equal(runtime.addXp(player,100),1);assert.equal(player.level,2);
 assert.equal(room.players['1001'],player);
 assert.equal(runtime.FISH_TABLE.length,20);
 assert.equal(runtime.PETS.length,20);
});

test('separated session initializes events, timers and game dispatch without hz-bot.js',async()=>{
 const room={game:true,manage:false,players:{},quizQueue:[],promo:{}};
 const calls=[],replies=[],handlers={};
 const query=async(sql,params)=>{
  calls.push(sql);
  if(sql.startsWith('SELECT data'))return {rows:[{data:room}]};
  return {rows:[],rowCount:0};
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const runtime=createRuntime({pool});
 const chat={sendText:async(id,text)=>replies.push(text)};
 const client={userId:'1001',chat,
  onMessage:fn=>handlers.message=fn,onJoin:fn=>handlers.join=fn,
  onLeave:fn=>handlers.leave=fn,onKick:fn=>handlers.kick=fn,onDelete:fn=>handlers.deleted=fn};
 try{
  await runtime.attachHZBot(client);
  assert.deepEqual(Object.keys(handlers).sort(),['deleted','join','kick','leave','message']);
  await handlers.message(chat,{room:{id:'1'},sender:{id:'1001',name:'Bot'},text:'!상점'});
  assert.match(replies.at(-1),/낚시대 상점/);
  assert.ok(calls.some(sql=>sql.includes('CREATE TABLE IF NOT EXISTS hz_rooms')));
  assert.ok(calls.some(sql=>sql==='COMMIT'));
  assert.ok(!fs.existsSync(path.join(__dirname,'../hz-bot.js')));
 }finally{
  clearInterval(runtime.promoTimer);clearInterval(runtime.autoFishTimer);
 }
});

test('management helpers and existing SQL schema survive separation',async()=>{
 const queries=[];
 const runtime=createRuntime({pool:{query:async(sql)=>{queries.push(sql);return {rows:[{total:3}],rowCount:1};}}});
 assert.equal(await runtime.activeWarningCount(runtime.pool,'room','user'),3);
 assert.match(queries[0],/hz_warnings/);
 assert.equal(runtime.safeUserId('1234567890123456789'),'1234567890123456789');
 assert.equal(runtime.isOwnerType(1),true);
 const room=runtime.fixRoom({game:true,manage:false,players:{kept:{points:987}}});
 assert.equal(room.game,true);assert.equal(room.manage,false);
 assert.equal(room.players.kept.points,987);
});

test('every separated feature references an available shared binding',()=>{
 const runtime=createRuntime({pool:{query:async()=>({rows:[]})}});
 for(const file of ['game/features.js','manage/features.js','shared/state.js','shared/session.js']){
  const code=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  for(const match of code.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)){
   assert.ok(Object.hasOwn(runtime,match[1]),`${file}: missing ${match[1]}`);
  }
 }
});

test('fishing is text only with 20 species; old inventory remains saleable',async()=>{
 const runtime=createRuntime({pool:{query:async()=>({rows:[]})}});
 const ctx=Object.fromEntries(Object.getOwnPropertyNames(runtime).map(name=>[name,runtime[name]]));
 Object.assign(ctx,{sleep:async()=>{},globalChat:{sendText:async()=>{},sendImage:async()=>{throw Error('No images allowed');}},send:async()=>{}});
 Object.assign(ctx,require('../game/features')(ctx));
 assert.equal(ctx.FISH_TABLE.length,20);
 assert.equal(new Set(ctx.FISH_TABLE.map(f=>f.name)).size,20);
 const room=ctx.blankRoom('room');
 const msg={room:{id:'1'},sender:{id:'1001',name:'Alice'},text:'!낚시'};
 const oldFish={name:'천공해룡',tier:'신화',size:1000,value:1234,salePending:true};
 const player=ctx.player(room,'1001','Alice');player.inventory.push(oldFish);
 const result=await ctx.handleGame(room,{},msg,false);
 assert.match(result,/낚시 결과/);
 assert.ok(!/사진|전송 실패/.test(result));
 assert.equal(player.inventory.length,2);
 assert.equal(player.inventory[0],oldFish);
 assert.ok(ctx.FISH_TABLE.some(f=>f.name===player.inventory[1].name));
 msg.text='!물고기판매 천공해룡 all';
 const before=player.points;
 const sale=await ctx.handleGame(room,{},msg,false);
 assert.match(sale,/판매/);assert.equal(player.points,before+1234);
 assert.ok(!player.inventory.includes(oldFish));
});
