'use strict';
const crypto=require('node:crypto');
const {getPool}=require('../shared/db');
const attempts=new Map();
const digest=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){return salt+':'+crypto.scryptSync(password,salt,64).toString('hex');}
function equal(a,b){const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function config(){const secret=process.env.GL_SESSION_SECRET||'',hash=(process.env.GL_ADMIN_PASSWORD_HASH||'').trim();return {secret,hash,user:process.env.GL_ADMIN_USERNAME||'admin',ready:secret.length>=32&&/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash)};}
function limited(key){const now=Date.now(),old=attempts.get(key)||{count:0,until:now+15*60000};if(now>old.until){old.count=0;old.until=now+15*60000;}old.count++;attempts.set(key,old);if(attempts.size>5000)attempts.delete(attempts.keys().next().value);return old.count>5;}
function cookie(req){const found=String(req.headers.cookie||'').split(';').find(v=>v.trim().startsWith('gl_session='));return found?.trim().slice('gl_session='.length)||'';}
function sign(id){return crypto.createHmac('sha256',config().secret).update(id).digest('hex');}
async function session(req){
 if(!config().ready)return null;const [token,signature]=cookie(req).split('.');
 if(!/^[a-f0-9]{64}$/.test(token||'')||!equal(signature,sign(token)))return null;
 const r=await getPool().query('SELECT csrf FROM gl_web_sessions WHERE token_hash=$1 AND expires_at>NOW()',[digest(token)]);return r.rowCount?{token,csrf:r.rows[0].csrf,user:config().user}:null;
}
async function login(req,res,body){
 const cfg=config();if(!cfg.ready){const e=Error('관리자 인증 환경변수 설정이 필요합니다.');e.status=503;throw e;}
 if(limited('global')||limited(req.socket.remoteAddress||'unknown')){const e=Error('로그인 시도가 많습니다. 15분 후 다시 시도해 주세요.');e.status=429;throw e;}
 const [salt]=cfg.hash.split(':');const match=equal(hashPassword(String(body.password||'').slice(0,256),salt),cfg.hash);
 if(!match||!equal(body.username||'',cfg.user)){const e=Error('로그인 정보를 확인해 주세요.');e.status=401;throw e;}
 const token=crypto.randomBytes(32).toString('hex'),csrf=crypto.randomBytes(32).toString('hex');
 await getPool().query("INSERT INTO gl_web_sessions(token_hash,csrf,expires_at) VALUES($1,$2,NOW()+INTERVAL '8 hours')",[digest(token),csrf]);
 await getPool().query('DELETE FROM gl_web_sessions WHERE expires_at<NOW()');
 const secure=process.env.NODE_ENV==='production'||req.headers['x-forwarded-proto']==='https';
 res.setHeader('Set-Cookie',`gl_session=${token}.${sign(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure?'; Secure':''}`);
 return {authenticated:true,csrf,user:cfg.user};
}
async function logout(req,res,s){await getPool().query('DELETE FROM gl_web_sessions WHERE token_hash=$1',[digest(s.token)]);res.setHeader('Set-Cookie','gl_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return {ok:true};}
function csrf(req,s){const origin=req.headers.origin,proto=req.headers['x-forwarded-proto']==='https'?'https':'http';if(origin!==`${proto}://${req.headers.host}`||!equal(req.headers['x-csrf-token']||'',s.csrf)){const e=Error('요청 인증에 실패했습니다. 새로 로그인해 주세요.');e.status=403;throw e;}}
module.exports={config,hashPassword,session,login,logout,csrf,equal};
