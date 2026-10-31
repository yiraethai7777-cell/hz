'use strict';
// Riot account linking. Searches can request linking automatically; only
// the owner who authenticates through Riot RSO can approve public statistics.
const crypto=require('node:crypto');
const {getPool}=require('./db');
const RATE_MS=30000;
const recent=new Map();
const initialized=new WeakMap();
function identity(name,tag){
 return (String(name).trim()+'#'+String(tag).trim()).normalize('NFC').toLocaleLowerCase('en-US');
}
function configured(env=process.env){
 try{
  const url=new URL(String(env.RIOT_RSO_REDIRECT_URI||''));
  return Boolean(env.RIOT_RSO_CLIENT_ID&&env.RIOT_RSO_CLIENT_SECRET&&
   url.protocol==='https:'&&url.pathname==='/api/valorant/callback'&&
   !url.username&&!url.password&&!url.search&&!url.hash);
 }catch{return false;}
}
async function init(db=getPool()){
 let job=initialized.get(db);
 if(!job){
  job=db.query(
   "CREATE TABLE IF NOT EXISTS hz_valorant_verified ("+
   "riot_id TEXT PRIMARY KEY, puuid TEXT NOT NULL, verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"
  ).then(()=>db.query(
   "CREATE TABLE IF NOT EXISTS hz_valorant_pending ("+
   "state_hash TEXT PRIMARY KEY, riot_id TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL)"+
   "; CREATE INDEX IF NOT EXISTS hz_valorant_pending_expiry ON hz_valorant_pending(expires_at)"
  )).catch(error=>{initialized.delete(db);throw error;});
  initialized.set(db,job);
 }
 return job;
}
async function isVerified(riotId,db=getPool()){
 await init(db);
 const q=await db.query("SELECT 1 FROM hz_valorant_verified WHERE riot_id=$1",[riotId]);
 return q.rowCount>0;
}
function consentUrl(env,state){
 const callback=new URL(env.RIOT_RSO_REDIRECT_URI);
 return callback.origin+'/api/valorant/consent?state='+encodeURIComponent(state);
}
async function requestLink(target,options={}){
 const env=options.env||process.env;
 if(!configured(env))return null;
 const db=options.db||getPool(),userId=String(options.userId||'');
 const now=Date.now();
 if(userId&&now-(recent.get(userId)||0)<RATE_MS)return {rateLimited:true};
 if(userId){recent.set(userId,now);if(recent.size>1000)recent.delete(recent.keys().next().value);}
 await init(db);
 const state=crypto.randomBytes(32).toString('hex');
 const hash=crypto.createHash('sha256').update(state).digest('hex');
 await db.query("DELETE FROM hz_valorant_pending WHERE expires_at < NOW()");
 await db.query(
  "INSERT INTO hz_valorant_pending(state_hash,riot_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '10 minutes')",
  [hash,target.player]
 );
 return {url:consentUrl(env,state)};
}
function html(res,status,body){
 res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
 res.end('<!doctype html><html lang="ko"><head><meta charset="UTF-8">'+
  '<meta name="viewport" content="width=device-width,initial-scale=1">'+
  '<title>발로란트 계정 연결</title></head><body style="font:16px system-ui,sans-serif;max-width:600px;margin:4rem auto;padding:1rem;line-height:1.7">'+
  body+'</body></html>');
}
function sha(state){return crypto.createHash('sha256').update(state).digest('hex');}
async function pendingFor(state,db){
 if(!/^[a-f0-9]{64}$/.test(state))return null;
 const row=await db.query(
  "SELECT riot_id FROM hz_valorant_pending WHERE state_hash=$1 AND expires_at>NOW()",
  [sha(state)]
 );
 return row.rows[0]||null;
}
async function externalJson(url,options){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),10000);
 if(timer.unref)timer.unref();
 try{
  const response=await fetch(url,{...options,signal:controller.signal});
  if(!response.ok)throw Error('Riot 인증 API 응답 오류 ('+response.status+')');
  return response.json();
 }finally{clearTimeout(timer);}
}
async function callback(state,code,env,db){
 // Consume state first so a callback cannot register multiple accounts.
 const taken=await db.query(
  "DELETE FROM hz_valorant_pending WHERE state_hash=$1 AND expires_at>NOW() RETURNING riot_id",
  [sha(state)]
 );
 const requested=taken.rows[0]?.riot_id;
 if(!requested)throw Error('연결 요청이 만료되었거나 이미 사용됐습니다.');
 if(!code||code.length>2048)throw Error('Riot 인증 코드가 올바르지 않습니다.');
 const auth='Basic '+Buffer.from(env.RIOT_RSO_CLIENT_ID+':'+env.RIOT_RSO_CLIENT_SECRET).toString('base64');
 const tokens=await externalJson('https://auth.riotgames.com/token',{
  method:'POST',headers:{Authorization:auth,'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:env.RIOT_RSO_REDIRECT_URI})
 });
 if(!tokens.access_token)throw Error('Riot 인증에 실패했습니다.');
 const account=await externalJson('https://asia.api.riotgames.com/riot/account/v1/accounts/me',{
  headers:{Authorization:'Bearer '+tokens.access_token,Accept:'application/json'}
 });
 if(!account?.puuid||!account?.gameName||!account?.tagLine)
  throw Error('인증된 Riot 계정 정보를 확인하지 못했습니다.');
 if(identity(account.gameName,account.tagLine)!==requested)
  throw Error('로그인한 Riot 계정과 요청한 닉네임#태그가 일치하지 않습니다.');
 await db.query(
  "INSERT INTO hz_valorant_verified(riot_id,puuid,verified_at) VALUES($1,$2,NOW()) "+
  "ON CONFLICT(riot_id) DO UPDATE SET puuid=EXCLUDED.puuid,verified_at=NOW()",
  [requested,account.puuid]
 );
 return requested;
}
async function http(req,res,url,options={}){
 const env=options.env||process.env;
 if(req.method!=='GET'){html(res,405,'요청 방식이 올바르지 않습니다.');return;}
 if(!configured(env)){html(res,503,'Riot 계정 연결이 아직 설정되지 않았습니다.');return;}
 const db=options.db||getPool();
 const state=url.searchParams.get('state')||'';
 if(!/^[a-f0-9]{64}$/.test(state)){html(res,400,'잘못된 연결 요청입니다.');return;}
 try{
  await init(db);
  if(url.pathname==='/api/valorant/consent'){
   const pending=await pendingFor(state,db);
   if(!pending){html(res,410,'연결 요청이 만료되었습니다. 카카오톡에서 다시 검색해 주세요.');return;}
   const next='/api/valorant/authorize?state='+encodeURIComponent(state);
   html(res,200,'<h1>발로란트 전적 공개 동의</h1>'+
    '<p>계정을 연결하면 본인의 Riot ID, 티어 및 경기 전적이 이 카카오톡 봇 이용자에게 표시될 수 있습니다.</p>'+
    '<p>계정 소유자만 연결을 진행해 주세요. 본인 계정이 아니라면 이 페이지를 닫으세요.</p>'+
    '<p><a href="'+next+'">동의하고 Riot 계정으로 로그인하기</a></p>');
   return;
  }
  if(url.pathname==='/api/valorant/authorize'){
   if(!await pendingFor(state,db)){html(res,410,'연결 요청이 만료되었습니다.');return;}
   const authorize=new URL('https://auth.riotgames.com/authorize');
   authorize.search=new URLSearchParams({
    client_id:env.RIOT_RSO_CLIENT_ID,redirect_uri:env.RIOT_RSO_REDIRECT_URI,
    response_type:'code',scope:'openid offline_access',state
   }).toString();
   res.writeHead(302,{Location:authorize.href,'Cache-Control':'no-store'});res.end();return;
  }
  if(url.pathname==='/api/valorant/callback'){
   if(url.searchParams.get('error')){html(res,400,'Riot 로그인 또는 동의가 취소되었습니다.');return;}
   const approved=await callback(state,url.searchParams.get('code')||'',env,db);
   html(res,200,'<h1>계정 연결 완료</h1><p>Riot 계정 인증 및 전적 공개 등록이 완료되었습니다.</p>'+
    '<p>이제 카카오톡에서 <strong>!발로전적 닉네임#태그</strong>를 입력해 주세요.</p>');
   console.info('[VALORANT RSO] Account verified:',approved.slice(0,2)+'***');
   return;
  }
  html(res,404,'요청한 페이지를 찾을 수 없습니다.');
 }catch(error){
  console.warn('[VALORANT RSO]',String(error?.message||error).slice(0,150));
  html(res,400,'계정 연결 실패: '+(String(error?.message||'인증 오류').replace(/[<>&"']/g,'')));
 }
}
module.exports={configured,identity,init,isVerified,requestLink,http,callback};
