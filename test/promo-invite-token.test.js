'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function harness({name='관리자가 정한 이름',expired=false,revoked=false}={}){
 const issuedToken='a'.repeat(64);
 let consumed=false;
 const inserts=[];
 const invite={id:12,label:name,room_ids:[]};
 const db={async query(sql,values=[]){
  if(sql.includes('FROM gl_promo_invites')){
   const found=values[0]===accounts.digest(issuedToken)&&!expired&&!revoked&&!consumed;
   return {rows:found?[invite]:[],rowCount:found?1:0};
  }
  if(sql.startsWith('INSERT INTO gl_promo_users')){
   inserts.push(values);return {rows:[{id:91,username:values[0],password_hash:values[1],display_name:values[2],enabled:true}],rowCount:1};
  }
  if(sql.startsWith('UPDATE gl_promo_invites')){consumed=true;return {rowCount:1};}
  if(sql.startsWith('INSERT INTO gl_promo_sessions')||sql.startsWith('DELETE FROM gl_promo_sessions'))return {rowCount:1};
  if(sql.startsWith('INSERT INTO gl_promo_room_access'))return {rowCount:1};
  throw Error('Unexpected SQL: '+sql.slice(0,100));
 }};
 const source=fs.readFileSync(path.join(__dirname,'../promotion/accounts.js'),'utf8');
 const mod={exports:{}};
 const safeRequire=id=>{
  if(id==='../shared/db')return {getPool:()=>db};
  if(id==='../shared/store')return {transaction:async fn=>fn(db),audit:async()=>{}};
  if(id==='../api/auth')return {equal:(x,y)=>x===y,csrf:()=>{}};
  return require(id);
 };
 const context={module:mod,require:safeRequire,process:{env:{GL_SESSION_SECRET:'test-secret-'.repeat(4),NODE_ENV:'production'}}};
 vm.runInNewContext(source,context,{filename:'accounts.js'});
 const accounts=mod.exports;
 const request={socket:{remoteAddress:'token-regression-'+Math.random()},headers:{'x-forwarded-proto':'https'}};
 const response={headers:{},setHeader(k,v){this.headers[k]=v;}};
 return {accounts,db,invite,issuedToken,inserts,request,response,get consumed(){return consumed;}};
}

test('register rejects a missing or malformed master token',async()=>{
 const h=harness();
 const base={username:'member_123',password:'LongPassWord123!'};
 await assert.rejects(h.accounts.register(h.request,h.response,base),/64자리/);
 await assert.rejects(h.accounts.register(h.request,h.response,{...base,token:'not-a-token'}),/64자리/);
 assert.equal(h.inserts.length,0);
});

test('valid one-use token registers with the master-assigned name only',async()=>{
 const h=harness();
 const result=await h.accounts.register(h.request,h.response,{
  token:h.issuedToken,username:'member_123',name:'사용자가 바꾼 이름',password:'LongPassWord123!'
 });
 assert.equal(result.authenticated,true);
 assert.equal(result.user.name,'관리자가 정한 이름');
 assert.equal(h.inserts[0][2],'관리자가 정한 이름');
 assert.equal(h.consumed,true);
 assert.match(h.response.headers['Set-Cookie'],/HttpOnly/);
 assert.doesNotMatch(h.response.headers['Set-Cookie'],new RegExp(h.issuedToken));
 await assert.rejects(h.accounts.register(h.request,h.response,{
  token:h.issuedToken,username:'second_account',password:'LongPassWord123!'
 }),/사용·만료·취소/);
 assert.equal(h.inserts.length,1);
});

test('revoked or expired token cannot create a member',async()=>{
 for(const mode of [{revoked:true},{expired:true}]){
  const h=harness(mode);
  await assert.rejects(h.accounts.register(h.request,h.response,{
   token:h.issuedToken,username:'member_123',password:'LongPassWord123!'
  }),/사용·만료·취소/);
  assert.equal(h.inserts.length,0);
 }
});
