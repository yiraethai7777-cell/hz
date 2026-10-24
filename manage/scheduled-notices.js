'use strict';

// Schedule real KakaoTalk room notices, NOT ordinary chat messages.
// External registration is verified before a notice is recorded as successful.
// Do not retry an uncertain registration: the post may already have been created.
const {randomUUID}=require('node:crypto');
const KST=9*60*60*1000;
const MAX_BODY=2000;
let initPromise=null;
let timer=null;
let busy=false;

function validRoom(roomId){
  const id=String(roomId??'');
  if(!/^\d{1,30}$/.test(id))throw new Error('올바른 채팅방 ID가 필요합니다.');
  return id;
}
function parseTime(value){
  const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value??'').trim());
  if(!m)throw new Error('시간을 HH:MM 형식으로 입력해 주세요. 예: !공지예약 18:30 모임 시작');
  return {hour:Number(m[1]),minute:Number(m[2])};
}
function nextOccurrence(clock,now=Date.now()){
  const {hour,minute}=parseTime(clock);
  const d=new Date(now+KST);
  const start=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),hour,minute)-KST;
  return new Date(start>now?start:start+24*60*60*1000);
}
function formatKST(value){
  const d=new Date(new Date(value).getTime()+KST);
  if(!Number.isFinite(d.getTime()))return '시간 확인 불가';
  const pad=n=>String(n).padStart(2,'0');
  return d.getUTCFullYear()+'.'+pad(d.getUTCMonth()+1)+'.'+pad(d.getUTCDate())+
    ' '+pad(d.getUTCHours())+':'+pad(d.getUTCMinutes());
}
function cleanContent(value){
  const content=String(value??'').replace(/\r\n?/g,'\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g,'').trim();
  if(!content)throw new Error('공지 내용을 입력해 주세요.');
  if(content.length>MAX_BODY)throw new Error('공지 내용은 최대 '+MAX_BODY+'자입니다.');
  return content;
}
function message(content){
  return '📢 공지사항\n━━━━━━━━━━━━━━━━━━\n'+cleanContent(content)+
    '\n━━━━━━━━━━━━━━━━━━';
}
async function init(db){
  if(!initPromise){
    initPromise=(async()=>{
      await db.query("CREATE TABLE IF NOT EXISTS hz_notice_counters ("+
        "room_id TEXT PRIMARY KEY, last_no INTEGER NOT NULL DEFAULT 0)");
      await db.query("CREATE TABLE IF NOT EXISTS hz_scheduled_notices ("+
        "room_id TEXT NOT NULL, notice_no INTEGER NOT NULL, creator_id TEXT NOT NULL, "+
        "scheduled_at TIMESTAMPTZ NOT NULL, content TEXT NOT NULL, "+
        "state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','failed')),"+
        "attempts INTEGER NOT NULL DEFAULT 0, claim_token TEXT, claimed_at TIMESTAMPTZ,"+
        "next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_error TEXT,"+
        "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sent_at TIMESTAMPTZ,"+
        "PRIMARY KEY (room_id,notice_no))");
      await db.query('ALTER TABLE hz_scheduled_notices ADD COLUMN IF NOT EXISTS open_link_id TEXT');
      await db.query('ALTER TABLE hz_scheduled_notices ADD COLUMN IF NOT EXISTS post_id TEXT');
      await db.query("CREATE INDEX IF NOT EXISTS hz_scheduled_notices_due_idx "+
        "ON hz_scheduled_notices(scheduled_at,next_attempt_at) WHERE state='pending'");
    })().catch(e=>{initPromise=null;throw e;});
  }
  await initPromise;
}
async function schedule(db,{roomId,userId,time,content,linkId=null,now}){
  await init(db);
  const room=validRoom(roomId),creator=String(userId??'');
  const body=cleanContent(content),date=nextOccurrence(time,now);
  if(!/^\d{4,}$/.test(creator))throw new Error('예약자의 사용자 ID를 확인할 수 없습니다.');
  const connection=await db.connect();
  try{
    await connection.query('BEGIN');
    const count=await connection.query(
      "SELECT COUNT(*)::int AS count FROM hz_scheduled_notices "+
      "WHERE room_id=$1 AND state IN ('pending','sending')",[room]);
    if(Number(count.rows[0]?.count||0)>=100)throw new Error('채팅방당 대기 중인 예약은 최대 100개입니다.');
    const seq=await connection.query(
      'INSERT INTO hz_notice_counters(room_id,last_no) VALUES($1,1) '+
      'ON CONFLICT(room_id) DO UPDATE SET last_no=hz_notice_counters.last_no+1 RETURNING last_no',
      [room]);
    const number=Number(seq.rows[0].last_no);
    await connection.query(
      'INSERT INTO hz_scheduled_notices(room_id,notice_no,creator_id,scheduled_at,content,open_link_id) '+
      'VALUES($1,$2,$3,$4,$5,$6)',[room,number,creator,date,body,linkId]);
    await connection.query('COMMIT');
    return {noticeNo:number,scheduledAt:date,content:body};
  }catch(e){
    await connection.query('ROLLBACK');
    throw e;
  }finally{connection.release();}
}
async function list(db,roomId){
  await init(db);
  const r=await db.query(
    "SELECT notice_no,scheduled_at,content,state,last_error FROM hz_scheduled_notices "+
    "WHERE room_id=$1 AND state IN ('pending','failed') ORDER BY notice_no",
    [validRoom(roomId)]);
  return r.rows;
}
async function remove(db,roomId,number){
  await init(db);
  const n=Number(number);
  if(!Number.isSafeInteger(n)||n<1)throw new Error('삭제할 공지 번호를 입력해 주세요. 예: !공지삭제 1');
  const r=await db.query(
    "DELETE FROM hz_scheduled_notices WHERE room_id=$1 AND notice_no=$2 "+
    "AND state IN ('pending','failed') RETURNING notice_no",
    [validRoom(roomId),n]);
  return r.rowCount>0;
}
function formatList(rows){
  if(!rows.length)return '📋 예약한 공지가 없습니다.';
  const entries=rows.map(r=>{
    const preview=String(r.content).replace(/\s+/g,' ').slice(0,80);
    const state=r.state==='failed'?' · ⚠️ 전송 실패':'';
    return '#'+r.notice_no+' ┃ '+formatKST(r.scheduled_at)+state+'\n┃ '+preview+
      (r.content.length>80?'…':'');
  });
  return '📋 예약 공지 목록 ('+rows.length+'개)\n━━━━━━━━━━━━━━━━━━\n'+
    entries.join('\n┣━━━━━━━━━━━━━━━━━━┫\n')+'\n┗━━━━━━━━━━━━━━━━━━┛'+
    '\n!공지삭제 (번호)로 예약을 삭제할 수 있습니다.';
}
function noticeCapability(client,roomId,linkId){
  const notice=require('../shared/event-notice');
  const adapter=notice.capability(client,linkId||undefined);
  if(!adapter)throw new Error('실제 채팅방 공지 등록 연동을 사용할 수 없습니다. 봇 로그인 상태와 공지 권한·설정을 확인해 주세요.');
  if(adapter.experimental){
    require('../shared/event-board-api').getLinkId(client,roomId,linkId||undefined);
  }
  return adapter;
}
async function registerActualNotice(client,roomId,content,linkId,adapter){
  const real=require('../shared/event-notice');
  const selected=adapter||noticeCapability(client,roomId,linkId);
  const result=await real.register({client,roomId,body:cleanContent(content),adapter:selected});
  if(!result.registered)throw new Error('서버에서 실제 공지 등록을 확인하지 못했습니다: '+String(result.reason||'응답 미확인'));
  return result;
}
async function tick({db,client,logger=console,adapter}){
  if(client?.connected===false)return 0;
  await init(db);
  // Mark a stale in-flight job failed rather than silently repeating a message
  // whose send may already have succeeded before a process crash.
  await db.query("UPDATE hz_scheduled_notices SET state='failed',claim_token=NULL,"+
    "last_error='실제 공지 등록 중 중단: 카카오톡 공지 목록에서 확인 필요' "+
    "WHERE state='sending' AND claimed_at < NOW()-INTERVAL '5 minutes'");
  const token=randomUUID();
  const claimed=await db.query(
    "WITH due AS (SELECT n.room_id,n.notice_no FROM hz_scheduled_notices n "+
    "WHERE n.state='pending' AND n.scheduled_at<=NOW() AND n.next_attempt_at<=NOW() "+
    "AND COALESCE((SELECT enabled FROM gl_manage_rooms WHERE room_id=n.room_id),"+
    "(SELECT (data->>'manage')::boolean FROM hz_rooms WHERE room_id=n.room_id),FALSE)=TRUE "+
    "ORDER BY n.scheduled_at,n.room_id,n.notice_no LIMIT 10 FOR UPDATE OF n SKIP LOCKED) "+
    "UPDATE hz_scheduled_notices n SET state='sending',claim_token=$1,claimed_at=NOW(),"+
    "attempts=n.attempts+1 FROM due "+
    "WHERE n.room_id=due.room_id AND n.notice_no=due.notice_no "+
    "RETURNING n.room_id,n.notice_no,n.content,n.open_link_id,n.attempts",
    [token]);
  for(const notice of claimed.rows){
    try{
      if(client?.connected===false)throw Error('카카오톡 연결이 끊어졌습니다.');
      const result=await registerActualNotice(client,notice.room_id,notice.content,notice.open_link_id,adapter);
      await db.query("UPDATE hz_scheduled_notices SET state='sent',sent_at=NOW(),claim_token=NULL,"+
        "claimed_at=NULL,last_error=NULL,post_id=$4 WHERE room_id=$1 AND notice_no=$2 "+
        "AND state='sending' AND claim_token=$3",
        [notice.room_id,notice.notice_no,token,result.postId||null]);
      logger.info?.('[NOTICE SCHEDULE] real room notice registered',notice.room_id,notice.notice_no);
    }catch(error){
      logger.error?.('[NOTICE SCHEDULE] failed',notice.room_id,notice.notice_no,String(error?.message||error));
      try{
        // An API timeout may have registered the notice. Never retry automatically.
        await db.query(
          "UPDATE hz_scheduled_notices SET state='failed',claim_token=NULL,claimed_at=NULL,"+
          "last_error=$4 WHERE room_id=$1 AND notice_no=$2 AND state='sending' AND claim_token=$3",
          [notice.room_id,notice.notice_no,token,
           '실제 공지 등록 결과 확인 필요: '+String(error?.message||error).slice(0,420)]);
      }catch(dbError){logger.error?.('[NOTICE SCHEDULE] DB state update failed',dbError);}
    }
  }
  return claimed.rows.length;
}
function start(client,{db,intervalMs=15000,logger=console}={}){
  if(timer)return;
  const getDb=()=>db||require('../shared/db').getPool();
  const check=async()=>{
    if(busy)return;
    busy=true;
    try{await tick({db:getDb(),client,logger});}
    catch(error){logger.error?.('[NOTICE SCHEDULE] tick failed',error);}
    finally{busy=false;}
  };
  timer=setInterval(check,intervalMs);
  timer.unref?.();
  // Run immediately to catch up after a restart.
  void check();
}
function stop(){
  if(timer)clearInterval(timer);
  timer=null;
}
module.exports={parseTime,nextOccurrence,formatKST,cleanContent,message,init,schedule,list,
  remove,formatList,noticeCapability,registerActualNotice,tick,start,stop};
