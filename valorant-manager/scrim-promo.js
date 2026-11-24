'use strict';
const management=require('./management');
const featureControls=require('./feature-controls');
const noShow=require('./scrim-no-show');
const {isAllowedRoom}=require('./allowed-rooms');
const MIN_INTERVAL=1,MAX_INTERVAL=1440;
const COMMANDS=new Set(['!내전홍보','!내전홍보끄기']);

async function init(db){
 await db.query(
  "CREATE TABLE IF NOT EXISTS vs_scrim_promotions ("+
  "room_id TEXT PRIMARY KEY,round_id BIGINT NOT NULL,interval_minutes INTEGER NOT NULL CHECK(interval_minutes BETWEEN 1 AND 1440),"+
  "enabled BOOLEAN NOT NULL DEFAULT TRUE,next_at TIMESTAMPTZ NOT NULL,last_sent_at TIMESTAMPTZ,"+
  "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
 );
 await db.query('CREATE INDEX IF NOT EXISTS vs_scrim_promotions_due ON vs_scrim_promotions(next_at) WHERE enabled');
}

async function isManager(ctx){
 return management.isOpenChatRoomManager(ctx)||(await management.role(ctx))>=1;
}

function parseInterval(raw){
 if(!/^[1-9]\d{0,3}$/.test(String(raw||'').trim()))return null;
 const n=Number(raw);
 return Number.isSafeInteger(n)&&n>=MIN_INTERVAL&&n<=MAX_INTERVAL?n:null;
}

function koreaDate(value){
 const parts=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'numeric',
  day:'numeric',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
 const get=type=>parts.find(x=>x.type===type)?.value||'';
 return get('year')+'년 '+get('month')+'월 '+get('day')+'일 ('+get('weekday')+') '+
  get('hour')+'시 '+get('minute')+'분';
}

function message(info){
 const count=Math.max(0,Number(info.active)||0),standby=Math.max(0,Number(info.standby)||0);
 const free=Math.max(0,10-count);
 return [
  '🎯 VALORANT SCHOOL | 내전 참가자 모집',
  '━━━━━━━━━━━━━━━━',
  '📅 내전 시작: '+koreaDate(info.scheduled_at)+' (한국시간)',
  '',
  '👥 정규 참가: '+count+'/10명',
  '🪑 남은 자리: '+free+'명',
  '⭐ 대기 후보: '+standby+'명',
  '📌 모집 상태: '+(free?'정규 참가 모집 중':'정규 참가 마감 · 후보 모집 중'),
  '',
  '━━━━━━━━━━━━━━━━',
  '✅ 참가 방법',
  '1. !내전등록 티어/디스코드닉/닉#태그',
  '2. !내전참여 (정규 참가)',
  '3. !후보참여 (후보 대기)',
  '',
  '📢 !내전시간 / !내전참가자로 일정과 명단을 확인하세요.'
 ].join('\n');
}

async function snapshot(db,room){
 const r=await db.query('SELECT scheduled_at,round_id FROM vs_scrims WHERE room_id=$1',[room]);
 const event=r.rows[0];
 if(!event?.scheduled_at||!event.round_id||!Number.isFinite(new Date(event.scheduled_at).getTime()))return null;
 if(new Date(event.scheduled_at).getTime()<=Date.now())return null;
 await noShow.evictBlocked(db,room,event.round_id);
 const counts=await db.query(
  "SELECT COUNT(*) FILTER (WHERE status='active')::int AS active,"+
  "COUNT(*) FILTER (WHERE status='substitute')::int AS standby "+
  "FROM vs_scrim_players WHERE room_id=$1",[room]);
 return {...event,active:counts.rows[0]?.active||0,standby:counts.rows[0]?.standby||0};
}

