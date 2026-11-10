'use strict';
const {getPool}=require('./db');
const PLANS=Object.freeze({
 manage:{label:'관리',manage:true,game:false},
 game:{label:'게임',manage:false,game:true},
 all:{label:'종합',manage:true,game:true}
});
const schema="CREATE TABLE IF NOT EXISTS gl_room_subscriptions ("+
 "room_id TEXT PRIMARY KEY,plan TEXT NOT NULL CHECK(plan IN ('manage','game','all')),"+
 "duration_days INTEGER NOT NULL CHECK(duration_days>0),"+
 "started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL,"+
 "status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','expired')),"+
 "revision INTEGER NOT NULL DEFAULT 1,announced_revision INTEGER NOT NULL DEFAULT 0,"+
 "actor_id TEXT NOT NULL,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())";
let initialized;
let timer;
let busy=false;
function validRoom(room){const s=String(room??'');if(!/^[1-9]\d{0,29}$/.test(s))throw Error('채팅방 ID가 올바르지 않습니다.');return s;}
function validPlan(plan){if(!Object.hasOwn(PLANS,String(plan)))throw Error('관리·게임·종합 중 요금제를 선택해 주세요.');return String(plan);}
function validDays(days){const n=Number(days);if(!Number.isInteger(n)||n<1||n>3650)throw Error('이용 일수는 1~3650일 사이의 정수로 입력해 주세요.');return n;}
async function init(db=getPool()){
 if(db!==getPool()){
  await db.query(schema);
  await db.query("CREATE TABLE IF NOT EXISTS gl_room_subscription_legacy (room_id TEXT PRIMARY KEY)");
  return;
 }
 if(!initialized)initialized=(async()=>{
  await db.query(schema);
  await db.query("CREATE TABLE IF NOT EXISTS gl_room_subscription_legacy (room_id TEXT PRIMARY KEY)");
  await db.query("CREATE TABLE IF NOT EXISTS gl_room_subscription_setup (singleton SMALLINT PRIMARY KEY CHECK(singleton=1),configured_at TIMESTAMPTZ DEFAULT NOW())");
  // One-time grandfathering: rooms already configured before billing is
  // deployed keep working. Newly joined, unlicensed rooms do not.
  const c=await db.connect();
  try{
   await c.query('BEGIN');
   const first=await c.query('INSERT INTO gl_room_subscription_setup(singleton) VALUES(1) ON CONFLICT DO NOTHING RETURNING singleton');
   if(first.rowCount)await c.query('INSERT INTO gl_room_subscription_legacy(room_id) SELECT room_id FROM hz_rooms ON CONFLICT DO NOTHING');
   await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 })().catch(error=>{initialized=null;throw error;});
 await initialized;
}
async function permitted(roomId,db=getPool()){
 const room=validRoom(roomId);
 await init(db);
 const result=await db.query("SELECT"+
  " EXISTS(SELECT 1 FROM gl_room_subscriptions WHERE room_id=$1) AS issued,"+
  " EXISTS(SELECT 1 FROM gl_room_subscriptions WHERE room_id=$1 AND status='active' AND expires_at>NOW()) AS active,"+
  " EXISTS(SELECT 1 FROM gl_room_subscription_legacy WHERE room_id=$1) AS legacy",
 [room]);
 const d=result.rows[0];
 return d.issued?d.active:d.legacy;
}
function view(row,now=Date.now()){
 if(!row)return null;
 const expiry=new Date(row.expires_at).getTime();
 const remainingSeconds=Math.max(0,Math.ceil((expiry-now)/1000));
 return {roomId:row.room_id,plan:row.plan,planLabel:PLANS[row.plan]?.label||row.plan,
  durationDays:Number(row.duration_days),startsAt:new Date(row.started_at).toISOString(),
  expiresAt:new Date(row.expires_at).toISOString(),remainingSeconds,
  active:row.status==='active'&&remainingSeconds>0,
  status:row.status==='active'&&remainingSeconds>0?'active':'expired'};
}
async function get(roomId,db=getPool()){
 const room=validRoom(roomId);
 await init(db);
 const r=await db.query('SELECT * FROM gl_room_subscriptions WHERE room_id=$1',[room]);
 return view(r.rows[0]);
}
function timeLeft(seconds){
 if(seconds<=0)return '0분 (만료)';
 const days=Math.floor(seconds/86400),hours=Math.floor((seconds%86400)/3600),mins=Math.floor((seconds%3600)/60);
 return [days?days+'일':'',hours?hours+'시간':'',mins?mins+'분':''].filter(Boolean).join(' ')||'1분 미만';
}
function dateKST(value){return new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
function notice(info,kind='start'){
 const pkg=PLANS[info.plan],features=info.plan==='all'?'관리 + 게임':pkg.label;
 return [
  '🤖 카카오톡 매니저 | '+(kind==='extend'?'요금제 연장':'봇 서비스 시작'),
  '━━━━━━━━━━━━',
  kind==='extend'?'✅ 봇 이용 기간이 연장되었습니다.':'✅ 봇 작동을 시작합니다.',
  '📦 요금제 : '+info.planLabel+' ('+features+')',
  '📅 이용 기간 : '+(info.durationDays===7?'일주일 (7일)':info.durationDays+'일'),
  '⏳ 자동 종료까지 : '+timeLeft(info.remainingSeconds),
  '🗓️ 자동 종료 예정 : '+dateKST(info.expiresAt)+' (한국 시간)',
  '━━━━━━━━━━━━',
  '📌 이용 기간이 종료되면 해당 방의 봇이 자동으로 중지됩니다.'
 ].join('\n');
}
async function applyPlan(db,room,plan){
 const flags=PLANS[plan];
 if(!flags)throw Error('요금제가 올바르지 않습니다.');
 await db.query("INSERT INTO hz_rooms(room_id,data) VALUES($1,jsonb_build_object("+
   "'botEnabled',TRUE,'manage',$2::boolean,'game',$3::boolean,"+
   "'quizEnabled',$3::boolean,'fishEnabled',$3::boolean))"+
 " ON CONFLICT(room_id) DO UPDATE SET data=hz_rooms.data"+
   " || jsonb_build_object('botEnabled',TRUE,'manage',$2::boolean,'game',$3::boolean,"+
   "'quizEnabled',$3::boolean,'fishEnabled',$3::boolean),updated_at=NOW()",
 [room,flags.manage,flags.game]);
 await db.query('INSERT INTO gl_manage_rooms(room_id,enabled) VALUES($1,$2) ON CONFLICT(room_id) DO UPDATE SET enabled=$2',[room,flags.manage]);
}
async function grant(db,{roomId,plan,days,actor}){
 const room=validRoom(roomId),pkg=validPlan(plan),period=validDays(days);
 const r=await db.query("INSERT INTO gl_room_subscriptions(room_id,plan,duration_days,expires_at,actor_id)"+
   " VALUES($1,$2,$3,NOW()+$3::int*INTERVAL '1 day',$4)"+
   " ON CONFLICT(room_id) DO NOTHING RETURNING *",
 [room,pkg,period,String(actor)]);
 if(!r.rowCount)throw Error('이미 요금제가 발급된 방입니다. 기간 연장을 사용해 주세요.');
 await applyPlan(db,room,pkg);
 return view(r.rows[0]);
}
async function changePlan(db,{roomId,plan,actor}){
 const room=validRoom(roomId),pkg=validPlan(plan);
 const r=await db.query("UPDATE gl_room_subscriptions SET plan=$2,actor_id=$3,"+
  "revision=revision+1,updated_at=NOW() WHERE room_id=$1 RETURNING *",[room,pkg,String(actor)]);
 if(!r.rowCount)throw Error('먼저 해당 방에 요금제를 발급해 주세요.');
 const data=view(r.rows[0]);
 if(data.active)await applyPlan(db,room,pkg);
 return data;
}
async function extend(db,{roomId,days,actor}){
 const room=validRoom(roomId),period=validDays(days);
 const r=await db.query("UPDATE gl_room_subscriptions SET "+
  "expires_at=GREATEST(expires_at,NOW())+$2::int*INTERVAL '1 day',"+
  "duration_days=duration_days+$2,status='active',actor_id=$3,"+
  "revision=revision+1,updated_at=NOW() WHERE room_id=$1 RETURNING *",
 [room,period,String(actor)]);
 if(!r.rowCount)throw Error('먼저 해당 방에 요금제를 발급해 주세요.');
 await applyPlan(db,room,r.rows[0].plan);
 return view(r.rows[0]);
}
async function expire(db=getPool()){
 await init(db);
 const c=await db.connect();
 try{
  await c.query('BEGIN');
  const r=await c.query("UPDATE gl_room_subscriptions SET status='expired',updated_at=NOW()"+
   " WHERE status='active' AND expires_at<=NOW() RETURNING room_id");
  for(const row of r.rows){
   await c.query("UPDATE hz_rooms SET data=data || jsonb_build_object("+
     "'botEnabled',FALSE,'manage',FALSE,'game',FALSE,'quizEnabled',FALSE,'fishEnabled',FALSE),"+
     "updated_at=NOW() WHERE room_id=$1",[row.room_id]);
   await c.query('UPDATE gl_manage_rooms SET enabled=FALSE WHERE room_id=$1',[row.room_id]);
  }
  await c.query('COMMIT');
  return r.rows.map(row=>row.room_id);
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
async function sendNotice(client,roomId,db=getPool()){
 if(!client?.connected||typeof (client.chat||client)?.sendText!=='function')return false;
 const room=validRoom(roomId);
 await init(db);
 const r=await db.query("SELECT * FROM gl_room_subscriptions WHERE room_id=$1"+
   " AND status='active' AND expires_at>NOW() AND announced_revision<revision",[room]);
 const row=r.rows[0];if(!row)return false;
 const known=client.getKnownChatRooms?.();
 if(Array.isArray(known)&&!known.some(x=>String(x.id)===room))return false;
 const data=view(row);
 await (client.chat||client).sendText(room,notice(data,row.revision>1?'extend':'start'));
 await db.query('UPDATE gl_room_subscriptions SET announced_revision=$2 WHERE room_id=$1 AND revision=$2',[room,row.revision]);
 return true;
}
async function sweep(client){
 if(busy)return;
 busy=true;
 try{
  const expired=await expire();
  if(expired.length){
   const runtime=require('./runtime');
   for(const room of expired){try{await runtime.syncQuizRoom(room);}catch(error){console.warn('[ROOM SUB EXPIRE CACHE]',room,String(error?.message||error));}}
   console.log('[ROOM SUB] expired',expired.length);
  }
  if(!client?.connected)return;
  const db=getPool();
  const pending=await db.query("SELECT room_id FROM gl_room_subscriptions"+
    " WHERE status='active' AND expires_at>NOW() AND announced_revision<revision ORDER BY updated_at LIMIT 20");
  for(const row of pending.rows){
   try{await sendNotice(client,row.room_id,db);}
   catch(error){console.warn('[ROOM SUB NOTICE]',row.room_id,String(error?.code||error?.message||error));}
  }
 }catch(error){console.error('[ROOM SUB SWEEP]',String(error?.code||error?.message||error));}
 finally{busy=false;}
}
async function start(client){
 await init();
 await sweep(client);
 if(timer)clearInterval(timer);
 timer=setInterval(()=>{void sweep(client);},15000);
 timer.unref?.();
}
module.exports={PLANS,init,permitted,get,view,validPlan,validDays,timeLeft,notice,grant,changePlan,extend,expire,sendNotice,sweep,start};
