'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
test('farm contracts: shared wallet, private plots, restart-safe growth and atomic purchases, harvests and expansions',async t=>{
 const db=new PGlite();let queue=Promise.resolve(),clock=Date.parse('2026-10-19T12:00:00+09:00');
 const query=async(sql,params)=>{const r=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1);return {...r,rowCount:r?.affectedRows??r?.rows?.length??0};};
 const pool={query,connect:async()=>{const wait=queue;let release;queue=new Promise(r=>release=r);await wait;return{query,release};}};
 try{
  const runtime=require('../shared/runtime').createRuntime({pool,economyEnabled:false});await runtime.initDb();
  const oldEnv=process.env.DATABASE_URL;process.env.DATABASE_URL='postgres://localhost/farm-test';
  const globalPool=require('../shared/db').getPool(),originalQuery=globalPool.query;globalPool.query=query;
  try{await require('../game/wallet').initWallet();await require('../game/coin').initCoinExtra();await require('../game/economy').init();}finally{globalPool.query=originalQuery;if(oldEnv===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldEnv;}
  await query('INSERT INTO hz_rooms(room_id,data) VALUES($1,$2::jsonb)',['100',JSON.stringify({game:true,manage:true,players:{'2001':{id:'2001',name:'농부',points:1000,level:12,xp:44,wins:3,inventory:[{name:'기존 물고기'}]}}})]);
  await query("INSERT INTO hz_wallets(room_id,user_id,user_name,balance) VALUES('100','2001','농부',100000000)");
  const {createFarm,CROPS}=require('../game/farm'),farm=createFarm({pool,now:()=>clock});await farm.init();
  let seq=0;const run=(text,extra={})=>farm.run({roomId:'100',userId:'2001',userName:'농부',messageId:'farm-'+(++seq),text,...extra});
  const wallet=async()=>Number((await query("SELECT balance FROM hz_wallets WHERE room_id='100' AND user_id='2001'")).rows[0].balance);
  await t.test('eight crops and existing rod prices are shown inside a real fold',async()=>{
   assert.equal(CROPS.length,8);assert.deepEqual(CROPS.map(x=>x.minutes),[1,2,3,4,5,6,8,10]);
   const shop=await run('!상점');const [visible,detail]=shop.split('\u200b'.repeat(1200));assert.match(visible,/NEXUS \| SHOP/);assert.doesNotMatch(visible,/당근|20,000/);assert.match(detail,/당근/);assert.match(detail,/돌.*20,000/);assert.match(detail,/천상.*15,000,000/);
  });
  await t.test('initial farm is private, empty and folded; invalid arguments cannot inspect another account',async()=>{
   const text=await run('!농장');assert.match(text,/\u00022001\u0003농부\u0004님의 농장/);assert.match(text,/3×3/);assert.equal((text.match(/🟫/g)||[]).length,9);assert.match(text,/빈 땅: 9칸/);assert.match(text,/\u200b{1200}/);
   await assert.rejects(()=>run('!농장 @다른사람'),/사용법/);
  });
  await t.test('seed purchase debits the shared wallet once, rejects invalid quantities and overspending',async()=>{
   const before=await wallet(),input={roomId:'100',userId:'2001',userName:'농부',messageId:'buy-once',text:'!씨앗구매 당근 5'};
   await farm.run(input);await assert.rejects(()=>farm.run(input),/이미 처리/);assert.equal(await wallet(),before+1000-2500);
   for(const text of ['!씨앗구매 당근 -1','!씨앗구매 당근 1.5','!씨앗구매 없는작물 1','!씨앗구매 파인애플 9007199254740991'])await assert.rejects(()=>run(text));
   await assert.rejects(()=>run('!씨앗구매 파인애플 1000000000'),/부족/);assert.equal(await wallet(),before+1000-2500);
  });
  await t.test('planting consumes one seed only; growth survives module recreation and harvesting pays once',async()=>{
   await run('!심기 1 당근');await assert.rejects(()=>run('!심기 1 당근'),/작물/);await assert.rejects(()=>run('!심기 0 당근'),/번호/);
   await assert.rejects(()=>run('!수확 1'),/남은 시간/);assert.match(await run('!농장'),/🌱/);
   clock+=31000;assert.match(await run('!농장'),/🌿/);clock+=30000;
   const restarted=createFarm({pool,now:()=>clock});assert.match(await restarted.run({roomId:'100',userId:'2001',userName:'농부',text:'!농장'}),/🥕/);
   const before=await wallet();const results=await Promise.allSettled([run('!수확 1'),run('!수확 1')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(await wallet(),before+1000);
  });
  await t.test('expansion preserves planted coordinates and player records, charges once and stops at eight by eight',async()=>{
   await run('!심기 9 당근');const before=await wallet();const input={roomId:'100',userId:'2001',userName:'농부',text:'!농장확장',messageId:'expand-once'};
   await farm.run(input);await assert.rejects(()=>farm.run(input),/이미 처리/);assert.equal(await wallet(),before-100000);
   clock+=60001;assert.match(await run('!수확 11'),/수확/);
   for(let i=0;i<4;i++)await run('!농장확장');assert.match(await run('!농장정보'),/8×8/);await assert.rejects(()=>run('!농장확장'),/최대/);
   const p=(await query("SELECT data FROM hz_rooms WHERE room_id='100'")).rows[0].data.players['2001'];assert.equal(p.level,12);assert.equal(p.xp,44);assert.deepEqual(p.inventory,[{name:'기존 물고기'}]);assert.equal(p.points,await wallet());
  });
  await t.test('bulk harvest pays only mature plots and leaves growing crops untouched',async()=>{
   await run('!씨앗구매 파인애플 1');await run('!심기 1 당근');await run('!심기 2 파인애플');clock+=61000;const before=await wallet();await run('!전체수확');assert.equal(await wallet(),before+1000);assert.match(await run('!농장'),/재배 중: 1칸/);
  });
 }finally{await db.close();}
});
