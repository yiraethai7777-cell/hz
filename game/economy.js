'use strict';
const {getPool}=require('../shared/db');
const {ensureWallet}=require('./wallet');
const LIMIT=Number.MAX_SAFE_INTEGER;
async function init(){await getPool().query(`
 CREATE TABLE IF NOT EXISTS gl_economy_links(room_id TEXT NOT NULL,user_id TEXT NOT NULL,legacy_amount BIGINT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,user_id));
 CREATE TABLE IF NOT EXISTS gl_game_requests(room_id TEXT NOT NULL,message_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,message_id));
 CREATE TABLE IF NOT EXISTS gl_game_events(id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,user_id TEXT NOT NULL,kind TEXT NOT NULL,amount BIGINT NOT NULL DEFAULT 0,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);}
function safe(n){n=Number(n);if(!Number.isSafeInteger(n)||n<0||n>LIMIT)throw Error('기존 코인 값을 안전하게 처리할 수 없습니다.');return n;}
async function link(db,room,user,p){
 await ensureWallet(db,room,user,p.name||user);
 const legacy=safe(p.points||0);
 const added=await db.query('INSERT INTO gl_economy_links(room_id,user_id,legacy_amount) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id',[room,user,legacy]);
 if(added.rowCount&&legacy){
  const result=await db.query('UPDATE hz_wallets SET balance=balance+$3 WHERE room_id=$1 AND user_id=$2 AND balance<=$4::bigint-$3::bigint RETURNING balance',[room,user,legacy,LIMIT]);
  if(!result.rowCount)throw Error('코인 합산 한도를 초과했습니다.');
  await db.query("INSERT INTO hz_coin_logs(room_id,user_id,type,amount,detail) VALUES($1,$2,'LEGACY_GAME_MERGE',$3,'기존 게임 코인과 지갑 코인 연결: 1회만 합산')",[room,user,legacy]);
 }
 const balance=await db.query('SELECT balance FROM hz_wallets WHERE room_id=$1 AND user_id=$2 FOR UPDATE',[room,user]);
 p.points=safe(balance.rows[0].balance);
 return p.points;
}
async function withPlayer({db,room,user,p,msg,botId,run}){
 if(user===String(botId))return run();
 const before=await link(db,String(room),String(user),p);
 const messageId=msg?.id??msg?.message?.id??msg?.raw?.chat?.logId??msg?.logId;
 if(messageId!=null){
  const claim=await db.query('INSERT INTO gl_game_requests(room_id,message_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING message_id',[String(room),String(messageId)]);
  if(!claim.rowCount)return null;
 }
 const result=await run();
 const delta=safe(p.points)-before;
 if(delta){
  await db.query('UPDATE hz_wallets SET balance=$3 WHERE room_id=$1 AND user_id=$2',[String(room),String(user),p.points]);
  const cmd=String(msg?.text??msg?.message?.text??'자동낚시').split(/\s/)[0];
  await db.query('INSERT INTO hz_coin_logs(room_id,user_id,type,amount,detail) VALUES($1,$2,$3,$4,$5)',[String(room),String(user),delta>0?'GAME_REWARD':'GAME_SPEND',delta,cmd]);
  await db.query('INSERT INTO gl_game_events(room_id,user_id,kind,amount) VALUES($1,$2,$3,$4)',[String(room),String(user),cmd,delta]);
 }
 return result;
}
async function ensureLinked(room,user,name){
 const db=await getPool().connect();
 try{
  await db.query('BEGIN');
  const r=await db.query('SELECT data FROM hz_rooms WHERE room_id=$1 FOR UPDATE',[String(room)]);
  const data=r.rows[0]?.data,p=data?.players?.[String(user)];
  if(p){p.name=name||p.name;await link(db,String(room),String(user),p);await db.query('UPDATE hz_rooms SET data=$2::jsonb,updated_at=NOW() WHERE room_id=$1',[String(room),JSON.stringify(data)]);}
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}
module.exports={init,link,withPlayer,ensureLinked,safe};
