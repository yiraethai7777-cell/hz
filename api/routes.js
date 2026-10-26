'use strict';
const {getPool}=require('../shared/db');
const {id,transaction,roomTransaction,audit}=require('../shared/store');
const auth=require('./auth');
const promotion=require('../promotion');
const status={ready:false,connected:false,startedAt:Date.now(),errors:[]};
function fail(message,statusCode=400){const e=Error(message);e.status=statusCode;throw e;}
function publicUrl(){const value=process.env.GL_OPENCHAT_URL||'';try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='open.kakao.com'?u.href:null;}catch{return null;}}
async function rankings(kind){
 const metrics={coin:"w.balance+CASE WHEN l.user_id IS NULL THEN COALESCE((r.data->'players'->p.user_id->>'points')::numeric,0) ELSE 0 END",level:"COALESCE((r.data->'players'->p.user_id->>'level')::numeric,1)",quiz:"COALESCE((r.data->'players'->p.user_id->>'wins')::numeric,0)",fishing:"jsonb_array_length(COALESCE(r.data->'players'->p.user_id->'inventory','[]'::jsonb))"};
 if(!Object.hasOwn(metrics,kind))fail('올바른 순위 종류를 선택해 주세요.');
 const rows=await getPool().query(`SELECT p.alias,(${metrics[kind]})::text AS score FROM gl_public_profiles p JOIN hz_wallets w USING(room_id,user_id) JOIN hz_rooms r USING(room_id) LEFT JOIN gl_economy_links l ON l.room_id=p.room_id AND l.user_id=p.user_id WHERE p.consent ORDER BY (${metrics[kind]}) DESC,p.updated_at LIMIT 30`);
 return {kind,entries:rows.rows.map((row,i)=>({rank:i+1,alias:row.alias,score:row.score}))};
}
async function overview(){
 const [counts,events,promos]=await Promise.all([
  getPool().query("SELECT (SELECT count(*) FROM hz_wallets)::int AS users,(SELECT count(*) FROM hz_rooms WHERE data->>'game'='true')::int AS active_rooms,(SELECT COALESCE(sum(balance),0)::text FROM hz_wallets) AS coins"),
  getPool().query("SELECT kind,count(*)::int AS n FROM gl_game_events WHERE (created_at AT TIME ZONE 'Asia/Seoul')::date=(NOW() AT TIME ZONE 'Asia/Seoul')::date GROUP BY kind"),
  getPool().query("SELECT count(*)::int AS n FROM hz_rooms WHERE data->'promo'->>'enabled'='true'")
 ]);
 return {...counts.rows[0],events:events.rows,promotion_rooms:promos.rows[0].n,bot:{ready:status.ready,connected:status.connected},uptimeSeconds:Math.floor((Date.now()-status.startedAt)/1000),errors:status.errors.slice(-10),railwayStatus:'외부 Railway 상태는 이 화면에서 수집하지 않습니다.'};
}
async function routes(req,res,url,body){
 const p=url.pathname,method=req.method;
 if(p==='/api/public/config'&&method==='GET')return {name:'',openchatUrl:publicUrl(),online:status.ready&&status.connected};
 if(!status.ready)fail('봇과 데이터베이스를 준비 중입니다.',503);
 if(p.startsWith('/api/promo/'))return require('../promotion/portal').routes(req,res,url,body,status);
 if(p==='/api/public/rankings'&&method==='GET')return rankings(url.searchParams.get('kind')||'coin');
 if(p==='/api/public/notices'&&method==='GET'){const r=await getPool().query('SELECT id,title,body,pinned,created_at FROM gl_notices WHERE published ORDER BY pinned DESC,created_at DESC LIMIT 30');return {notices:r.rows};}
 if(p==='/api/login'&&method==='POST')return auth.login(req,res,body);
 const s=await auth.session(req);
 if(p==='/api/session'&&method==='GET')return s?{authenticated:true,csrf:s.csrf,user:s.user}:{authenticated:false,configured:auth.config().ready};
 if(!s)fail('관리자 로그인이 필요합니다.',401);
 if(method!=='GET')auth.csrf(req,s);
 if(p.startsWith('/api/admin/promo-'))return require('../promotion/portal').admin(req,url,body,s);
 if(p==='/api/logout'&&method==='POST')return auth.logout(req,res,s);
 if(p==='/api/admin/overview'&&method==='GET')return overview();
 if(p==='/api/admin/attendance-image-test'&&method==='POST')return require('../manage/attendance-image/preview').sendTest(status.client,body);
 if(p==='/api/admin/promotion-message'&&method==='GET')return {message:await promotion.commonMessage()||''};
 if(p==='/api/admin/promotion-message'&&method==='POST')return promotion.setCommonMessage(s.user,body);
 if(p==='/api/admin/rooms'&&method==='GET'){
  // Show only rooms still joined by the bot. Preserve all historical DB records.
  if(!status.connected||typeof status.client?.getChatRooms!=='function'||typeof status.client?.getKnownChatRooms!=='function')
    fail('카카오톡 연결 상태를 확인할 수 없어 채팅방 목록을 불러오지 못했습니다.',503);
  await require('../promotion/rooms').refresh(status.client,{force:true});
  const activeRoomIds=[...new Set(status.client.getKnownChatRooms()
    .map(room=>String(room.id||''))
    .filter(roomId=>/^\d{1,24}$/.test(roomId)))];
  if(!activeRoomIds.length)return {rooms:[]};
  const r=await getPool().query("SELECT r.room_id,r.data->>'name' AS name,COALESCE((r.data->>'game')::boolean,FALSE) AS game,COALESCE(g.enabled,(r.data->>'manage')::boolean,FALSE) AS manage,COALESCE((r.data->>'quizEnabled')::boolean,TRUE) AS quiz_enabled,COALESCE((r.data->>'fishEnabled')::boolean,TRUE) AS fish_enabled,r.data->'promo' AS promotion FROM hz_rooms r LEFT JOIN gl_manage_rooms g USING(room_id) WHERE r.room_id = ANY($1::text[]) ORDER BY r.updated_at DESC LIMIT 200",[activeRoomIds]);return {rooms:r.rows};
 }
 if(p==='/api/admin/rooms'&&method==='POST'){
  const room=id(body.roomId),flags=body.flags||{};
  const allowed=['game','manage','quizEnabled','fishEnabled'];if(!Object.keys(flags).length||Object.keys(flags).some(key=>!allowed.includes(key)||typeof flags[key]!=='boolean'))fail('변경할 기능 설정을 확인해 주세요.');
  await roomTransaction(room,async(d,db)=>{Object.assign(d,flags);if(typeof flags.manage==='boolean')await db.query('INSERT INTO gl_manage_rooms(room_id,enabled) VALUES($1,$2) ON CONFLICT(room_id) DO UPDATE SET enabled=$2',[room,flags.manage]);await audit(db,s.user,'ROOM_FLAGS',room,null,flags);});return {ok:true};
 }
 if(p==='/api/admin/room-admins'&&method==='GET'){
  const room=id(url.searchParams.get('roomId'));
  const r=await getPool().query('SELECT user_id FROM gl_manage_admins WHERE room_id=$1 ORDER BY user_id',[room]);
  return {admins:r.rows};
 }
 if(p==='/api/admin/room-admins'&&method==='POST'){
  const room=id(body.roomId),user=id(body.userId),action=String(body.action||'');
  if(!['add','remove'].includes(action))fail('추가 또는 삭제 작업을 선택해 주세요.');
  const db=getPool();
  const exists=await db.query('SELECT 1 FROM hz_rooms WHERE room_id=$1',[room]);
  if(!exists.rowCount)fail('등록되지 않은 채팅방입니다.',404);
  return transaction(async c=>{
   const q=action==='add'
    ?'INSERT INTO gl_manage_admins(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING'
    :'DELETE FROM gl_manage_admins WHERE room_id=$1 AND user_id=$2';
   const changed=await c.query(q,[room,user]);
   await audit(c,s.user,action==='add'?'ROOM_ADMIN_ADD':'ROOM_ADMIN_REMOVE',room,user,{changed:changed.rowCount>0});
   return {ok:true,changed:changed.rowCount>0};
  });
 }
 if(p==='/api/admin/users'&&method==='GET'){
  const room=id(url.searchParams.get('roomId')),search=String(url.searchParams.get('search')||'').slice(0,80);
  const r=await getPool().query('SELECT w.user_id,w.user_name,w.balance::text,r.data->\'players\'->w.user_id AS player FROM hz_wallets w LEFT JOIN hz_rooms r USING(room_id) WHERE w.room_id=$1 AND (w.user_id=$2 OR w.user_name ILIKE $3) ORDER BY w.user_name LIMIT 50',[room,search,'%'+search+'%']);return {users:r.rows};
 }
 if(p==='/api/admin/user'&&method==='GET'){
  const room=id(url.searchParams.get('roomId')),user=id(url.searchParams.get('userId'));
  const [wallet,roomData,stocks]=await Promise.all([getPool().query('SELECT user_id,user_name,balance::text FROM hz_wallets WHERE room_id=$1 AND user_id=$2',[room,user]),getPool().query('SELECT data FROM hz_rooms WHERE room_id=$1',[room]),getPool().query('SELECT symbol,stock_name,quantity,total_cost::text FROM hz_stock_holdings WHERE room_id=$1 AND user_id=$2',[room,user])]);
  if(!wallet.rowCount)fail('사용자를 찾을 수 없습니다.',404);return {wallet:wallet.rows[0],player:roomData.rows[0]?.data?.players?.[user]||null,stocks:stocks.rows};
 }
 if(p==='/api/admin/coins'&&method==='POST'){
  if(body.confirm!==true)fail('코인 조정을 재확인해 주세요.');
  return require('../game/admin-coins').adjust({room:id(body.roomId),user:id(body.userId),actor:s.user,amount:Number(body.amount),operationId:body.operationId,reason:String(body.reason||'웹 관리자 조정').slice(0,200)});
 }
 if(p==='/api/admin/promotion'&&method==='POST'){
  if(body.action==='start'&&![20,30].includes(Number(body.minutes)))fail('20분 또는 30분을 선택해 주세요.');
  const room=id(body.roomId);if(body.action==='immediate'){
   if(body.confirm!==true)fail('즉시 전송을 재확인해 주세요.');if(!status.chat)fail('카카오톡 연결이 필요합니다.',503);
   await audit(getPool(),s.user,'PROMOTION_IMMEDIATE',room,null,{});return {sent:await promotion.deliver(room,status.chat,true)};
  }
  return {promotion:await promotion.configure(room,s.user,body.action,{message:body.message,minutes:body.minutes,allowed:body.allowed,botWeb:true})};
 }
 if(p==='/api/admin/promotion/logs'&&method==='GET'){
  const r=await getPool().query('SELECT status,detail,created_at FROM gl_promotion_logs WHERE room_id=$1 ORDER BY id DESC LIMIT 50',[id(url.searchParams.get('roomId'))]);return {logs:r.rows,stats:await promotion.stats(id(url.searchParams.get('roomId')))};
 }
 if(p==='/api/admin/notices'&&method==='GET'){const r=await getPool().query('SELECT * FROM gl_notices ORDER BY pinned DESC,id DESC LIMIT 100');return {notices:r.rows};}
 if(p==='/api/admin/notices'&&method==='POST'){
  const title=String(body.title||'').trim(),text=String(body.body||'').trim();if(!title||title.length>100||!text||text.length>5000)fail('제목은 1~100자, 내용은 1~5,000자입니다.');
  return transaction(async db=>{const r=body.id?await db.query('UPDATE gl_notices SET title=$2,body=$3,pinned=$4,published=$5 WHERE id=$1 RETURNING id',[body.id,title,text,body.pinned===true,body.published!==false]):await db.query('INSERT INTO gl_notices(title,body,pinned) VALUES($1,$2,$3) RETURNING id',[title,text,body.pinned===true]);if(!r.rowCount)fail('공지를 찾을 수 없습니다.',404);await audit(db,s.user,'NOTICE_SAVE',null,null,{id:r.rows[0].id});return {id:r.rows[0].id};});
 }
 if(p==='/api/admin/notices'&&method==='DELETE'){
  return transaction(async db=>{await db.query('UPDATE gl_notices SET published=FALSE WHERE id=$1',[body.id]);await audit(db,s.user,'NOTICE_HIDE',null,null,{id:body.id});return {ok:true};});
 }
 if(p==='/api/admin/audit'&&method==='GET'){const r=await getPool().query('SELECT actor,action,room_id,target_id,detail,created_at FROM gl_audit ORDER BY id DESC LIMIT 100');return {records:r.rows};}
 fail('요청한 API를 찾을 수 없습니다.',404);
}
module.exports={routes,status,rankings,overview};
