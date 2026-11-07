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
 await query(`CREATE TABLE hz_rooms (
  room_id TEXT PRIMARY KEY,data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW());`);
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
  './wallet':{ensureWallet,getBalance:async()=>0,coinRanking:async()=>''},
  '../shared/super-admin':{isSuperAdmin:async()=>false}
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

test('ALL transfers the entire current balance exactly, including large numbers',async()=>{
 const {db,query,coin}=await setup();
 try{
  const roomId='5000',from={id:'5010',name:'송금자'},to={id:'5020',name:'수취인'};
  const amount='1000000000000000000000';
  await query('INSERT INTO hz_wallets(room_id,user_id,user_name,balance) VALUES($1,$2,$3,$4)',[roomId,from.id,from.name,amount]);
  const sent=await coin.transfer({roomId,from,to,coins:'all',kind:'TRANSFER',messageId:'all-1'});
  assert.equal(sent.amount,amount);
  assert.equal(BigInt(sent.recipientBalance),BigInt(amount));
  const wallets=await query('SELECT user_id,balance FROM hz_wallets WHERE room_id=$1 ORDER BY user_id',[roomId]);
  assert.deepEqual(wallets.rows.map(r=>[r.user_id,String(r.balance)]),[['5010','0'],['5020',amount]]);
  await assert.rejects(()=>coin.transfer({roomId,from,to,coins:'all',kind:'TRANSFER',messageId:'all-2'}),/송금할 코인/);
  await assert.rejects(()=>coin.transfer({roomId,from,to,coins:'all',kind:'TRANSFER',messageId:'all-1'}),/이미 처리된/);
  const logs=await query('SELECT type,amount FROM hz_coin_logs ORDER BY id');
  assert.equal(BigInt(logs.rows[0].amount),-BigInt(amount));
 }finally{await db.close();}
});
test('confirmed coin reset zeros only this room, legacy cached points and keeps items',async()=>{
 const {db,query,coin}=await setup();
 try{
  const actor='10001',room='12000',other='13000';
  await query('INSERT INTO hz_wallets(room_id,user_id,user_name,balance) VALUES($1,$2,$3,$4)',[room,'12001','A','1000000000000000000000']);
  await query('INSERT INTO hz_wallets(room_id,user_id,user_name,balance) VALUES($1,$2,$3,$4)',[room,'12002','B','50']);
  await query('INSERT INTO hz_wallets(room_id,user_id,user_name,balance) VALUES($1,$2,$3,$4)',[other,'12001','A','777']);
  const roomState={game:true,players:{'12001':{points:123,inventory:[{name:'가재'}]},'12002':{points:50,pets:{dragon:1}}}};
  await query('INSERT INTO hz_rooms(room_id,data) VALUES($1,$2::jsonb)',[room,JSON.stringify(roomState)]);
  await coin.requestCoinReset(room,actor);
  const result=await coin.resetRoomCoins({roomId:room,actorId:actor,messageId:'reset-1'});
  assert.equal(result.holders,2);
  assert.equal(BigInt(result.total),1000000000000000000050n);
  const first=await query('SELECT balance FROM hz_wallets WHERE room_id=$1',[room]);
  assert.ok(first.rows.every(r=>BigInt(r.balance)===0n));
  const remain=await query('SELECT balance FROM hz_wallets WHERE room_id=$1',[other]);
  assert.equal(BigInt(remain.rows[0].balance),777n);
  const updated=await query('SELECT data FROM hz_rooms WHERE room_id=$1',[room]);
  assert.equal(updated.rows[0].data.players['12001'].points,0);
  assert.equal(updated.rows[0].data.players['12002'].points,0);
  assert.equal(updated.rows[0].data.players['12001'].inventory[0].name,'가재');
  assert.equal(updated.rows[0].data.players['12002'].pets.dragon,1);
  const logs=await query("SELECT amount FROM hz_coin_logs WHERE type='ROOM_RESET' ORDER BY id");
  assert.equal(logs.rows.length,2);
  assert.equal(logs.rows.reduce((n,x)=>n+BigInt(x.amount),0n),-1000000000000000000050n);
  await assert.rejects(()=>coin.resetRoomCoins({roomId:room,actorId:actor,messageId:'reset-2'}),/신청 내역/);
 }finally{await db.close();}
});
test('reset requires a valid confirmation and only a bot or room super admin can initiate it',async()=>{
 const {db,query,coin}=await setup();
 try{
  const messages=[];
  const msg={id:'unauthorized-1',sender:{id:'20001',name:'일반 유저'}};
  const sendText=async(_room,text)=>messages.push(text);
  assert.equal(await coin.handleCoinCommand({text:'#코인초기화',msg,roomId:'5555',chat:{sendText},isBotAccount:false,isSuperAdmin:false}),true);
  assert.match(messages[0],/최고관리자만/);
  const pending=await query('SELECT * FROM hz_coin_reset_pending WHERE room_id=$1',['5555']);
  assert.equal(pending.rows.length,0);
  await assert.rejects(()=>coin.resetRoomCoins({roomId:'5555',actorId:'20001',messageId:'reset-nopending'}),/신청 내역/);
  await coin.requestCoinReset('5555','20001');
  await query("UPDATE hz_coin_reset_pending SET expires_at=NOW()-INTERVAL '10 seconds' WHERE room_id=$1",['5555']);
  await assert.rejects(()=>coin.resetRoomCoins({roomId:'5555',actorId:'20001',messageId:'reset-expired'}),/만료/);
 }finally{await db.close();}
});
