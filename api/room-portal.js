'use strict';
const crypto=require('node:crypto');
const {getPool}=require('../shared/db');
const {id}=require('../shared/store');
const {session:masterSession,csrf:masterCsrf}=require('./auth');
const {status}=require('./routes');
const bad=(message,status=400)=>{const e=Error(message);e.status=status;throw e;};
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const passwordHash=(s,salt=crypto.randomBytes(16).toString('hex'))=>salt+':'+crypto.scryptSync(s,salt,64).toString('hex');
const same=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const PERMISSIONS=['manage','mention','profile','deleted','spam','templates','warnings','roles','prefixes','chatStats'];
const attempts=new Map();
async function init(){
 const db=getPool();
 await db.query(`CREATE TABLE IF NOT EXISTS gl_room_portals (
  id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL UNIQUE,room_name TEXT NOT NULL,
  label TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,username TEXT NOT NULL,
  password_hash TEXT NOT NULL,permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ DEFAULT NOW()
 )`);
 await db.query(`CREATE TABLE IF NOT EXISTS gl_room_portal_sessions (
  token_hash TEXT PRIMARY KEY,portal_id BIGINT NOT NULL REFERENCES gl_room_portals(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL
 )`);
}
function parsePermissions(x){
 if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!PERMISSIONS.includes(k)||typeof x[k]!=='boolean'))bad('허용 기능 설정이 올바르지 않습니다.');
 return Object.fromEntries(PERMISSIONS.map(k=>[k,x[k]===true]));
}
function cookie(req,name){return String(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';}
function cookieValue(req){return cookie(req,'nexi_room_session');}
function secure(req){return process.env.NODE_ENV==='production'||req.headers['x-forwarded-proto']==='https';}
function setCookie(res,token,req,maxAge=28800){res.setHeader('Set-Cookie','nexi_room_session='+token+'; HttpOnly; SameSite=Strict; Path=/; Max-Age='+maxAge+(secure(req)?'; Secure':''));}
async function roomSession(req){
 const token=cookieValue(req);
 if(!/^[0-9a-f]{64}$/.test(token))return null;
 const q=await getPool().query(`SELECT p.*,s.csrf FROM gl_room_portal_sessions s JOIN gl_room_portals p ON p.id=s.portal_id WHERE s.token_hash=$1 AND s.expires_at>NOW() AND p.enabled`,[hash(token)]);
 return q.rows[0]||null;
}
function verifyCsrf(req,s){const proto=req.headers['x-forwarded-proto']==='https'?'https':'http';if(req.headers.origin!==proto+'://'+req.headers.host||!same(req.headers['x-csrf-token']||'',s.csrf))bad('인증이 만료되었거나 요청 출처가 올바르지 않습니다.',403);}
function allowed(s,permission){if(!s.permissions?.[permission])bad('이 기능에 접근할 권한이 없습니다.',403);}
async function joinedRooms(){
 if(!status.connected||typeof status.client?.getKnownChatRooms!=='function')bad('봇 연결 상태를 확인할 수 없습니다.',503);
 await require('../promotion/rooms').refresh(status.client,{force:true});
 return status.client.getKnownChatRooms().map(r=>({id:String(r.id),name:String(r.name||r.id)})).filter(r=>/^\d{1,24}$/.test(r.id));
}
async function master(req,url,body){
 await init();
 const s=await masterSession(req);if(!s)bad('총관리자 로그인이 필요합니다.',401);
 if(req.method!=='GET')masterCsrf(req,s);
 if(req.method==='GET'){
  const q=await getPool().query('SELECT id,room_id,room_name,label,slug,username,permissions,enabled FROM gl_room_portals ORDER BY id DESC');
  return {portals:q.rows,permissions:PERMISSIONS};
 }
 if(req.method!=='POST')bad('지원되지 않는 요청입니다.',405);
 const rooms=await joinedRooms(),room=id(body.roomId);
 const active=rooms.find(r=>r.id===room);if(!active)bad('봇이 현재 참여 중인 방만 선택할 수 있습니다.');
 const label=String(body.label||'').trim().slice(0,60);
 const username=String(body.username||'').trim();
 if(!label||!/^[a-zA-Z0-9_.-]{4,40}$/.test(username))bad('웹사이트 이름 및 아이디(영문·숫자 4~40자)를 확인해 주세요.');
 const perms=parsePermissions(body.permissions);
 const password=String(body.password||'');
 const exists=await getPool().query('SELECT id FROM gl_room_portals WHERE room_id=$1',[room]);
 if(!exists.rowCount&&password.length<10)bad('새 웹사이트 비밀번호는 10자 이상이어야 합니다.');
 if(password&&password.length<10)bad('비밀번호는 10자 이상이어야 합니다.');
 const portalEnabled=body.enabled!==false;
 const slug=crypto.randomBytes(12).toString('hex');
 const pw=password?passwordHash(password):null;
 const db=getPool();
 const q=await db.query(`INSERT INTO gl_room_portals(room_id,room_name,label,slug,username,password_hash,permissions,enabled)
 VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
 ON CONFLICT(room_id) DO UPDATE SET room_name=$2,label=$3,username=$5,
 password_hash=COALESCE($9,gl_room_portals.password_hash),permissions=$7::jsonb,enabled=$8
 RETURNING id,room_id,room_name,label,slug,username,permissions,enabled`,
 [room,active.name,label,slug,username,pw||passwordHash(crypto.randomBytes(32).toString('hex')),JSON.stringify(perms),portalEnabled,pw]);
 if(exists.rowCount&&(password||!portalEnabled||body.revokeSessions===true))await db.query('DELETE FROM gl_room_portal_sessions WHERE portal_id=$1',[q.rows[0].id]);
 return {ok:true,portal:q.rows[0],url:'/room-panel?site='+q.rows[0].slug};
}
async function login(req,res,body){
 await init();
 const slug=String(body.site||''),username=String(body.username||''),password=String(body.password||'');
 const ip=String(req.socket.remoteAddress||'unknown'),now=Date.now(),k=ip+':'+slug,entry=attempts.get(k)||{n:0,at:now};
 if(now-entry.at>900000){entry.n=0;entry.at=now;}entry.n++;attempts.set(k,entry);if(attempts.size>5000)attempts.clear();
 if(entry.n>8)bad('로그인 시도가 많습니다. 15분 후 다시 시도해 주세요.',429);
 const q=await getPool().query('SELECT * FROM gl_room_portals WHERE slug=$1 AND enabled',[slug]);
 const p=q.rows[0],stored=p?.password_hash||passwordHash('invalid-password');
 const match=same(passwordHash(password.slice(0,256),stored.split(':')[0]),stored)&&p&&same(username,p.username);
 if(!match)bad('아이디 또는 비밀번호가 일치하지 않습니다.',401);
 attempts.delete(k);
 const token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(32).toString('hex');
 await getPool().query("INSERT INTO gl_room_portal_sessions(token_hash,portal_id,csrf,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '8 hours')",[hash(token),p.id,csrf]);
 setCookie(res,token,req);
 return {ok:true,csrf,site:p.slug,label:p.label};
}
async function settings(s){
 const room=s.room_id,db=getPool();
 const [r,mention,profile]=await Promise.all([
 db.query("SELECT m.enabled,m.deleted_enabled,m.spam_enabled,h.data->>'joinTemplate' AS join_template,h.data->>'leaveTemplate' AS leave_template FROM gl_manage_rooms m FULL JOIN hz_rooms h ON h.room_id=m.room_id WHERE COALESCE(m.room_id,h.room_id)=$1",[room]),
 db.query("SELECT enabled FROM hz_mention_settings WHERE room_id=$1",[room]),
 db.query("SELECT data->'profileAlerts' AS enabled FROM hz_rooms WHERE room_id=$1",[room])]);
 const v=r.rows[0]||{};
 return {label:s.label,username:s.username,roomName:s.room_name,permissions:s.permissions,prefixes:await require('../shared/command-prefixes').get(room),flags:{manage:v.enabled===true,deleted:v.deleted_enabled===true,spam:v.spam_enabled===true,mention:mention.rows[0]?.enabled!==false,profile:profile.rows[0]?.enabled!==false},joinTemplate:v.join_template||'',leaveTemplate:v.leave_template||''};
}
async function warnings(room){
 const r=await getPool().query(`SELECT user_id,max(user_name) AS user_name,count(*)::int AS count,
 json_agg(json_build_object('id',id,'reason',reason,'created_at',created_at) ORDER BY id DESC) AS details
 FROM gl_manage_warnings WHERE room_id=$1 AND NOT removed GROUP BY user_id ORDER BY count(*) DESC,user_name LIMIT 300`,[room]);
 return {warnings:r.rows};
}
async function routes(req,res,url,body){
 const p=url.pathname,method=req.method;
 if(p==='/api/admin/room-portals')return master(req,url,body);
 if(p==='/api/room-portal/login'&&method==='POST')return login(req,res,body);
 await init();
 // A session cookie can be shared by different customer portal URLs on this host.
 // Never authorize a portal without checking that the requested site matches its session.
 const requestedSite=String(url.searchParams.get('site')||'');
 if(!/^[a-f0-9]{24}$/.test(requestedSite))bad('고객 웹사이트 주소가 올바르지 않습니다.',400);
 const sessionCandidate=await roomSession(req);
 const s=sessionCandidate?.slug===requestedSite?sessionCandidate:null;
 if(p==='/api/room-portal/session'&&method==='GET')return s?{authenticated:true,csrf:s.csrf,label:s.label,roomName:s.room_name,permissions:s.permissions}:{authenticated:false};
 if(sessionCandidate&&!s)bad('다른 고객 웹사이트에 로그인되어 있습니다. 이 사이트의 계정으로 로그인해 주세요.',401);
 if(!s)bad('고객 웹사이트 로그인이 필요합니다.',401);
 if(method!=='GET')verifyCsrf(req,s);
 if(p==='/api/room-portal/logout'&&method==='POST'){
  await getPool().query('DELETE FROM gl_room_portal_sessions WHERE token_hash=$1',[hash(cookieValue(req))]);setCookie(res,'',req,0);return {ok:true};
 }
 if(p==='/api/room-portal/account'&&method==='POST'){
  const current=String(body.currentPassword||''),username=String(body.username||'').trim();
  const password=String(body.newPassword||'');
  if(!/^[a-zA-Z0-9_.-]{4,40}$/.test(username))bad('아이디는 영문·숫자 4~40자로 입력하세요.');
  if(password&&password.length<10)bad('새 비밀번호는 10자 이상이어야 합니다.');
  if(!password&&username===s.username)bad('변경할 정보를 입력하세요.');
  const stored=s.password_hash;
  if(!same(passwordHash(current.slice(0,256),stored.split(':')[0]),stored))bad('현재 비밀번호가 일치하지 않습니다.',403);
  const db=getPool(),c=await db.connect();
  try{
   await c.query('BEGIN');
   await c.query('UPDATE gl_room_portals SET username=$2,password_hash=COALESCE($3,password_hash) WHERE id=$1',[s.id,username,password?passwordHash(password):null]);
   await c.query('DELETE FROM gl_room_portal_sessions WHERE portal_id=$1',[s.id]);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  setCookie(res,'',req,0);
  return {ok:true,logout:true};
 }
 if(p==='/api/room-portal/prefixes'&&method==='POST'){
  allowed(s,'prefixes');
  const prefixes=await require('../shared/command-prefixes').set(s.room_id,body.prefixes);
  return {ok:true,prefixes};
 }
 if(p==='/api/room-portal/chat-stats'&&method==='GET'){
  allowed(s,'chatStats');
  const rows=await getPool().query("SELECT user_id,user_name,count::text AS count FROM gl_manage_chat_counts WHERE room_id=$1 ORDER BY count DESC,user_id ASC",[s.room_id]);
  return {roomId:s.room_id,total:rows.rows.length,rankings:rows.rows.map((r,i)=>({rank:i+1,...r}))};
 }
 if(p==='/api/room-portal/chat-stats'&&method==='DELETE'){
  allowed(s,'chatStats');
  const action=String(body.action||'');
  if(action!=='user'&&action!=='all')bad('삭제 범위가 올바르지 않습니다.');
  const user=id(body.userId);
  if(action==='user'&&!/^[1-9]\\d{3,24}$/.test(user))bad('올바른 사용자 ID가 필요합니다.');
  if(body.confirmation!=='DELETE_CONFIRMED_TWICE')bad('2단계 삭제 확인이 필요합니다.',400);
  const db=getPool();
  const result=action==='all'
   ?await db.query('DELETE FROM gl_manage_chat_counts WHERE room_id=$1',[s.room_id])
   :await db.query('DELETE FROM gl_manage_chat_counts WHERE room_id=$1 AND user_id=$2',[s.room_id,user]);
  await db.query('INSERT INTO gl_manage_actions(room_id,actor_id,target_id,action,detail) VALUES($1,$2,$3,$4,$5)',[s.room_id,'portal:'+s.id,action==='all'?'ALL':user,'CHAT_RANK_RESET',action]);
  return {ok:true,deleted:result.rowCount};
 }
 if(p==='/api/room-portal/members'&&method==='GET'){
  const client=status.client;
  if(!client?.connected)bad('카카오톡 연결 상태를 확인할 수 없습니다.',503);
  const roster=await require('../shared/live-roster').refresh(client,s.room_id);
  const db=getPool();
  const [admins,superAdmins]=await Promise.all([
   db.query('SELECT user_id FROM gl_manage_admins WHERE room_id=$1',[s.room_id]),
   require('../shared/super-admin').list(s.room_id,db)
  ]);
  const adminIds=new Set(admins.rows.map(r=>r.user_id)),superIds=new Set(superAdmins.map(r=>r.user_id));
  return {count:roster.members.length,checkedAt:new Date(roster.at).toISOString(),
   canEditRoles:!!s.permissions?.roles,
   members:roster.members.map(m=>({
    id:m.id,name:m.name,imageUrl:m.imageUrl,
    roomRole:m.type===1?'방장':m.type===4?'부방장':'',
    admin:adminIds.has(m.id),superAdmin:superIds.has(m.id)
   }))};
 }
 if(p==='/api/room-portal/member-role'&&method==='POST'){
  allowed(s,'roles');
  const user=id(body.userId),role=String(body.role||''),on=body.enabled;
  if(!['admin','superAdmin'].includes(role)||typeof on!=='boolean')bad('관리자 권한 설정이 올바르지 않습니다.');
  const roster=await require('../shared/live-roster').refresh(status.client,s.room_id,{force:true});
  const member=roster.members.find(m=>m.id===user);
  if(!member)bad('현재 해당 방에 있는 사용자만 선택할 수 있습니다.',404);
  if(user===String(status.client?.userId)||[1,4].includes(member.type))bad('봇·방장·부방장 권한은 변경할 수 없습니다.',403);
  const db=getPool();
  if(role==='admin'){
   if(on)await db.query('INSERT INTO gl_manage_admins(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[s.room_id,user]);
   else await db.query('DELETE FROM gl_manage_admins WHERE room_id=$1 AND user_id=$2',[s.room_id,user]);
  }else{
   await require('../shared/super-admin').update(s.room_id,user,'customer-portal:'+s.id,on?'add':'remove',db);
  }
  await db.query('INSERT INTO gl_manage_actions(room_id,actor_id,target_id,action,detail) VALUES($1,$2,$3,$4,$5)',[s.room_id,'portal:'+s.id,user,on?'WEB_ROLE_ADD':'WEB_ROLE_REMOVE',role]);
  return {ok:true};
 }
 if(p==='/api/room-portal/settings'&&method==='GET')return settings(s);
 if(p==='/api/room-portal/warnings'&&method==='GET'){allowed(s,'warnings');return warnings(s.room_id);}
 if(p==='/api/room-portal/feature'&&method==='POST'){
  const key=String(body.feature||'');if(!['manage','mention','profile','deleted','spam'].includes(key)||typeof body.enabled!=='boolean')bad('잘못된 기능 설정입니다.');
  allowed(s,key);const db=getPool(),room=s.room_id,on=body.enabled;
  if(key==='mention')await require('../manage/mention-notify').setEnabled(db,room,on);
  else if(key==='profile')await require('../manage/profile-alerts').setEnabled(db,room,on);
  else if(key==='manage'){
   const c=await db.connect();try{await c.query('BEGIN');await c.query('INSERT INTO gl_manage_rooms(room_id,enabled) VALUES($1,$2) ON CONFLICT(room_id) DO UPDATE SET enabled=$2',[room,on]);await c.query("INSERT INTO hz_rooms(room_id,data) VALUES($1,jsonb_build_object('manage',$2::boolean)) ON CONFLICT(room_id) DO UPDATE SET data=jsonb_set(hz_rooms.data,'{manage}',to_jsonb($2::boolean),true)",[room,on]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }else{
   const field=key==='deleted'?'deleted_enabled':'spam_enabled';
   await db.query('INSERT INTO gl_manage_rooms(room_id,enabled,'+field+') VALUES($1,TRUE,$2) ON CONFLICT(room_id) DO UPDATE SET '+field+'=$2',[room,on]);
  }
  return {ok:true};
 }
 if(p==='/api/room-portal/template'&&method==='POST'){
  allowed(s,'templates');const key=String(body.kind||'');if(!['join','leave'].includes(key))bad('입장 또는 퇴장을 선택해 주세요.');
  const value=String(body.value||'');if(value.length>2000)bad('문구는 최대 2,000자입니다.');
  const field=key==='join'?'joinTemplate':'leaveTemplate';
  await getPool().query("INSERT INTO hz_rooms(room_id,data) VALUES($1,jsonb_build_object($2::text,$3::text)) ON CONFLICT(room_id) DO UPDATE SET data=jsonb_set(hz_rooms.data,ARRAY[$2::text],to_jsonb($3::text),true),updated_at=NOW()",[s.room_id,field,value]);
  return {ok:true};
 }
 if(p==='/api/room-portal/warnings'&&method==='POST'){
  allowed(s,'warnings');const user=id(body.userId),reason=String(body.reason||'').trim().slice(0,300);
  const count=body.count==null?1:Number(body.count);
  if(!/^[1-9]\\d{3,24}$/.test(user))bad('카카오 사용자 ID가 올바르지 않습니다.');
  if(!Number.isInteger(count)||count<1||count>10)bad('경고 개수는 1~10개로 지정해 주세요.');
  if(!reason)bad('경고 사유를 입력하세요.');
  const name=String(body.userName||user).trim().slice(0,80)||user;
  const c=await getPool().connect();try{
   await c.query('BEGIN');
   await c.query('INSERT INTO gl_manage_warnings(room_id,user_id,user_name,reason,issuer_id) SELECT $1,$2,$3,$4,$5 FROM generate_series(1,$6::int)',[s.room_id,user,name,reason,'web:'+s.username,count]);
   await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  return warnings(s.room_id);
 }
 if(p==='/api/room-portal/warnings'&&method==='DELETE'){
  allowed(s,'warnings');if(!/^\d+$/.test(String(body.warningId||'')))bad('경고 번호를 확인해 주세요.');
  const r=await getPool().query('UPDATE gl_manage_warnings SET removed=TRUE WHERE room_id=$1 AND id=$2 AND NOT removed',[s.room_id,body.warningId]);
  if(!r.rowCount)bad('삭제할 경고가 없습니다.',404);
  return warnings(s.room_id);
 }
 bad('존재하지 않는 기능입니다.',404);
}
module.exports={routes,init,PERMISSIONS};
