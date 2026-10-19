'use strict';
const {getPool}=require('../shared/db');
const {roomTransaction,transaction,audit}=require('../shared/store');
async function commonMessage(db=getPool()){const r=await db.query('SELECT message FROM gl_bot_promotion_settings WHERE id=1');return r.rows[0]?.message??null;}
async function setCommonMessage(actor,input){const deleting=input.action==='delete';if(deleting&&input.confirm!==true)throw Error('전체 방 중지를 확인해 주세요.');const message=deleting?'':String(input.message||'').trim();if(!deleting&&(!message||message.length>1000))throw Error('홍보 문구는 1~1,000자로 입력해 주세요.');return transaction(async db=>{await db.query('INSERT INTO gl_bot_promotion_settings(id,message) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET message=$1,updated_at=NOW()',[message]);if(deleting)await db.query("UPDATE hz_rooms SET data=jsonb_set(data,'{promo,enabled}','false'::jsonb),updated_at=NOW() WHERE data->'promo' IS NOT NULL AND data->'promo'->>'portalUserId' IS NULL");await audit(db,actor,deleting?'BOT_PROMOTION_DELETE':'BOT_PROMOTION_CONTENT',null,null,{});return {message};});}
const MIN_MINUTES=5,MAX_MINUTES=120;
function nextBoundary(minutes,now=Date.now()){const step=([20,30].includes(Number(minutes))?Number(minutes):20)*60000;return (Math.floor(now/step)+1)*step;}
function boundaryDue(minutes,now=Date.now()){return now%(Number(minutes)*60000)<60000;}
function patch(p,action,input={}){
 p=p&&typeof p==='object'?p:{};
 if(action==='content'){const text=String(input.message||'').trim();if(!text||text.length>1000)throw Error('홍보 문구는 1~1,000자로 입력해 주세요.');p.message=text;}
 else if(action==='interval'){const minutes=Number(input.minutes);if(![20,30].includes(minutes))throw Error('20분 또는 30분을 선택해 주세요.');p.minutes=minutes;p.clockAligned=true;p.nextRunAt=null;p.lastSlot=Math.floor(Date.now()/(minutes*60000));}
 else if(action==='start'){
  const minutes=Number(input.minutes);if(!Number.isInteger(minutes)||minutes<MIN_MINUTES||minutes>MAX_MINUTES)throw Error('전송 간격은 5~120분입니다.');
  if(!p.message)throw Error('홍보 문구를 먼저 설정해 주세요.');
  if(p.allowed===false&&input.botWeb!==true)throw Error('허용되지 않은 홍보방입니다. 관리자 화면에서 허용해 주세요.');
  p.allowed=true;p.minutes=minutes;p.enabled=true;p.clockAligned=[20,30].includes(minutes);p.nextRunAt=null;p.lastSlot=Math.floor(Date.now()/(minutes*60000));p.stopReason='';
 }else if(action==='stop'){p.enabled=false;p.nextRunAt=null;p.stopReason='관리자가 중지';}
 else if(action==='delete'){p.enabled=false;p.message='';p.stopReason='문구 삭제';}
 else if(action==='allow'){p.allowed=input.allowed===true;if(!p.allowed)p.enabled=false;}
 else throw Error('지원하지 않는 홍보 작업입니다.');
 return p;
}
async function configure(room,actor,action,input){return roomTransaction(room,async(d,db)=>{const shared=await commonMessage(db);if(action==='start'&&shared!==null)d.promo={...d.promo,message:shared};d.promo=patch(d.promo,action,input);if(['content','start','schedule','delete'].includes(action))delete d.promo.portalUserId;await audit(db,actor,'PROMOTION_'+action,room,null,{enabled:!!d.promo.enabled,minutes:d.promo.minutes,allowed:d.promo.allowed});return d.promo;});}
async function stats(room){const r=await getPool().query("SELECT status,count(*)::int count FROM gl_promotion_logs WHERE room_id=$1 GROUP BY status",[String(room)]);return r.rows;}
async function deliver(room,chat,immediate=false,requester=null){
 let content=null,slot=null;
 await roomTransaction(room,async(d,db)=>{
  const p=d.promo||{},now=Date.now();
  const shared=p.portalUserId?null:await commonMessage(db);const message=shared??p.message;
  if(requester){await require('./portal').access(db,requester,String(room));if(p.allowed!==true){const e=Error('운영자의 홍보 허용이 필요합니다.');e.status=403;throw e;}}
  if(p.portalUserId){const owner=await db.query('SELECT id FROM gl_promo_users WHERE id=$1 AND enabled FOR UPDATE',[p.portalUserId]);const access=await db.query('SELECT 1 FROM gl_promo_room_access WHERE user_id=$1 AND room_id=$2',[p.portalUserId,String(room)]);if(!owner.rowCount||!access.rowCount){p.enabled=false;p.nextRunAt=null;p.stopReason='홍보 권한 해제';return;}}
  if(d.locked||(p.allowed!==true&&!p.enabled)||p.allowed===false||!message||(!immediate&&!p.enabled))return;
  if(now-Number(p.lastAttempt||0)<MIN_MINUTES*60000)return;
  const minutes=Number(p.minutes||MIN_MINUTES);if(minutes<MIN_MINUTES||minutes>MAX_MINUTES)return;
  const current=Math.floor(now/(minutes*60000));
  // Only send during the scheduled minute. Reconnects never send missed promotions in a burst.
  if(!immediate&&(p.clockAligned||[20,30].includes(minutes))&&!boundaryDue(minutes,now))return;
  if(!immediate&&p.lastSlot!=null&&Number(p.lastSlot)===current)return;
  slot=immediate?'manual:'+Math.floor(now/(MIN_MINUTES*60000)):'auto:'+minutes+':'+current;
  const claimed=await db.query("INSERT INTO gl_promotion_logs(room_id,slot,status,portal_user_id) VALUES($1,$2,'PENDING',$3) ON CONFLICT DO NOTHING RETURNING id",[String(room),slot,requester||p.portalUserId||null]);
  if(!claimed.rowCount)return;
  p.lastAttempt=now;p.lastSlot=current;p.nextRunAt=null;d.promo=p;content=message;
 });
 if(!content)return false;
 try{await chat.sendText(room,content);await getPool().query("UPDATE gl_promotion_logs SET status='SENT' WHERE room_id=$1 AND slot=$2",[String(room),slot]);return true;}
 catch(e){await getPool().query("UPDATE gl_promotion_logs SET status='FAILED',detail=$3 WHERE room_id=$1 AND slot=$2",[String(room),slot,String(e.message||'전송 실패').slice(0,200)]);return false;}
}
let ticking=false;
async function tick(chat){if(!chat||ticking)return;ticking=true;try{const r=await getPool().query("SELECT room_id FROM hz_rooms WHERE data->'promo'->>'enabled'='true' ORDER BY room_id LIMIT 500");for(const row of r.rows)await deliver(row.room_id,chat);}finally{ticking=false;}}
async function handleCommand(ctx,client){
 const {text,roomId,userId,send}=ctx;
 return false;
 const owners=String(process.env.HZ_OWNER_IDS||process.env.HZ_OWNER_ID||'').split(/[\s,;]+/);
 const admins=await getPool().query('SELECT 1 FROM gl_manage_admins WHERE room_id=$1 AND user_id=$2',[String(roomId),String(userId)]);
 if(!ctx.isBotAccount&&!owners.includes(String(userId))&&!admins.rowCount){await send('⛔ 홍보 관리 권한이 없습니다.');return true;}
 try{
  const [command,...args]=text.split(/\s+/);const arg=args.join(' ');
  if(command==='!홍보확인'){const r=await getPool().query('SELECT data FROM hz_rooms WHERE room_id=$1',[String(roomId)]);const p=r.rows[0]?.data?.promo||{};await send(`📢 홍보: ${p.enabled?'작동':'중지'}\n간격: ${p.minutes||'미설정'}분\n문구: ${p.message||'없음'}`);}
  else if(command==='!홍보통계'){const s=await stats(roomId);await send('📊 홍보 전송 기록\n'+(s.map(v=>`${v.status}: ${v.count}회`).join('\n')||'기록 없음'));}
  else if(command==='!홍보즉시'){await audit(getPool(),String(userId),'PROMOTION_IMMEDIATE',String(roomId),null,{});await send(await deliver(roomId,client.chat||client,true)?'📢 전송 완료':'최근 5분 내 전송했거나, 전송 가능한 문구가 없습니다.');}
  else {const action=command==='!홍보시작'?'start':command==='!홍보중지'?'stop':command==='!홍보삭제'?'delete':'content';await configure(roomId,userId,action,{message:arg,minutes:arg});await send('✅ 홍보 설정을 저장했습니다.');}
 }catch(e){await send('❌ '+e.message);}return true;
}
module.exports={commonMessage,setCommonMessage,patch,configure,stats,deliver,tick,handleCommand,MIN_MINUTES,MAX_MINUTES,nextBoundary,boundaryDue};
