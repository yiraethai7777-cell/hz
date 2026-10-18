'use strict';
const {getPool}=require('../shared/db'),{id,transaction,roomTransaction,audit}=require('../shared/store');
const accounts=require('./accounts'),promotion=require('./index'),{fail}=accounts;
async function access(db,user,room){const r=await db.query('SELECT u.id FROM gl_promo_users u JOIN gl_promo_room_access a ON a.user_id=u.id WHERE u.id=$1 AND u.enabled AND a.room_id=$2',[user,room]);if(!r.rowCount)fail('이 채팅방의 홍보 권한이 없습니다.',403);}
function view(p={}){return {message:p.message||'',minutes:[20,30].includes(Number(p.minutes))?Number(p.minutes):20,enabled:!!p.enabled,allowed:p.allowed===true,stopReason:p.stopReason||'',nextAt:promotion.nextBoundary(p.minutes||20)};}
async function routes(req,res,url,b,status){const p=url.pathname,m=req.method,service=require('./kakao').service();
 const s=await accounts.session(req);
 if(p==='/api/promo/qr/start'&&m==='POST')return service.startQr(req,res,b,s);
 if(p==='/api/promo/qr/poll'&&m==='POST')return service.pollQr(req,res,b);
 if(p==='/api/promo/qr/cancel'&&m==='POST')return service.cancelQr(req,res,b);
 if(p==='/api/promo/login'&&m==='POST')return accounts.login(req,res,b);
 if(p==='/api/promo/register'&&m==='POST')return accounts.register(req,res,b);
 if(p==='/api/promo/session'&&m==='GET')return s?accounts.response(s):{authenticated:false};
 if(!s)fail('홍보 계정으로 로그인해 주세요.',401);if(m!=='GET')accounts.csrf(req,s);
 if(p==='/api/promo/logout'&&m==='POST')return accounts.logout(req,res,s);
 if(p==='/api/promo/setup-login'&&m==='POST')return accounts.setupLogin(req,res,s,b);
 if(p==='/api/promo/password'&&m==='POST')return accounts.changePassword(req,res,s,b);
 if(p==='/api/promo/disconnect'&&m==='POST')return service.disconnect(s.user.id);
 if(p==='/api/promo/message'&&m==='GET')return {message:await service.commonMessage(s.user.id)};
 if(p==='/api/promo/message'&&m==='POST')return service.setMessage(s.user.id,b.action||'content',b);
 if(p==='/api/promo/rooms'&&m==='GET')return service.rooms(s.user.id);
 if(p==='/api/promo/logs'&&m==='GET'){const room=id(url.searchParams.get('roomId'));const own=await getPool().query('SELECT 1 FROM gl_promo_account_rooms WHERE user_id=$1 AND room_id=$2',[s.user.id,room]);if(!own.rowCount)fail('본인 계정의 방만 조회할 수 있습니다.',403);const r=await getPool().query('SELECT status,created_at FROM gl_promo_account_logs WHERE user_id=$1 AND room_id=$2 ORDER BY id DESC LIMIT 50',[s.user.id,room]);return {logs:r.rows};}
 if(p==='/api/promo/promotion'&&m==='POST')return service.configure(s.user.id,id(b.roomId),b.action,b);
 fail('요청한 API를 찾을 수 없습니다.',404);
}
async function admin(req,url,b,s){const p=url.pathname,m=req.method;
 if(p==='/api/admin/promo-invites'&&m==='GET'){const r=await getPool().query('SELECT id,label,room_ids,expires_at,used_at,revoked_at,created_at FROM gl_promo_invites ORDER BY id DESC LIMIT 100');return {invites:r.rows};}
 if(p==='/api/admin/promo-invites'&&m==='POST'){const label=String(b.label||'').trim(),hours=Number(b.hours||72);if(!label||label.length>60||![24,72,168].includes(hours))fail('이름과 초대 유효기간을 확인해 주세요.');const token=accounts.random();return transaction(async db=>{const rooms=[];const r=await db.query("INSERT INTO gl_promo_invites(token_hash,label,room_ids,created_by,expires_at) VALUES($1,$2,$3::jsonb,$4,NOW()+$5*INTERVAL '1 hour') RETURNING id,expires_at",[accounts.digest(token),label,JSON.stringify(rooms),s.user,hours]);await audit(db,s.user,'PROMO_INVITE_CREATE',null,null,{id:r.rows[0].id,rooms});return {invite:{...r.rows[0],path:'/promo/#invite='+token}};});}
 if(p==='/api/admin/promo-invites'&&m==='DELETE')return transaction(async db=>{await db.query('UPDATE gl_promo_invites SET revoked_at=NOW() WHERE id=$1 AND used_at IS NULL',[id(b.id)]);await audit(db,s.user,'PROMO_INVITE_REVOKE',null,null,{id:b.id});return {ok:true};});
 if(p==='/api/admin/promo-members'&&m==='GET'){const r=await getPool().query("SELECT u.id,u.username,u.display_name,u.enabled,u.created_at,COALESCE(jsonb_agg(a.room_id) FILTER(WHERE a.room_id IS NOT NULL),'[]'::jsonb) AS room_ids FROM gl_promo_users u LEFT JOIN gl_promo_room_access a ON a.user_id=u.id GROUP BY u.id ORDER BY u.id DESC LIMIT 200");return {members:r.rows};}
 if(p==='/api/admin/promo-members'&&m==='POST')return transaction(async db=>{
  const user=id(b.id),rooms=[];if(typeof b.enabled!=='boolean')fail('회원 상태를 확인해 주세요.');
  // Same lock order as delivery: rooms first, then account. Revoke and delivery serialize.
  const owned=await db.query("SELECT room_id,data FROM hz_rooms WHERE data->'promo'->>'portalUserId'=$1 ORDER BY room_id FOR UPDATE",[user]);
  const r=await db.query('SELECT id FROM gl_promo_users WHERE id=$1 FOR UPDATE',[user]);if(!r.rowCount)fail('회원을 찾을 수 없습니다.',404);
  for(const row of owned.rows)if(!b.enabled||!rooms.includes(row.room_id)){row.data.promo.enabled=false;row.data.promo.nextRunAt=null;row.data.promo.stopReason='운영자가 홍보 권한을 해제';await db.query('UPDATE hz_rooms SET data=$2::jsonb,updated_at=NOW() WHERE room_id=$1',[row.room_id,JSON.stringify(row.data)]);}
  await db.query('UPDATE gl_promo_users SET enabled=$2 WHERE id=$1',[user,b.enabled]);await db.query('DELETE FROM gl_promo_room_access WHERE user_id=$1',[user]);for(const room of rooms)await db.query('INSERT INTO gl_promo_room_access(user_id,room_id) VALUES($1,$2)',[user,room]);if(!b.enabled){await db.query('DELETE FROM gl_promo_sessions WHERE user_id=$1',[user]);require('./kakao').service().stopUser(user);await db.query("UPDATE gl_promo_account_rooms SET promotion=jsonb_set(promotion,'{enabled}','false'::jsonb) WHERE user_id=$1",[user]);}await audit(db,s.user,'PROMO_MEMBER_UPDATE',null,user,{enabled:b.enabled,rooms});return {ok:true};
 });
 fail('요청한 API를 찾을 수 없습니다.',404);
}
module.exports={routes,admin,access,view};
