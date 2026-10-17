'use strict';
const {getPool}=require('../shared/db'),{id,transaction,roomTransaction,audit}=require('../shared/store');
const accounts=require('./accounts'),promotion=require('./index'),{fail}=accounts;
async function access(db,user,room){const r=await db.query('SELECT u.id FROM gl_promo_users u JOIN gl_promo_room_access a ON a.user_id=u.id WHERE u.id=$1 AND u.enabled AND a.room_id=$2',[user,room]);if(!r.rowCount)fail('이 채팅방의 홍보 권한이 없습니다.',403);}
function view(p={}){return {message:p.message||'',minutes:[20,30].includes(Number(p.minutes))?Number(p.minutes):20,enabled:!!p.enabled,allowed:p.allowed===true,stopReason:p.stopReason||'',nextAt:promotion.nextBoundary(p.minutes||20)};}
async function routes(req,res,url,b,status){const p=url.pathname,m=req.method;
 if(p==='/api/promo/login'&&m==='POST')return accounts.login(req,res,b);
 if(p==='/api/promo/register'&&m==='POST')return accounts.register(req,res,b);
 const s=await accounts.session(req);
 if(p==='/api/promo/session'&&m==='GET')return s?accounts.response(s):{authenticated:false};
 if(!s)fail('홍보 계정으로 로그인해 주세요.',401);if(m!=='GET')accounts.csrf(req,s);
 if(p==='/api/promo/logout'&&m==='POST')return accounts.logout(req,res,s);
 if(p==='/api/promo/password'&&m==='POST')return accounts.changePassword(req,res,s,b);
 if(p==='/api/promo/rooms'&&m==='GET'){await require('./rooms').refresh(status.client).catch(()=>{});const r=await getPool().query("SELECT r.room_id,r.data->>'name' AS name,r.data->'promo' AS promo,a.user_id IS NOT NULL AS can_manage FROM hz_rooms r LEFT JOIN gl_promo_room_access a ON a.room_id=r.room_id AND a.user_id=$1 ORDER BY r.room_id",[s.user.id]);return {rooms:r.rows.map(r=>r.can_manage?{id:r.room_id,name:r.name||'채팅방',canManage:true,promotion:view(r.promo)}:{id:null,name:r.name||'채팅방',canManage:false}),connected:status.connected};}
 if(p==='/api/promo/logs'&&m==='GET'){const room=id(url.searchParams.get('roomId'));await access(getPool(),s.user.id,room);const r=await getPool().query('SELECT status,created_at FROM gl_promotion_logs WHERE portal_user_id=$1 AND room_id=$2 ORDER BY id DESC LIMIT 50',[s.user.id,room]);return {logs:r.rows};}
 if(p==='/api/promo/promotion'&&m==='POST'){
  const room=id(b.roomId),action=b.action;if(!['content','start','stop','delete','immediate','interval'].includes(action))fail('지원하지 않는 홍보 작업입니다.');
  if(action==='immediate'){if(b.confirm!==true)fail('전송을 확인해 주세요.');if(!status.connected||!status.chat)fail('봇이 연결되어 있지 않습니다.',503);return {sent:await promotion.deliver(room,status.chat,true,s.user.id)};}
  const result=await roomTransaction(room,async(d,db)=>{await access(db,s.user.id,room);const starting=action==='start'||action==='interval'&&d.promo?.enabled;if(starting&&d.promo?.allowed!==true)fail('운영자의 홍보 허용이 필요합니다.',403);if(['start','interval'].includes(action)&&![20,30].includes(Number(b.minutes)))fail('20분 또는 30분을 선택해 주세요.');if(action==='interval'&&!starting){d.promo=d.promo||{};d.promo.minutes=Number(b.minutes);d.promo.clockAligned=true;}else d.promo=promotion.patch(d.promo,action==='interval'?'start':action,{message:b.message,minutes:b.minutes});d.promo.portalUserId=s.user.id;if(action==='stop')d.promo.stopReason='사용자가 OFF로 변경';await audit(db,'promo:'+s.user.id,'PROMO_'+action,room,null,{});return view(d.promo);});return {promotion:result};
 }
 fail('요청한 API를 찾을 수 없습니다.',404);
}
async function roomIds(input,db){if(!Array.isArray(input)||input.length>10)fail('채팅방은 최대 10개까지 지정해 주세요.');const rooms=[...new Set(input.map(id))].sort();for(const room of rooms){const r=await db.query('SELECT room_id FROM hz_rooms WHERE room_id=$1',[room]);if(!r.rowCount)fail('등록된 채팅방만 지정할 수 있습니다.');}return rooms;}
async function admin(req,url,b,s){const p=url.pathname,m=req.method;
 if(p==='/api/admin/promo-invites'&&m==='GET'){const r=await getPool().query('SELECT id,label,room_ids,expires_at,used_at,revoked_at,created_at FROM gl_promo_invites ORDER BY id DESC LIMIT 100');return {invites:r.rows};}
 if(p==='/api/admin/promo-invites'&&m==='POST'){const label=String(b.label||'').trim(),hours=Number(b.hours||72);if(!label||label.length>60||![24,72,168].includes(hours))fail('이름과 초대 유효기간을 확인해 주세요.');const token=accounts.random();return transaction(async db=>{const rooms=await roomIds(b.roomIds,db);if(!rooms.length)fail('허용할 채팅방을 선택해 주세요.');const r=await db.query("INSERT INTO gl_promo_invites(token_hash,label,room_ids,created_by,expires_at) VALUES($1,$2,$3::jsonb,$4,NOW()+$5*INTERVAL '1 hour') RETURNING id,expires_at",[accounts.digest(token),label,JSON.stringify(rooms),s.user,hours]);await audit(db,s.user,'PROMO_INVITE_CREATE',null,null,{id:r.rows[0].id,rooms});return {invite:{...r.rows[0],path:'/promo/#invite='+token}};});}
 if(p==='/api/admin/promo-invites'&&m==='DELETE')return transaction(async db=>{await db.query('UPDATE gl_promo_invites SET revoked_at=NOW() WHERE id=$1 AND used_at IS NULL',[id(b.id)]);await audit(db,s.user,'PROMO_INVITE_REVOKE',null,null,{id:b.id});return {ok:true};});
 if(p==='/api/admin/promo-members'&&m==='GET'){const r=await getPool().query("SELECT u.id,u.username,u.display_name,u.enabled,u.created_at,COALESCE(jsonb_agg(a.room_id) FILTER(WHERE a.room_id IS NOT NULL),'[]'::jsonb) AS room_ids FROM gl_promo_users u LEFT JOIN gl_promo_room_access a ON a.user_id=u.id GROUP BY u.id ORDER BY u.id DESC LIMIT 200");return {members:r.rows};}
 if(p==='/api/admin/promo-members'&&m==='POST')return transaction(async db=>{
  const user=id(b.id),rooms=await roomIds(b.roomIds,db);if(typeof b.enabled!=='boolean')fail('회원 상태를 확인해 주세요.');
  // Same lock order as delivery: rooms first, then account. Revoke and delivery serialize.
  const owned=await db.query("SELECT room_id,data FROM hz_rooms WHERE data->'promo'->>'portalUserId'=$1 ORDER BY room_id FOR UPDATE",[user]);
  const r=await db.query('SELECT id FROM gl_promo_users WHERE id=$1 FOR UPDATE',[user]);if(!r.rowCount)fail('회원을 찾을 수 없습니다.',404);
  for(const row of owned.rows)if(!b.enabled||!rooms.includes(row.room_id)){row.data.promo.enabled=false;row.data.promo.nextRunAt=null;row.data.promo.stopReason='운영자가 홍보 권한을 해제';await db.query('UPDATE hz_rooms SET data=$2::jsonb,updated_at=NOW() WHERE room_id=$1',[row.room_id,JSON.stringify(row.data)]);}
  await db.query('UPDATE gl_promo_users SET enabled=$2 WHERE id=$1',[user,b.enabled]);await db.query('DELETE FROM gl_promo_room_access WHERE user_id=$1',[user]);for(const room of rooms)await db.query('INSERT INTO gl_promo_room_access(user_id,room_id) VALUES($1,$2)',[user,room]);if(!b.enabled)await db.query('DELETE FROM gl_promo_sessions WHERE user_id=$1',[user]);await audit(db,s.user,'PROMO_MEMBER_UPDATE',null,user,{enabled:b.enabled,rooms});return {ok:true};
 });
 fail('요청한 API를 찾을 수 없습니다.',404);
}
module.exports={routes,admin,access,view};
