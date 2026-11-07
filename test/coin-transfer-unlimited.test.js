'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');

// Load the production coin module with an isolated PostgreSQL test adapter.
async function setup(){
 const db=new PGlite();
 async function query(sql,params=[]){
  const r=await db.query(sql,params);
  return {...r,rowCount:r.affectedRows??r.rows.length};
 }
 await query(`CREATE TABLE hz_wallets(
  room_id TEXT NOT NULL,user_id TEXT NOT NULL,user_name TEXT NOT NULL,
  balance NUMERIC NOT NULL DEFAULT 0 CHECK(balance>=0),
  PRIMARY KEY(room_id,user_id));`);
 await query(`CREATE TABLE hz_coin_logs(
  id BIGSERIAL PRIMARY KEY,room_id TEXT,user_id TEXT,type TEXT,
  amount NUMERIC NOT NULL,detail TEXT,created_at TIMESTAMPTZ DEFAULT NOW());`);
 const pool={query,connect:async()=>({query,release(){}})};
 const ensureWallet=async(client,roomId,userId,name)=>{
  await client.query(`INSERT INTO hz_wallets(room_id,user_id,user_name,balance)
   VALUES($1,$2,$3,0) ON CONFLICT DO NOTHING`,[roomId,userId,name]);
 };
 const src=fs.readFileSync(path.join(__dirname,'../game/coin.js'),'utf8');
 const module={exports:{}};
 const overrides={
  '../shared/db':{getPool:()=>pool},
  './wallet':{ensureWallet,getBalance:async()=>0,coinRanking:async()=>''}
 };
 const injectedRequire=p=>overrides[p]??require(p);
 new Function('require','module','exports',src)(injectedRequire,module,module.exports);
 await module.exports.initCoinExtra();
 return {db,query,coin:module.exports};
}
test('unlimited transfers preserve exact huge numeric balances and transactional logs',async()=>{
 const {db,query,coin}=await setup();
 try{
  const from={id:'10001',name:'발신자'},to={id:'10002',name:'수신자'},roomId='22222';
  const original='1234567890123456789012345678901234567890';
  const receiveOriginal='99999999999999999999999999999999';
  const moved='123456789012345678901234567890123456789';
  await query('INSERT INTO hz_wallets(room_id,user_id,user_name,balance) VALUES($1,$2,$3,$4)',[roomId,from.id,from.name,original]);
  await query('INSERT INTO hz_wallets(room_id,user_id,user_name,balance) VALUES($1,$2,$3,$4)',[roomId,to.id,to.name,receiveOriginal]);
  const result=await coin.transfer({roomId,from,to,coins:moved,kind:'TRANSFER',messageId:'unique001'});
  assert.equal(BigInt(result.recipientBalance),BigInt(receiveOriginal)+BigInt(moved));
  const a=await query('SELECT balance FROM hz_wallets WHERE room_id=$1 AND user_id=$2',[roomId,from.id]);
  const b=await query('SELECT balance FROM hz_wallets WHERE room_id=$1 AND user_id=$2',[roomId,to.id]);
  assert.equal(BigInt(a.rows[0].balance),BigInt(original)-BigInt(moved));
  assert.equal(BigInt(b.rows[0].balance),BigInt(receiveOriginal)+BigInt(moved));
  const logs=await query('SELECT type,amount FROM hz_coin_logs ORDER BY id');
  assert.deepEqual(logs.rows.map(x=>x.type),['TRANSFER_OUT','TRANSFER_IN']);
  assert.equal(BigInt(logs.rows[0].amount),-BigInt(moved));
  assert.equal(BigInt(logs.rows[1].amount),BigInt(moved));
  await assert.rejects(()=>coin.transfer({roomId,from,to,coins:moved,kind:'TRANSFER',messageId:'unique001'}),/이미 처리된/);
  const again=await query('SELECT balance FROM hz_wallets WHERE room_id=$1 AND user_id=$2',[roomId,to.id]);
  assert.equal(BigInt(again.rows[0].balance),BigInt(receiveOriginal)+BigInt(moved));
 }finally{await db.close();}
});
test('insufficient balance rejects large transfers without partial credit',async()=>{
 const {db,query,coin}=await setup();
 try{
  const from={id:'30001',name:'보내는 사람'},to={id:'30002',name:'받는 사람'},roomId='33333';
  await query('INSERT INTO hz_wallets(room_id,user_id,user_name,balance) VALUES($1,$2,$3,$4)',[roomId,from.id,from.name,'100']);
  await assert.rejects(()=>coin.transfer({roomId,from,to,coins:'10000000000000000',kind:'TRANSFER',messageId:'unique002'}),/코인이 부족/);
  const result=await query('SELECT balance FROM hz_wallets WHERE room_id=$1 AND user_id=$2',[roomId,to.id]);
  assert.equal(BigInt(result.rows[0].balance),0n);
  const logs=await query('SELECT count(*)::integer AS total FROM hz_coin_logs');
  assert.equal(logs.rows[0].total,0);
 }finally{await db.close();}
});
test('amount validator accepts arbitrary-sized positive integers, rejects invalid input',async()=>{
 const {db,coin}=await setup();
 try{
  for(const raw of ['1','1000000001','9007199254740992','1'+'0'.repeat(200)]){
   assert.equal(coin.validAmount(raw),raw);
  }
  for(const raw of ['0','-1','1.5','1e8','1,000','abc','',' 10'])
   assert.throws(()=>coin.validAmount(raw),/1 이상의 정수/);
  await assert.rejects(()=>coin.transfer({roomId:'1',from:{id:'5'},to:{id:'6'},coins:'1000000001',kind:'GRANT',messageId:'g1'}),/10억 코인/);
 }finally{await db.close();}
});