async function handle(ctx){
 const cmd=String(ctx.text||'').trim().split(/\s+/)[0];
 if(!COMMANDS.has(cmd))return false;
 if(!await isManager(ctx))return ctx.send('⛔ 관리자만 사용할 수 있는 내전 홍보 명령어입니다.');
 const room=String(ctx.roomId),db=ctx.db;
 if(cmd==='!내전홍보끄기'){
  const r=await db.query('UPDATE vs_scrim_promotions SET enabled=FALSE,updated_at=NOW() WHERE room_id=$1 AND enabled=TRUE RETURNING room_id',[room]);
  return ctx.send(r.rowCount?'⏹️ 내전 자동 홍보를 중지했습니다.':'ℹ️ 현재 진행 중인 내전 자동 홍보가 없습니다.');
 }
 const raw=String(ctx.text||'').trim().slice(cmd.length).trim(),minutes=parseInterval(raw);
 if(minutes===null){
  const q=await db.query('SELECT enabled,interval_minutes FROM vs_scrim_promotions WHERE room_id=$1',[room]);
  const status=q.rows[0]?.enabled?'🔁 현재 '+q.rows[0].interval_minutes+'분 간격으로 홍보 중입니다.':'⏹️ 현재 자동 홍보가 꺼져 있습니다.';
  return ctx.send('사용법: !내전홍보 (간격 분)\n예: !내전홍보 30 — 즉시 1회 홍보한 뒤 30분마다 반복\n중지: !내전홍보끄기\n'+status);
 }
 const info=await snapshot(db,room);
 if(!info)return ctx.send('❌ 아직 시작하지 않은 내전 예약이 없습니다. 먼저 !내전예약으로 일정을 등록해 주세요.');
 // Only this room's current round is promoted. A new reservation never silently inherits the old promo.
 await db.query(
  "INSERT INTO vs_scrim_promotions(room_id,round_id,interval_minutes,enabled,next_at,last_sent_at,updated_at) "+
  "VALUES($1,$2,$3,TRUE,NOW()+($3::int * INTERVAL '1 minute'),NOW(),NOW()) "+
  "ON CONFLICT(room_id) DO UPDATE SET round_id=$2,interval_minutes=$3,enabled=TRUE,"+
  "next_at=NOW()+($3::int * INTERVAL '1 minute'),last_sent_at=NOW(),updated_at=NOW()",
  [room,info.round_id,minutes]);
 return ctx.send(message(info)+'\n\n🔁 자동 홍보: '+minutes+'분 간격\n⏹️ 중지: !내전홍보끄기');
}

async function processDue(db,sendByRoom){
 const r=await db.query(
  "SELECT p.room_id,p.round_id FROM vs_scrim_promotions p "+
  "LEFT JOIN vs_room_settings settings ON settings.room_id=p.room_id "+
  "WHERE p.enabled=TRUE AND p.next_at<=NOW() AND COALESCE(settings.enabled,TRUE)=TRUE "+
  "ORDER BY p.next_at LIMIT 30"
 );
 for(const promotion of r.rows){
  const room=String(promotion.room_id);
  if(!isAllowedRoom(room))continue;
  const send=sendByRoom.get(room);
  if(typeof send!=='function')continue;
  try{
   const mode=await featureControls.load(db,room);
   if(!featureControls.isEnabled(mode,'!내전홍보'))continue;
   const claimed=await db.query(
    "UPDATE vs_scrim_promotions SET next_at=NOW()+(interval_minutes * INTERVAL '1 minute'),updated_at=NOW() "+
    "WHERE room_id=$1 AND round_id=$2 AND enabled=TRUE AND next_at<=NOW() RETURNING round_id",
    [room,promotion.round_id]);
   if(!claimed.rowCount)continue; // Atomic claim: other bot workers must not send duplicates.
   const info=await snapshot(db,room);
   if(!info||String(info.round_id)!==String(promotion.round_id)){
    await db.query('UPDATE vs_scrim_promotions SET enabled=FALSE,updated_at=NOW() WHERE room_id=$1 AND round_id=$2',
     [room,promotion.round_id]);
    continue;
   }
   const result=await send(message(info));
   const status=result?.status??result?.body?.status;
   if(result===false||result?.success===false||(status!=null&&Number(status)!==0))
    throw Error('KakaoTalk promotion send rejected');
   await db.query('UPDATE vs_scrim_promotions SET last_sent_at=NOW() WHERE room_id=$1 AND round_id=$2',[room,promotion.round_id]);
  }catch(error){
   console.warn('[SCHOOL SCRIM PROMO]',room,String(error?.message||error).slice(0,130));
   // Retry transient failures without hammering the Kakao or database APIs.
   await db.query("UPDATE vs_scrim_promotions SET next_at=NOW()+INTERVAL '1 minute' WHERE room_id=$1 AND round_id=$2 AND enabled=TRUE",
    [room,promotion.round_id]).catch(()=>{});
  }
 }
}

module.exports={COMMANDS,init,handle,processDue,message,snapshot,parseInterval,koreaDate};
