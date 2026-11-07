'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {exactBalance,gameplayBalance,formatAmount}=require('../game/farm-balance');
const {PGlite}=require('@electric-sql/pglite');

test('NUMERIC wallet balances above Number.MAX_SAFE_INTEGER remain exact',()=>{
 const high='123456789012345678901234567890';
 assert.equal(exactBalance(high),123456789012345678901234567890n);
 assert.equal(gameplayBalance(high),1000000000000);
 assert.equal(formatAmount(exactBalance(high)),'123,456,789,012,345,678,901,234,567,890');
 assert.throws(()=>exactBalance('123.5'),/형식/);
 assert.throws(()=>exactBalance('-1'),/형식/);
});

test('high-balance farm purchase and delayed harvest preserve exact NUMERIC balance',async()=>{
 const pg=new PGlite();
 let queue=Promise.resolve(),clock=Date.parse('2026-11-07T12:00:00+09:00');
 const query=async(sql,params)=>{
  const result=params?.length?await pg.query(sql,params):(await pg.exec(sql)).at(-1);
  return {...result,rowCount:result?.affectedRows??result?.rows?.length??0};
 };
 const pool={query,connect:async()=>{
  const before=queue;let release;
  queue=new Promise(resolve=>release=resolve);await before;
  return {query,release};
 }};
 const oldEnv=process.env.DATABASE_URL;
 try{
  process.env.DATABASE_URL='postgres://localhost/nexi-farm-balance-test';
  const runtime=require('../shared/runtime').createRuntime({pool,economyEnabled:false});
  await runtime.initDb();
  const globalPool=require('../shared/db').getPool();
  const originalQuery=globalPool.query;
  globalPool.query=query;
  try{
   await require('../game/wallet').initWallet();
   await require('../game/coin').initCoinExtra();
  }finally{globalPool.query=originalQuery;}
  await query("INSERT INTO hz_rooms(room_id,data) VALUES('180','{\"game\":true,\"players\":{}}'::jsonb)");
  const high='123456789012345678901234567890';
  await query('INSERT INTO hz_wallets(room_id,user_id,user_name,balance) VALUES($1,$2,$3,$4::numeric)',
   ['180','200','농부',high]);
  const farm=require('../game/farm').createFarm({pool,now:()=>clock,autoRecover:false});
  await farm.init();
  let seq=0;
  const run=async text=>farm.run({text,roomId:'180',userId:'200',userName:'농부',
   isBotAccount:false,messageId:'huge-'+(++seq)});
  const wallet=async()=>BigInt((await query("SELECT balance FROM hz_wallets WHERE room_id='180' AND user_id='200'")).rows[0].balance);
  await run('!씨앗ㄱㅁ 파인애플 2');
  assert.equal(await wallet(),BigInt(high)-30000n);
  const planted=await run('!심기 all 파인애플');
  assert.match(planted,/파인애플 2칸을 심는 중입니다/);
  assert.match(planted,/\u200b{1200}/);
  assert.equal(await wallet(),BigInt(high)-30000n);
  clock+=605001;const harvesting=await run('!전체수확');
  assert.match(harvesting,/수확 중입니다/);
  assert.equal(await wallet(),BigInt(high)-30000n);
  clock+=5000;
  await run('!농장');
  assert.equal(await wallet(),BigInt(high)+30000n);
  await run('!농장');
  assert.equal(await wallet(),BigInt(high)+30000n,'harvest credited exactly once');
 }finally{
  if(oldEnv===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldEnv;
  await pg.close();
 }
});
