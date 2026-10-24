'use strict';
// Only real KakaoTalk room notices are registered; never fallback to plain chat.
const {randomUUID}=require('node:crypto');
const {getPool}=require('./db');
const realNotice=require('./event-notice');
const initByPool=new WeakMap();
const PAGE_LIMIT=20,MAX_PENDING=50;
let timer=null,busy=false;
function kstParts(instant=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,hourCycle:'h23'}).formatToParts(instant);
 const val=key=>Number(parts.find(p=>p.type===key)?.value);
 return {year:val('year'),month:val('month'),day:val('day'),hour:val('hour'),minute:val('minute')};
}
function nextOccurrence(value,now=new Date()){
 if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value)))throw Error('시간은 24시간 형식 HH:MM으로 입력해 주세요. 예: !공지예약 18:30 공지내용');
 const [hour,minute]=value.split(':').map(Number),k=kstParts(now);
 let result=new Date(Date.UTC(k.year,k.month-1,k.day,hour-9,minute));
 if(result.getTime()<=now.getTime())result=new Date(result.getTime()+86400000);
 return result;
}
function describeKst(date){
 return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false,hourCycle:'h23'}).format(new Date(date)).replace(/,\s*/g,' ');
}
function validatedId(value){
 const id=String(value??'');if(!/^[1-9]\d*$/.test(id))throw Error('유효한 오픈채팅방 ID가 없습니다.');return id;
}
function availableAdapter(client,roomId,linkId){
 const adapter=realNotice.capability(client,linkId||undefined);
 if(!adapter)throw Error('현재 봇에 실제 카카오톡 공지 등록 연동이 없습니다. #이벤공지상태를 확인해 주세요.');
 if(adapter.experimental)require('./event-board-api').getLinkId(client,roomId,linkId||undefined);
 return adapter;
}
async function init(db=getPool()){
 let promise=initByPool.get(db);
 if(!promise){
  promise=(async()=>{
   await db.query('CREATE TABLE IF NOT EXISTS hz_scheduled_notice_sequences (room_id TEXT PRIMARY KEY, next_number BIGINT NOT NULL DEFAULT 1)');
   await db.query("CREATE TABLE IF NOT EXISTS hz_scheduled_notices ("+
    "room_id TEXT NOT NULL, number BIGINT NOT NULL, created_by TEXT NOT NULL, "+
    "body TEXT NOT NULL, scheduled_at TIMESTAMPTZ NOT NULL, open_link_id TEXT, "+
    "status TEXT NOT NULL DEFAULT 'pending', claim_token TEXT, "+
    "processing_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, post_id TEXT, "+
    "last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), "+
    "PRIMARY KEY(room_id,number), CONSTRAINT hz_scheduled_notices_status_check "+
    "CHECK(status IN ('pending','processing','posted','failed','unknown','missed')))");
   await db.query("CREATE INDEX IF NOT EXISTS hz_scheduled_notices_due_idx ON hz_scheduled_notices(scheduled_at) WHERE status='pending'");
  })().catch(err=>{initByPool.delete(db);throw err;});
  initByPool.set(db,promise);
 }
 await promise;
}
async function reserve({db=getPool(),roomId,creatorId,time,body,linkId,now=new Date()}){
 const room=validatedId(roomId),scheduled=nextOccurrence(time,now),content=realNotice.sanitize(body);
 await init(db);
 const conn=await db.connect();
 try{
  await conn.query('BEGIN');
  const count=await conn.query("SELECT count(*)::int AS count FROM hz_scheduled_notices WHERE room_id=$1 AND status IN ('pending','processing')",[room]);
  if(Number(count.rows[0]?.count||0)>=MAX_PENDING)throw Error('이 방의 대기 중인 예약은 최대 '+MAX_PENDING+'개입니다.');
  const counter=await conn.query('INSERT INTO hz_scheduled_notice_sequences(room_id,next_number) '+
   'VALUES($1,2) ON CONFLICT(room_id) DO UPDATE SET next_number=hz_scheduled_notice_sequences.next_number+1 '+
   'RETURNING next_number-1 AS number',[room]);
  const number=String(counter.rows[0].number);
  await conn.query('INSERT INTO hz_scheduled_notices (room_id,number,created_by,body,scheduled_at,open_link_id) '+
   'VALUES($1,$2,$3,$4,$5,$6)',[room,number,String(creatorId),content,scheduled,linkId||null]);
  await conn.query('COMMIT');
  return {number,scheduled,body:content};
 }catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
}
async function list(db,roomId){
 await init(db);
 const result=await db.query('SELECT number,body,scheduled_at,status,last_error FROM hz_scheduled_notices '+
  "WHERE room_id=$1 AND (status IN ('pending','processing') OR "+
  "(finished_at>NOW()-INTERVAL '24 hours' AND status IN ('posted','failed','unknown','missed'))) "+
  "ORDER BY CASE WHEN status IN ('pending','processing') THEN 0 ELSE 1 END, "+
  'scheduled_at ASC,number ASC LIMIT $2',[String(roomId),PAGE_LIMIT]);
 return result.rows;
}
async function remove(db,roomId,number){
 if(!/^[1-9]\d*$/.test(String(number??'')))throw Error('삭제할 예약 번호를 입력해 주세요. 예: !공지삭제 1');
 await init(db);
 const result=await db.query('DELETE FROM hz_scheduled_notices '+
  "WHERE room_id=$1 AND number=$2 AND status='pending' RETURNING number",[String(roomId),String(number)]);
 return result.rowCount>0;
}
function listText(rows){
 if(!rows.length)return '📋 예약된 공지가 없습니다.';
 const labels={pending:'예약',processing:'등록 중',posted:'공지 등록 완료',failed:'등록 실패',unknown:'확인 필요',missed:'시간 초과'};
 return '📋 공지 예약 목록\n━━━━━━━━━━━━━━━━━━\n'+rows.map(r=>
  r.number+'. ['+labels[r.status]+'] '+describeKst(r.scheduled_at)+'\n'+
  '┃ '+String(r.body).replace(/\s+/g,' ').slice(0,95)+
  (r.last_error&&['failed','unknown','missed'].includes(r.status)?'\n┗ '+String(r.last_error).slice(0,110):'')
 ).join('\n\n')+'\n━━━━━━━━━━━━━━━━━━';
}
async function handle(ctx,{db=getPool(),adapter}={}){
 const text=String(ctx.text||'').trim(),cmd=text.split(/\s+/)[0],room=validatedId(ctx.roomId),send=ctx.send;
 if(ctx.msg?.room?.isOpenChat!==true){await send('❌ 실제 공지 예약은 카카오톡 오픈채팅방에서만 가능합니다.');return true;}
 try{
  if(cmd==='!공지예약'){
   const match=/^!공지예약\s+(\S+)\s+([\s\S]+)$/.exec(text);
   if(!match){await send('사용법: !공지예약 (HH:MM) (내용)\n예: !공지예약 18:30 오늘 오후 회의가 있습니다.');return true;}
   const body=realNotice.sanitize(match[2]);nextOccurrence(match[1]);
   const integration=adapter||availableAdapter(ctx.client,room,ctx.msg.room.openLinkId);
   const linkId=integration.experimental?require('./event-board-api').getLinkId(ctx.client,room,ctx.msg.room.openLinkId):null;
   const item=await reserve({db,roomId:room,creatorId:ctx.userId,time:match[1],body,linkId});
   await send('✅ 실제 채팅방 공지 예약 접수\n번호: '+item.number+'\n등록 예정: '+
    describeKst(item.scheduled)+' (한국시간)\n내용: '+item.body+'\n'+
    (integration.experimental?'⚠️ 시험용 실제 공지 API입니다. 예약 시각에 등록 여부를 확인하며, 실패 시 일반 채팅으로 대체하지 않습니다.':
     '예약 시각에 실제 공지 등록 여부를 확인합니다. 일반 채팅으로 대체하지 않습니다.'));
   return true;
  }
  if(cmd==='!공지목록'){await send(listText(await list(db,room)));return true;}
  if(cmd==='!공지삭제'){
   const number=text.slice(cmd.length).trim();
   await send(await remove(db,room,number)?'✅ '+number+'번 공지 예약을 삭제했습니다.':
    '❌ 해당 번호의 대기 중인 예약이 없습니다. (등록 중이거나 완료된 공지는 삭제할 수 없습니다.)');
   return true;
  }
 }catch(e){
  console.error('[NOTICE SCHEDULER COMMAND]',String(e?.message||e));
  await send('❌ 공지 예약 처리 실패: '+String(e?.message||e).slice(0,250));return true;
 }
 return false;
}
async function mark(db,job,status,{postId=null,error=null}={}){
 await db.query('UPDATE hz_scheduled_notices SET status=$4,finished_at=NOW(),post_id=$5,last_error=$6 '+
  "WHERE room_id=$1 AND number=$2 AND claim_token=$3 AND status='processing'",
  [job.room_id,job.number,job.claim_token,status,postId,error?String(error).slice(0,400):null]);
}
async function runClaim(db,client,job,{adapter}={}){
 let selected=adapter;
 try{if(!selected)selected=availableAdapter(client,job.room_id,job.open_link_id);}
 catch(e){await mark(db,job,'failed',{error:String(e.message||e)});return 'failed';}
 try{
  const result=await realNotice.register({client,roomId:job.room_id,body:job.body,adapter:selected});
  if(result.registered===true){await mark(db,job,'posted',{postId:result.postId});return 'posted';}
  if(result.reason==='unsupported'){await mark(db,job,'failed',{error:'실제 공지 연동 없음'});return 'failed';}
  await mark(db,job,'unknown',{error:'실제 공지 등록 검증 실패 ('+String(result.reason||'응답 미확인')+')'});
  return 'unknown';
 }catch(err){
  console.error('[SCHEDULED NOTICE REGISTER]',String(err?.message||err));
  await mark(db,job,'unknown',{error:'실제 공지 확인 필요: '+String(err?.message||err)});
  return 'unknown';
 }
}
async function tick(client,{db=getPool(),adapter}={}){
 if(busy)return;busy=true;
 try{
  await init(db);
  await db.query('UPDATE hz_scheduled_notices '+
   "SET status='unknown',finished_at=NOW(),last_error='처리 중 연결 종료: 카카오톡 실제 공지 확인 필요' "+
   "WHERE status='processing' AND processing_at<NOW()-INTERVAL '3 minutes'");
  await db.query('UPDATE hz_scheduled_notices '+
   "SET status='missed',finished_at=NOW(),last_error='예약 시각 이후 10분 이상 지남 (자동 게시하지 않음)' "+
   "WHERE status='pending' AND scheduled_at<NOW()-INTERVAL '10 minutes'");
  if(client?.connected===false)return;
  const claimed=await db.query('WITH picked AS ('+
   'SELECT s.room_id,s.number FROM hz_scheduled_notices s '+
   "WHERE s.status='pending' AND s.scheduled_at<=NOW() "+
   'AND EXISTS (SELECT 1 FROM gl_manage_rooms m WHERE m.room_id=s.room_id AND m.enabled=TRUE) '+
   'ORDER BY s.scheduled_at,s.number LIMIT 5 FOR UPDATE OF s SKIP LOCKED '+
   ') UPDATE hz_scheduled_notices s '+
   "SET status='processing',processing_at=NOW(),claim_token=$1 "+
   'FROM picked WHERE s.room_id=picked.room_id AND s.number=picked.number RETURNING s.*',
   [randomUUID()]);
  for(const job of claimed.rows){
   try{await runClaim(db,client,job,{adapter});}
   catch(error){console.error('[SCHEDULED NOTICE JOB]',String(error?.message||error));}
  }
 }finally{busy=false;}
}
function start(client,{db=getPool(),intervalMs=15000}={}){
 if(timer)return timer;
 const run=()=>tick(client,{db}).catch(e=>console.error('[NOTICE SCHEDULER TICK]',String(e?.message||e)));
 timer=setInterval(run,intervalMs);if(typeof timer.unref==='function')timer.unref();
 void run();return timer;
}
module.exports={init,handle,reserve,list,remove,listText,nextOccurrence,kstParts,describeKst,availableAdapter,runClaim,tick,start};
