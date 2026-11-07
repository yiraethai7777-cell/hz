'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');

async function fixture(){
 const native=new PGlite();
 const query=async(sql,params=[])=>{
  const r=await native.query(sql,params);
  return {...r,rowCount:r.affectedRows??r.rows?.length??0};
 };
 const pool={query,connect:async()=>({query,release(){}})};
 await query("CREATE TABLE hz_rooms(room_id TEXT PRIMARY KEY,data JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ DEFAULT NOW())");
 await query("CREATE TABLE hz_wallets(room_id TEXT,user_id TEXT,balance NUMERIC NOT NULL,PRIMARY KEY(room_id,user_id))");
 await query("CREATE TABLE hz_coin_logs(id BIGSERIAL PRIMARY KEY,room_id TEXT,user_id TEXT,amount NUMERIC NOT NULL)");
 await query("CREATE TABLE hz_game_members(room_id TEXT,user_id TEXT,PRIMARY KEY(room_id,user_id))");
 await query("CREATE TABLE gl_farms(room_id TEXT,user_id TEXT,level INT,PRIMARY KEY(room_id,user_id))");
 await query("CREATE TABLE gl_pokemon_players(room_id TEXT,user_id TEXT,PRIMARY KEY(room_id,user_id))");
 await query("CREATE TABLE gl_pokemon_catches(id BIGSERIAL PRIMARY KEY,room_id TEXT,user_id TEXT,pokemon_no INTEGER)");
 await query("CREATE TABLE gl_pokemon_actions(room_id TEXT,message_id TEXT,PRIMARY KEY(room_id,message_id))");
 await query("CREATE TABLE gl_fishing_coin_events(id BIGSERIAL PRIMARY KEY,room_id TEXT)");
 await query("CREATE TABLE gl_fishing_coin_entries(event_id BIGINT REFERENCES gl_fishing_coin_events(id) ON DELETE CASCADE,user_id TEXT,PRIMARY KEY(event_id,user_id))");
 await query("CREATE TABLE hz_attendance(room_id TEXT,user_id TEXT,PRIMARY KEY(room_id,user_id))");
 await query("CREATE TABLE hz_warnings(room_id TEXT,user_id TEXT,PRIMARY KEY(room_id,user_id))");
 const src=fs.readFileSync(path.join(__dirname,'../game/room-reset.js'),'utf8');
 const module={exports:{}};
 const overrides={
  '../shared/db':{getPool:()=>pool},
  '../shared/super-admin':{isSuperAdmin:async()=>false},
  './coin':{messageKey:msg=>String(msg?.id||'')},
  './typing':{resetRoom:()=>true}
 };
 new Function('require','module','exports',src)(p=>overrides[p]??require(p),module,module.exports);
 const reset=module.exports;
 await reset.init();
 const state={game:true,manage:true,botEnabled:true,attendance:{keep:'yes'},
  players:{'111':{points:100,inventory:[{name:'붕어'}],pets:{'고양이':4}}},
  quiz:{answer:'100'},quizQueue:[1,2],lastQuiz:9,promo:{enabled:true}};
 await query("INSERT INTO hz_rooms(room_id,data) VALUES($1,$2::jsonb)",['100',JSON.stringify(state)]);
 await query("INSERT INTO hz_rooms(room_id,data) VALUES($1,$2::jsonb)",['200',JSON.stringify(state)]);
 for(const room of ['100','200']){
  await query("INSERT INTO hz_wallets(room_id,user_id,balance) VALUES($1,'111',1000)",[room]);
  await query("INSERT INTO hz_coin_logs(room_id,user_id,amount) VALUES($1,'111',200)",[room]);
  await query("INSERT INTO hz_game_members(room_id,user_id) VALUES($1,'111')",[room]);
  await query("INSERT INTO gl_farms(room_id,user_id,level) VALUES($1,'111',3)",[room]);
  await query("INSERT INTO gl_pokemon_players(room_id,user_id) VALUES($1,'111')",[room]);
  await query("INSERT INTO gl_pokemon_catches(room_id,user_id,pokemon_no) VALUES($1,'111',445)",[room]);
  const evt=await query("INSERT INTO gl_fishing_coin_events(room_id) VALUES($1) RETURNING id",[room]);
  await query("INSERT INTO gl_fishing_coin_entries(event_id,user_id) VALUES($1,'111')",[evt.rows[0].id]);
  await query("INSERT INTO hz_attendance(room_id,user_id) VALUES($1,'111')",[room]);
  await query("INSERT INTO hz_warnings(room_id,user_id) VALUES($1,'111')",[room]);
 }
 return {db:native,query,pool,reset};
}
test('game reset removes ONLY current-room game data and leaves management untouched',async()=>{
 const {db,query,reset}=await fixture();
 try{
  await reset.request('100','999');
  const result=await reset.execute({room:'100',actor:'999',messageId:'reset-message-1'});
  assert.ok(result.deletedRows>=7);
  for(const table of ['hz_wallets','hz_coin_logs','hz_game_members','gl_farms',
    'gl_pokemon_players','gl_pokemon_catches','gl_fishing_coin_events']){
   const a=await query('SELECT COUNT(*)::integer AS cnt FROM '+table+' WHERE room_id=$1',['100']);
   const b=await query('SELECT COUNT(*)::integer AS cnt FROM '+table+' WHERE room_id=$1',['200']);
   assert.equal(a.rows[0].cnt,0,table+' target');
   assert.equal(b.rows[0].cnt,1,table+' other room');
  }
  const entries=await query('SELECT COUNT(*)::integer AS cnt FROM gl_fishing_coin_entries');
  assert.equal(entries.rows[0].cnt,1,'event entries belonging to the other room remain');
  const rooms=await query("SELECT room_id,data FROM hz_rooms ORDER BY room_id");
  const a=rooms.rows[0].data,b=rooms.rows[1].data;
  assert.equal(a.players,undefined);
  assert.equal(a.quiz,undefined);
  assert.equal(a.quizQueue,undefined);
  assert.equal(a.lastQuiz,undefined);
  assert.equal(a.game,true);
  assert.equal(a.manage,true);
  assert.equal(a.attendance.keep,'yes');
  assert.equal(a.promo.enabled,true);
  assert.equal(b.players['111'].points,100);
  for(const table of ['hz_attendance','hz_warnings']){
   const rows=await query('SELECT COUNT(*)::integer AS cnt FROM '+table);
   assert.equal(rows.rows[0].cnt,2,'untouched '+table);
  }
  const audit=await query('SELECT deleted_rows,affected_tables FROM hz_game_reset_audit WHERE room_id=$1',['100']);
  assert.equal(audit.rows[0].deleted_rows,result.deletedRows);
  assert.ok(result.affectedTables>=7);
  await assert.rejects(()=>reset.execute({room:'100',actor:'999',messageId:'reset-message-2'}),/요청이 없습니다/);
 }finally{await db.close();}
});
test('reset refuses missing/expired confirmation, and cannot reuse a committed message',async()=>{
 const {db,query,reset}=await fixture();
 try{
  await assert.rejects(()=>reset.execute({room:'100',actor:'999',messageId:'reset-1'}),/요청이 없습니다/);
  await reset.request('100','999');
  await query("UPDATE hz_game_reset_requests SET expires_at=NOW()-INTERVAL '1 second' WHERE room_id='100'");
  await assert.rejects(()=>reset.execute({room:'100',actor:'999',messageId:'reset-2'}),/만료/);
  const wallet=await query("SELECT balance FROM hz_wallets WHERE room_id='100'");
  assert.equal(String(wallet.rows[0].balance),'1000');
  await reset.request('100','999');
  await reset.execute({room:'100',actor:'999',messageId:'reset-3'});
  await reset.request('100','999');
  await assert.rejects(()=>reset.execute({room:'100',actor:'999',messageId:'reset-3'}),/이미 처리된/);
 }finally{await db.close();}
});
test('ordinary users cannot trigger reset; bot owner can only request then confirm',async()=>{
 const {db,query,reset}=await fixture();
 try{
  const output=[];
  const ctx={roomId:'100',userId:'999',msg:{id:'start'},isBotAccount:false,
    text:'#게임초기화',send:async s=>output.push(s)};
  assert.equal(await reset.handle(ctx),true);
  assert.match(output[0],/최고관리자만/);
  assert.equal((await query('SELECT * FROM hz_game_reset_requests')).rows.length,0);
  ctx.isBotAccount=true;
  await reset.handle(ctx);
  assert.match(output.at(-1),/60초/);
  assert.equal((await query('SELECT balance FROM hz_wallets WHERE room_id=$1',['100'])).rows.length,1);
  ctx.text='#게임초기화 확인';ctx.msg={id:'confirm-1'};
  await reset.handle(ctx);
  assert.match(output.at(-1),/초기화 완료/);
  assert.equal((await query('SELECT balance FROM hz_wallets WHERE room_id=$1',['100'])).rows.length,0);
 }finally{await db.close();}
});
