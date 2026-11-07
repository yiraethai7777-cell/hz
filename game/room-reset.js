'use strict';
// Destructive *room-scoped* game reset. No DROP/TRUNCATE/global deletes.
// Preserve management, moderation, chat history, attendance and bot settings.
const {getPool}=require('../shared/db');
const {isSuperAdmin}=require('../shared/super-admin');
const {messageKey}=require('./coin');
const RESET_TIMEOUT_SECONDS=60;
// Explicit allowlist. Keep game tables in dependency-safe order.
const GAME_TABLES=Object.freeze([
 'gl_fishing_coin_events', // gl_fishing_coin_entries cascade via event_id
 'gl_farms',
 'gl_pokemon_catches',
 'gl_pokemon_players',
 'gl_pokemon_actions',
 'hz_stock_trades',
 'hz_stock_holdings',
 'gl_stock_alerts',
 'gl_public_profiles',
 'gl_game_events',
 'gl_game_requests',
 'gl_economy_links',
 'hz_coin_logs',
 'hz_coin_operations',
 'hz_game_members',
 'hz_wallets'
]);
const JSON_GAME_KEYS=Object.freeze(['players','quiz','quizQueue','lastQuiz']);
async function init(){
 const db=getPool();
 await db.query("CREATE TABLE IF NOT EXISTS hz_game_reset_requests ("+
  "room_id TEXT NOT NULL, actor_id TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,"+
  "PRIMARY KEY(room_id,actor_id))");
 await db.query("CREATE TABLE IF NOT EXISTS hz_game_reset_audit ("+
  "room_id TEXT NOT NULL, message_id TEXT NOT NULL, actor_id TEXT NOT NULL,"+
  "deleted_rows INTEGER NOT NULL DEFAULT 0, affected_tables INTEGER NOT NULL DEFAULT 0,"+
  "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,message_id))");
}
async function request(room,actor){
 await getPool().query("INSERT INTO hz_game_reset_requests(room_id,actor_id,expires_at) "+
  "VALUES($1,$2,NOW()+INTERVAL '60 seconds') "+
  "ON CONFLICT(room_id,actor_id) DO UPDATE SET expires_at=EXCLUDED.expires_at",[room,actor]);
}
async function cancel(room,actor){
 const result=await getPool().query("DELETE FROM hz_game_reset_requests WHERE room_id=$1 AND actor_id=$2",[room,actor]);
 return (result.rowCount??result.affectedRows??0)>0;
}
async function execute({room,actor,messageId,pool=getPool()}){
 if(!room||!actor||!messageId)throw Error('방·사용자·메시지 고유번호를 확인할 수 없습니다.');
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  // Existing game actions lock this same room row. The reset is atomic.
  await db.query("INSERT INTO hz_rooms(room_id,data) VALUES($1,'{}'::jsonb) ON CONFLICT DO NOTHING",[room]);
  const current=await db.query('SELECT data FROM hz_rooms WHERE room_id=$1 FOR UPDATE',[room]);
  const check=await db.query("SELECT expires_at>NOW() AS active FROM hz_game_reset_requests "+
   "WHERE room_id=$1 AND actor_id=$2 FOR UPDATE",[room,actor]);
  if(!check.rows[0]?.active)
   throw Error('확인 시간이 만료되었거나 요청이 없습니다. !게임초기화를 다시 입력해 주세요.');
  // A repeated KakaoTalk message must never execute twice.
  const unique=await db.query("INSERT INTO hz_game_reset_audit(room_id,message_id,actor_id) "+
   "VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING message_id",[room,messageId,actor]);
  if(!unique.rowCount)throw Error('이미 처리된 초기화 명령어입니다.');

  let deletedRows=0,affectedTables=0;
  for(const table of GAME_TABLES){
   // Older deployments might not have created every optional game table.
   const existing=await db.query('SELECT to_regclass($1) AS rel',[table]);
   if(!existing.rows[0]?.rel)continue;
   const result=await db.query('DELETE FROM '+table+' WHERE room_id=$1',[room]);
   const count=Number(result.rowCount??result.affectedRows??0);
   deletedRows+=count;
   affectedTables+=1;
  }
  // Do not delete the hz_rooms row: it also contains moderation/bot flags.
  const data=current.rows[0]?.data||{};
  if(data && typeof data==='object' && !Array.isArray(data)){
   for(const key of JSON_GAME_KEYS)delete data[key];
   await db.query("UPDATE hz_rooms SET data=$2::jsonb,updated_at=NOW() WHERE room_id=$1",
    [room,JSON.stringify(data)]);
  }
  // A pending coin-only reset cannot later act on recreated game accounts.
  const coinPending=await db.query("SELECT to_regclass('hz_coin_reset_pending') AS rel");
  if(coinPending.rows[0]?.rel)
   await db.query('DELETE FROM hz_coin_reset_pending WHERE room_id=$1',[room]);
  await db.query('DELETE FROM hz_game_reset_requests WHERE room_id=$1',[room]);
  await db.query("UPDATE hz_game_reset_audit SET deleted_rows=$3,affected_tables=$4 "+
    "WHERE room_id=$1 AND message_id=$2",[room,messageId,deletedRows,affectedTables]);
  await db.query('COMMIT');
  return {deletedRows,affectedTables};
 }catch(error){
  try{await db.query('ROLLBACK');}catch(rollbackError){console.error('[GAME RESET ROLLBACK]',rollbackError);}
  throw error;
 }finally{db.release();}
}
async function handle(ctx){
 const text=String(ctx.text||'').trim();
 if(!/^#게임초기화(?:\s|$)/.test(text))return false;
 const room=String(ctx.roomId??''),actor=String(ctx.userId??ctx.msg?.sender?.id??'');
 const send=ctx.send;
 try {
  const allowed=ctx.isBotAccount===true||await isSuperAdmin(room,actor);
  if(!allowed){await send('⛔ 봇 계정 또는 이 방의 최고관리자만 게임을 초기화할 수 있습니다.');return true;}
  if(text==='#게임초기화'){
   await request(room,actor);
   await send('⚠️ NEXI | 게임 전체 초기화\n'+
    '이 방의 게임 가입·코인·낚시·펫·농장·포켓몬·퀴즈·게임 랭킹과 관련 데이터를 삭제합니다.\n'+
    '다른 방, 출석 기록, 채팅 통계, 관리자 설정과 제재 기록은 유지됩니다.\n\n'+
    '삭제한 게임 데이터는 복구할 수 없습니다.\n'+
    '60초 안에 !게임초기화 확인 을 입력하면 실행됩니다.\n'+
    '취소: !게임초기화 취소');
  }else if(text==='#게임초기화 취소'){
   await cancel(room,actor);
   await send('✅ 게임 초기화 요청을 취소했습니다.');
  }else if(text==='#게임초기화 확인'){
   const result=await execute({room,actor,messageId:messageKey(ctx.msg||{})});
   // Room-local in-memory rounds must not survive database reset.
   try{require('./typing').resetRoom?.(room);}catch(error){
    console.warn('[GAME RESET TYPING CLEANUP]',String(error?.message||error));
   }
   await send('✅ NEXI | 게임 초기화 완료\n'+
    '대상: 현재 채팅방\n'+
    '삭제된 데이터: '+result.deletedRows.toLocaleString('ko-KR')+'건\n'+
    '초기화한 게임 테이블: '+result.affectedTables+'개\n'+
    '코인·아이템·포켓몬·게임 기록을 새로 시작할 수 있습니다.');
  }else await send('사용법: !게임초기화 → !게임초기화 확인 (60초 이내)');
 }catch(error){
  console.error('[GAME ROOM RESET]',String(error?.code||error?.message||error));
  await send('❌ 게임 초기화 실패: '+String(error?.message||error));
 }
 return true;
}
module.exports={init,handle,request,cancel,execute,GAME_TABLES,JSON_GAME_KEYS,RESET_TIMEOUT_SECONDS};
