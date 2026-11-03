'use strict';
const {getPool}=require('../shared/db');
const {ensureWallet}=require('./wallet');
const PRIZE=1000000;
let timer=null,busy=false;
async function init(){
 const db=getPool();
 await db.query(`
 CREATE TABLE IF NOT EXISTS gl_fishing_coin_events(
 id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,room_name TEXT NOT NULL DEFAULT '',
 started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),ends_at TIMESTAMPTZ NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','completed')),
 winner_id TEXT,winner_name TEXT,winning_fish TEXT,winning_size NUMERIC(12,2),
 announced_at TIMESTAMPTZ,created_by TEXT NOT NULL DEFAULT 'web'
 );
 CREATE UNIQUE INDEX IF NOT EXISTS gl_fishing_coin_events_active_room
 ON gl_fishing_coin_events(room_id) WHERE status='active';
 CREATE TABLE IF NOT EXISTS gl_fishing_coin_entries(
 event_id BIGINT NOT NULL REFERENCES gl_fishing_coin_events(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL,user_name TEXT NOT NULL,fish_name TEXT NOT NULL,
 size_cm NUMERIC(12,2) NOT NULL,caught_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(event_id,user_id)
 );`);
}
async function status(room){
 const r=await getPool().query(`
 SELECT e.id,e.status,e.started_at,e.ends_at,e.winner_name,e.winning_fish,
 e.winning_size,e.winner_id,
 (SELECT COUNT(*)::int FROM gl_fishing_coin_entries x WHERE x.event_id=e.id) AS participants,
 (SELECT json_build_object('userName',x.user_name,'fishName',x.fish_name,'sizeCm',x.size_cm::text)
 FROM gl_fishing_coin_entries x WHERE x.event_id=e.id
 ORDER BY x.size_cm DESC,x.caught_at ASC,x.user_id ASC LIMIT 1) AS leader
 FROM gl_fishing_coin_events e WHERE e.room_id=$1 ORDER BY e.id DESC LIMIT 1`,[String(room)]);
 return r.rows[0]||null;
}
async function startEvent(room,roomName,chat,actor){
 await init();
 const db=await getPool().connect();
 let event;
 try{
  await db.query('BEGIN');
  const lock=await db.query('SELECT pg_advisory_xact_lock(hashtext($1))',[String(room)]);
  const active=await db.query("SELECT id FROM gl_fishing_coin_events WHERE room_id=$1 AND status='active' LIMIT 1",[String(room)]);
  if(active.rowCount)throw Error('이미 진행 중인 낚시 코인 이벤트가 있습니다.');
  const settings=await db.query("SELECT (data->>'game')::boolean AS game,COALESCE((data->>'fishEnabled')::boolean,TRUE) AS fishing FROM hz_rooms WHERE room_id=$1",[String(room)]);
  if(settings.rows[0]?.game!==true||settings.rows[0]?.fishing!==true)throw Error('이벤트를 시작하려면 게임과 낚시 기능이 모두 ON이어야 합니다.');
  const inserted=await db.query("INSERT INTO gl_fishing_coin_events(room_id,room_name,ends_at,created_by) VALUES($1,$2,NOW()+INTERVAL '2 minutes',$3) RETURNING id,ends_at",[String(room),String(roomName||room),String(actor||'web')]);
  event=inserted.rows[0];
  await chat.sendText(String(room),'🎉 코인 이벤트 발동!\n🎣 지금부터 2분 동안 가장 큰 물고기를 낚은 사람에게 100만 코인!!\n⏰ 제한 시간: 2분\n🏆 가장 큰 물고기 1마리 기준 (동점은 먼저 낚은 사람)\n🐟 !낚시로 참여하세요!');
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
 return {ok:true,eventId:String(event.id),endsAt:event.ends_at};
}
// Runs within the existing room transaction. Lock the event until the catch
// commits so the settlement cannot outrun an eligible successful catch.
async function recordCatch(db,{room,user,name,fish,size,at}){
 const cm=Number(size);
 if(!Number.isFinite(cm)||cm<=0)return;
 const atMs=Number(at);
 const events=await db.query(`
 SELECT id FROM gl_fishing_coin_events
 WHERE room_id=$1 AND status='active'
 AND started_at<=to_timestamp($2::double precision/1000.0)
 AND ends_at>to_timestamp($2::double precision/1000.0)
 FOR SHARE`,[String(room),atMs]);
 if(!events.rowCount)return;
 await db.query(`
 INSERT INTO gl_fishing_coin_entries(event_id,user_id,user_name,fish_name,size_cm,caught_at)
 VALUES($1,$2,$3,$4,$5,to_timestamp($6::double precision/1000.0))
 ON CONFLICT(event_id,user_id) DO UPDATE SET
 user_name=EXCLUDED.user_name,fish_name=EXCLUDED.fish_name,
 size_cm=EXCLUDED.size_cm,caught_at=EXCLUDED.caught_at
 WHERE EXCLUDED.size_cm>gl_fishing_coin_entries.size_cm`,
 [events.rows[0].id,String(user),String(name||user),String(fish),String(cm),atMs]);
}
async function finishExpired(){
 await init();
 const db=getPool();
 const due=await db.query("SELECT id FROM gl_fishing_coin_events WHERE status='active' AND ends_at<=NOW() ORDER BY ends_at LIMIT 20");
 for(const row of due.rows){
  const c=await db.connect();
  try{
   await c.query('BEGIN');
   const evt=await c.query("SELECT id,room_id FROM gl_fishing_coin_events WHERE id=$1 AND status='active' AND ends_at<=NOW() FOR UPDATE SKIP LOCKED",[row.id]);
   if(!evt.rowCount){await c.query('ROLLBACK');continue;}
   const room=evt.rows[0].room_id;
   const winner=await c.query(`SELECT user_id,user_name,fish_name,size_cm::text AS size
 FROM gl_fishing_coin_entries WHERE event_id=$1
 ORDER BY size_cm DESC,caught_at ASC,user_id ASC LIMIT 1`,[row.id]);
   if(winner.rowCount){
    const w=winner.rows[0];
    await ensureWallet(c,room,w.user_id,w.user_name);
    await c.query('UPDATE hz_wallets SET balance=balance+$3::numeric WHERE room_id=$1 AND user_id=$2',[room,w.user_id,String(PRIZE)]);
    await c.query("INSERT INTO hz_coin_logs(room_id,user_id,type,amount,detail) VALUES($1,$2,'EVENT_PRIZE',$3,$4)",[room,w.user_id,String(PRIZE),'2분 최대 물고기 코인 이벤트 #'+row.id]);
    await c.query("UPDATE gl_fishing_coin_events SET status='completed',winner_id=$2,winner_name=$3,winning_fish=$4,winning_size=$5 WHERE id=$1",[row.id,w.user_id,w.user_name,w.fish_name,w.size]);
   }else await c.query("UPDATE gl_fishing_coin_events SET status='completed' WHERE id=$1",[row.id]);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK').catch(()=>{});console.error('[FISH EVENT SETTLE]',String(e.message||e));}
  finally{c.release()}
 }
}
async function announceCompleted(chat){
 const db=getPool();
 const result=await db.query("SELECT id,room_id,winner_name,winning_fish,winning_size::text AS size,winner_id FROM gl_fishing_coin_events WHERE status='completed' AND announced_at IS NULL ORDER BY id LIMIT 20");
 for(const e of result.rows){
  try{
   const notice=e.winner_id
    ?'🏆 코인 낚시 이벤트 종료!\n🥇 우승: '+e.winner_name+'\n🐟 '+e.winning_fish+' · '+e.size+'cm\n🎁 1,000,000코인 지급 완료!'
    :'⏰ 코인 낚시 이벤트 종료!\n참가 기록이 없어 우승자와 코인 지급이 없습니다.';
   await chat.sendText(e.room_id,notice);
   await db.query('UPDATE gl_fishing_coin_events SET announced_at=NOW() WHERE id=$1 AND announced_at IS NULL',[e.id]);
  }catch(e){console.warn('[FISH EVENT ANNOUNCE]',String(e.message||e))}
 }
}
function startScheduler(client){
 if(timer)return;
 const tick=async()=>{
  if(busy||!client?.connected||typeof (client.chat||client)?.sendText!=='function')return;
  busy=true;
  try{await finishExpired();await announceCompleted(client.chat||client)}
  catch(e){console.error('[FISH EVENT TICK]',String(e.message||e))}
  finally{busy=false}
 };
 timer=setInterval(()=>{void tick()},2000);timer.unref?.();
 void tick();
}
module.exports={init,startEvent,recordCatch,status,startScheduler,finishExpired};
