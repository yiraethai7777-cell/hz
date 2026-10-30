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
 const legacy=safe(p.points||0);
 // Combine wallet upsert and one-time legacy link creation in one DB round trip.
 // The wallet row is returned before the link is attempted, preserving ordering.
 const added=await db.query(`
   WITH wallet AS (
     INSERT INTO hz_wallets(room_id,user_id,user_name,balance,signup_bonus_eligible)
     VALUES($1,$2,$4,0,TRUE)
     ON CONFLICT(room_id,user_id) DO UPDATE SET
       user_name=CASE WHEN EXCLUDED.user_name IN ('멘션 사용자','알 수 없음','')
         THEN hz_wallets.user_name ELSE EXCLUDED.user_name END
     RETURNING room_id,user_id
   )
   INSERT INTO gl_economy_links(room_id,user_id,legacy_amount)
   SELECT room_id,user_id,$3 FROM wallet
   ON CONFLICT DO NOTHING RETURNING user_id
 `,[room,user,legacy,p.name||user]);
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
 const started=Date.now();
 const before=await link(db,String(room),String(user),p);
 const linkMs=Date.now()-started;
 const messageId=msg?.id??msg?.message?.id??msg?.raw?.chat?.logId??msg?.logId;
 if(messageId!=null){
  const claim=await db.query('INSERT INTO gl_game_requests(room_id,message_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING message_id',[String(room),String(messageId)]);
  if(!claim.rowCount)return null;
 }
 const result=await run();
 const runMs=Date.now()-started-linkMs;
 const delta=safe(p.points)-before;
 if(delta){
  const cmd=String(msg?.text??msg?.message?.text??'자동낚시').split(/\s/)[0];
  // One PostgreSQL round trip for the balance update and both audit records.
  // The caller's existing transaction still commits or rolls back all three together.
  await db.query(`
    WITH updated AS (
      UPDATE hz_wallets SET balance=$3
      WHERE room_id=$1 AND user_id=$2
      RETURNING room_id,user_id
    ), coin_log AS (
      INSERT INTO hz_coin_logs(room_id,user_id,type,amount,detail)
      SELECT room_id,user_id,$4,$5,$6 FROM updated
      RETURNING id
    )
    INSERT INTO gl_game_events(room_id,user_id,kind,amount)
    SELECT updated.room_id,updated.user_id,$6,$5
    FROM updated CROSS JOIN coin_log
  `,[String(room),String(user),p.points,delta>0?'GAME_REWARD':'GAME_SPEND',delta,cmd]);
 }
 const totalMs=Date.now()-started;
 if(totalMs>=800)console.warn('[GAME ECONOMY SLOW]',{linkMs,runMs,writeMs:totalMs-linkMs-runMs,totalMs});
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
