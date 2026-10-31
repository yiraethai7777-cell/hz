'use strict';
// Database-backed list of Riot IDs approved by the bot operator.
// Being saved via !발로저장 must NEVER grant access on its own.
const {getPool}=require('./db');
const {parse,allowedPlayers}=require('./valorant-stats');
const SCHEMA="CREATE TABLE IF NOT EXISTS hz_valorant_approved_players ("+
 "riot_id TEXT PRIMARY KEY, riot_name TEXT NOT NULL, riot_tag TEXT NOT NULL, "+
 "approved_by TEXT NOT NULL, approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW())";
const COMMANDS=new Set(['!발로승인','!발로승인해제']);
let schemaReady=null;
function parseTarget(command,text){
 const input=String(text||'').trim().slice(command.length).trim();
 return parse('!발로전적 '+input);
}
async function init(db,shared){
 if(!shared){await db.query(SCHEMA);return;}
 if(!schemaReady) schemaReady=db.query(SCHEMA).catch(e=>{schemaReady=null;throw e;});
 await schemaReady;
}
async function isApproved(target,{env=process.env,db}={}){
 if(allowedPlayers(env).has(target.player))return true;
 const pool=db||getPool();
 await init(pool,!db);
 const result=await pool.query(
  'SELECT EXISTS(SELECT 1 FROM hz_valorant_approved_players WHERE riot_id=$1) AS approved',
  [target.player]
 );
 return result.rows[0]?.approved===true;
}
async function approve(target,{approvedBy,db}={}){
 if(!approvedBy||!String(approvedBy).trim())throw Error('승인 관리자 식별이 필요합니다.');
 const pool=db||getPool();
 await init(pool,!db);
 await pool.query(
  'INSERT INTO hz_valorant_approved_players(riot_id,riot_name,riot_tag,approved_by) VALUES($1,$2,$3,$4) '+
  'ON CONFLICT(riot_id) DO UPDATE SET riot_name=EXCLUDED.riot_name,riot_tag=EXCLUDED.riot_tag,approved_by=EXCLUDED.approved_by,approved_at=NOW()',
  [target.player,target.name,target.tag,String(approvedBy)]
 );
}
async function revoke(target,{db}={}){
 const pool=db||getPool();
 await init(pool,!db);
 const result=await pool.query('DELETE FROM hz_valorant_approved_players WHERE riot_id=$1',[target.player]);
 return result.rowCount>0;
}
async function handle({text,isBotAccount,userId,send,db}){
 const trimmed=String(text||'').trim();
 const command=trimmed.split(/\s+/,1)[0];
 if(!COMMANDS.has(command))return false;
 // Same identity check used for !발로on: only the connected Kakao bot account.
 if(!isBotAccount)return true;
 const target=parseTarget(command,trimmed);
 if(target.usage||target.error){
  await send('사용법: '+command+' 닉네임#태그 [서버]\n예: '+command+' Shine#3333 ap');
  return true;
 }
 try{
  if(command==='!발로승인'){
   await approve(target,{approvedBy:userId,db});
   await send('✅ 전적 조회 허용 목록(DB)에 추가: '+target.name+'#'+target.tag);
  }else{
   const removed=await revoke(target,{db});
   await send(removed?'✅ DB 전적 조회 허용 목록에서 제외: '+target.name+'#'+target.tag:
    'DB 허용 목록에 없는 계정입니다. Railway 환경변수에 등록된 계정은 여기서 삭제되지 않습니다.');
  }
 }catch(error){
  console.error('[NEXI VALORANT APPROVALS]',String(error?.code||'DB_ERROR'));
  await send('❌ DB 승인 목록을 변경하지 못했습니다. 데이터베이스를 확인해 주세요.');
 }
 return true;
}
module.exports={COMMANDS,isApproved,approve,revoke,handle,parseTarget};
