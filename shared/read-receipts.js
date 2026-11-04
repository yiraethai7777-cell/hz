'use strict';
// Only watermarks actually received by NEXI are tracked. Missing users are unknown.
const {getPool}=require('./db');
const {reference}=require('./reply-delete');
const {enabled:roomEnabled}=require('./bot-power');
const MAX_ROWS=40;
let schemaPromise=null;
function numeric(value){
 if(value==null)return '';
 if(typeof value==='number')return Number.isSafeInteger(value)&&value>0?String(value):'';
 if(typeof value==='bigint')return value>0n?String(value):'';
 const raw=String(typeof value==='object'&&typeof value.toString==='function'?value.toString():value);
 return /^[1-9]\d{0,24}$/.test(raw)?raw:'';
}
function parsePush(packet){
 const body=packet?.body||packet?.payload?.body||packet?.payload||packet||{};
 const room=numeric(body.chatId??body.chat_id??body.c);
 const user=numeric(body.userId??body.user_id??body.u);
 const watermark=numeric(body.watermark??body.waterMark??body.w);
 return room&&user&&watermark?{room,user,watermark}:null;
}
async function init(db=getPool()){
 if(!schemaPromise){
  schemaPromise=db.query(`CREATE TABLE IF NOT EXISTS hz_read_watermarks (
   room_id TEXT NOT NULL, user_id TEXT NOT NULL, watermark NUMERIC(25,0) NOT NULL,
   observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(room_id,user_id)
  )`).catch(e=>{schemaPromise=null;throw e;});
 }
 await schemaPromise;
}
async function observe(packet,{db=getPool(),botId='',power=roomEnabled}={}){
 const event=parsePush(packet);
 if(!event||event.user===numeric(botId))return false;
 if(!await power(event.room,db))return false;
 await init(db);
 await db.query(`INSERT INTO hz_read_watermarks(room_id,user_id,watermark)
   VALUES($1,$2,$3::numeric)
   ON CONFLICT(room_id,user_id) DO UPDATE SET
    watermark=GREATEST(hz_read_watermarks.watermark,EXCLUDED.watermark),
    observed_at=CASE WHEN EXCLUDED.watermark>hz_read_watermarks.watermark
      THEN NOW() ELSE hz_read_watermarks.observed_at END`,
   [event.room,event.user,event.watermark]);
 return true;
}
function register(client,ready=Promise.resolve()){
 if(typeof client?.onPush!=='function'){
  console.warn('[READ RECEIPTS] onPush API unavailable');
  return false;
 }
 client.onPush('DECUNREAD',packet=>{
  void Promise.resolve(ready).then(()=>observe(packet,{botId:client.userId}))
   .catch(error=>console.error('[READ RECEIPTS] push persist failed',String(error?.code||error?.message||error)));
 });
 console.log('[READ RECEIPTS] DECUNREAD listener registered (open-chat delivery unverified)');
 return true;
}
async function report({roomId,msg,db=getPool(),botId=''}){
 const room=numeric(roomId),ref=reference(msg),messageId=numeric(ref?.log);
 if(!room||!messageId)
  return '👁️ NEXI | 읽기감지\n확인할 메시지에 카카오톡 답장으로 !읽기감지를 입력해 주세요.';
 await init(db);
 const result=await db.query(`SELECT r.user_id,r.watermark::text AS watermark,r.observed_at,
   COALESCE(NULLIF(m.name,''),NULLIF(g.user_name,''),NULLIF(w.user_name,''),r.user_id) AS user_name
   FROM hz_read_watermarks r
   LEFT JOIN hz_members m ON m.room_id=r.room_id AND m.user_id=r.user_id
   LEFT JOIN gl_manage_members g ON g.room_id=r.room_id AND g.user_id=r.user_id
   LEFT JOIN hz_wallets w ON w.room_id=r.room_id AND w.user_id=r.user_id
   WHERE r.room_id=$1 AND r.watermark >= $2::numeric AND r.user_id<>$3
   ORDER BY r.observed_at DESC,r.user_id LIMIT $4`,[room,messageId,numeric(botId)||'0',MAX_ROWS+1]);
 const rows=result.rows.slice(0,MAX_ROWS),hasMore=result.rows.length>MAX_ROWS;
 return ['👁️ NEXI | 메시지 읽음 감지',
  '━━━━━━━━━━━━━━━━',
  '📩 메시지 ID: '+messageId,
  '✅ 수신된 읽음 이벤트로 확인된 사용자: '+rows.length+(hasMore?'+':'')+'명',
  ...rows.map((x,i)=>(i+1)+'. '+String(x.user_name||x.user_id).slice(0,80)+' ('+x.user_id+')'),
  rows.length?'':'확인된 읽음 이벤트가 없습니다.',
  '━━━━━━━━━━━━━━━━',
  '※ 봇이 수신한 DECUNREAD 이벤트만 반영합니다.',
  '※ 목록에 없다고 읽지 않았다는 뜻은 아닙니다.',
  '※ 실제 이벤트가 수신되지 않는 방은 확인할 수 없습니다.'].join('\n');
}
module.exports={numeric,parsePush,init,observe,register,report};
