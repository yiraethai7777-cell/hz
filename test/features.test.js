'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createRuntime}=require('../shared/runtime');

test('leave event sends a folded notice with counts and profile, and records its server log ID',async()=>{
 const handlers={},queries=[],replies=[];
 const pool={query:async(sql,params)=>{
  queries.push({sql,params});
  if(sql.startsWith('SELECT data'))return {rows:[{data:{manage:true,game:false}}]};
  if(sql.includes('SELECT join_count,leave_count'))return {rows:[{join_count:3,leave_count:2,open_profile_link:null}]};
  return {rows:[],rowCount:0};
 }};
 const runtime=createRuntime({pool,economyEnabled:false});
 const chat={sendText:async(room,text)=>{replies.push(text);return {body:{logId:'9007199254740993456'}};}};
 const client={userId:'9999',chat,onMessage(){},onJoin(){},onLeave:fn=>handlers.leave=fn,onKick(){},onDelete(){},
  getUserOpenProfileLink:async(room,id)=>{assert.equal(id,'9007199254740993123');return 'https://open.kakao.com/o/example';}};
 try{
  await runtime.attachHZBot(client);queries.length=0;
  await handlers.leave({room:{id:'100',name:'테스트방'},members:[{id:'9007199254740993123',name:'Alice'}]});
  assert.equal(replies.length,1);assert.equal(replies[0].split('\u200b')[0],'👋 Alice님이 나갔습니다.\n');
  assert.match(replies[0],/입장 3회 · 퇴장 2회/);assert.match(replies[0],/https:\/\/open.kakao.com\/o\/example/);
  const saved=queries.find(q=>q.sql.includes('INSERT INTO gl_leave_replies'));
  assert.deepEqual(saved.params,['100','9007199254740993456','9999','9007199254740993123','Alice']);
 }finally{clearInterval(runtime.promoTimer);clearInterval(runtime.autoFishTimer);}
});

test('legacy registration commands and rejoin enforcement are retired without deleting records',async()=>{
 const statements=[];
 const runtime=createRuntime({economyEnabled:false,pool:{query:async sql=>{statements.push(sql);return {rows:[]};}}});
 const db={query:async sql=>{statements.push(sql);return {rows:[]};}};
 const d=runtime.blankRoom('test');
 for(const text of ['!벤등록 9007199254740993123','!벤등록해제 9007199254740993123','!벤등록목록']){
  const result=await runtime.handleManage(d,db,{room:{id:'1'},sender:{id:'1001',type:1},text},false);
  assert.ok(result==null);
 }
 assert.doesNotMatch(runtime.manageHelp(),/벤등록/);
 assert.ok(statements.every(sql=>!sql.includes('hz_ban_registry')&&!/\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql)));
 const session=fs.readFileSync(path.join(__dirname,'../shared/session.js'),'utf8');
 assert.doesNotMatch(session,/hz_ban_registry|AUTO BAN/);
 const schema=fs.readFileSync(path.join(__dirname,'../shared/state.js'),'utf8');
 assert.match(schema,/CREATE TABLE IF NOT EXISTS hz_ban_registry/);
});

test('separated game functions preserve player state, pets, quiz and levels',async()=>{
 const runtime=createRuntime({economyEnabled:false,pool:{query:async()=>({rows:[]})}});
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
 const runtime=createRuntime({pool,economyEnabled:false});
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
 const runtime=createRuntime({economyEnabled:false,pool:{query:async(sql)=>{queries.push(sql);return {rows:[{total:3}],rowCount:1};}}});
 assert.equal(await runtime.activeWarningCount(runtime.pool,'room','user'),3);
 assert.match(queries[0],/hz_warnings/);
 assert.equal(runtime.safeUserId('1234567890123456789'),'1234567890123456789');
 assert.equal(runtime.isOwnerType(1),true);
 const room=runtime.fixRoom({game:true,manage:false,players:{kept:{points:987}}});
 assert.equal(room.game,true);assert.equal(room.manage,false);
 assert.equal(room.players.kept.points,987);
});

test('every separated feature references an available shared binding',()=>{
 const runtime=createRuntime({economyEnabled:false,pool:{query:async()=>({rows:[]})}});
 for(const file of ['game/features.js','manage/features.js','shared/state.js','shared/session.js']){
  const code=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  for(const match of code.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)){
   assert.ok(Object.hasOwn(runtime,match[1]),`${file}: missing ${match[1]}`);
  }
 }
});

test('fishing is text only with 20 species; old inventory remains saleable',async()=>{
 const runtime=createRuntime({economyEnabled:false,pool:{query:async()=>({rows:[]})}});
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

test('game and management help remain separate, folded and unnamed',()=>{
 const {formatCommandHelp}=require('../shared/help');
 const manageOnly=formatCommandHelp({manage:true,game:false},'관리');
 assert.match(manageOnly,/🛡️ 관리 명령어/);
 assert.match(manageOnly,/!출석/);
 assert.doesNotMatch(manageOnly,/!낚시/);
 const gameOnly=formatCommandHelp({manage:false,game:true},'게임');
 assert.match(gameOnly,/!낚시/);
 assert.doesNotMatch(gameOnly,/!출석|!경고/);
 for(const [menu,heading] of [[gameOnly,'게임'],[manageOnly,'관리']]){
  assert.equal(menu.split('\u200b'.repeat(1200))[0],
    '📜 명령어 안내\n작동 중인 기능 · '+heading);
  assert.equal([...menu].filter(ch=>ch==='\u200b').length,1200);
 }
 const generic=formatCommandHelp({manage:true,game:true});
 assert.match(generic,/!게임명령어/);
 assert.match(generic,/!관리명령어/);
 assert.doesNotMatch(generic,/!낚시|!출석/);
 assert.match(formatCommandHelp({manage:false,game:true},'관리'),/관리 기능은 중지/);
 assert.match(formatCommandHelp({manage:true,game:false},'게임'),/게임 기능은 중지/);
});

test('legacy session never replaces the unified deletion listener',async()=>{
 const handlers={deleted:()=> 'unified'};
 let registrations=0;
 const pool={query:async()=>({rows:[],rowCount:0})};
 const runtime=createRuntime({pool,economyEnabled:false});
 const client={userId:'1001',chat:{sendText:async()=>{}},
  onMessage(){},onJoin(){},onLeave(){},onKick(){},
  onDelete:fn=>{registrations++;handlers.deleted=fn;}};
 try{
  await runtime.attachHZBot(client);
  assert.equal(registrations,0);
  assert.equal(handlers.deleted(),'unified');
 }finally{clearInterval(runtime.promoTimer);clearInterval(runtime.autoFishTimer);}
});
