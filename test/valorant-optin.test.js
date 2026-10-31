'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const optin=require('../shared/valorant-optin');

const env={
 RIOT_RSO_CLIENT_ID:'test-client',
 RIOT_RSO_CLIENT_SECRET:'test-secret',
 RIOT_RSO_REDIRECT_URI:'https://example.com/api/valorant/callback'
};
function dbMock(){
 const pending=new Map(),verified=new Map(),queries=[];
 return {
  pending,verified,queries,
  async query(sql,params=[]){
   queries.push({sql,params});
   if(/^CREATE /.test(sql))return {rowCount:0,rows:[]};
   if(sql.startsWith('DELETE FROM hz_valorant_pending WHERE expires_at'))return {rowCount:0,rows:[]};
   if(sql.startsWith('INSERT INTO hz_valorant_pending')){
    pending.set(params[0],params[1]);return {rowCount:1,rows:[]};
   }
   if(sql.startsWith('SELECT riot_id FROM hz_valorant_pending')){
    return {rowCount:pending.has(params[0])?1:0,rows:pending.has(params[0])?[{riot_id:pending.get(params[0])}]:[]};
   }
   if(sql.startsWith('DELETE FROM hz_valorant_pending WHERE state_hash')){
    const row=pending.get(params[0]);pending.delete(params[0]);
    return {rowCount:row?1:0,rows:row?[{riot_id:row}]:[]};
   }
   if(sql.startsWith('INSERT INTO hz_valorant_verified')){
    verified.set(params[0],params[1]);return {rowCount:1,rows:[]};
   }
   if(sql.startsWith('SELECT 1 FROM hz_valorant_verified')){
    return {rowCount:verified.has(params[0])?1:0,rows:verified.has(params[0])?[{'?column?':1}]:[]};
   }
   throw Error('Unexpected query: '+sql);
  }
 };
}
function response(){
 return {
  status:0,headers:{},body:'',
  writeHead(status,headers){this.status=status;this.headers=headers;},
  end(body=''){this.body=body;}
 };
}
test('RSO integration needs the approved client and a secured callback',()=>{
 assert.equal(optin.configured(env),true);
 assert.equal(optin.configured({...env,RIOT_RSO_REDIRECT_URI:'http://example.com/api/valorant/callback'}),false);
 assert.equal(optin.configured({...env,RIOT_RSO_CLIENT_SECRET:''}),false);
 assert.equal(optin.identity('Demo User','KR1'),'demo user#kr1');
});
test('Searching starts an opt-in request but does not automatically approve a third-party Riot ID',async()=>{
 const db=dbMock(),target={player:'demo user#kr1'};
 const created=await optin.requestLink(target,{db,env,userId:'101'});
 assert.match(created.url,/https:\/\/example\.com\/api\/valorant\/consent\?state=[a-f0-9]{64}$/);
 assert.equal(await optin.isVerified(target.player,db),false);
 const state=new URL(created.url).searchParams.get('state');
 const page=response();
 await optin.http({method:'GET'},page,new URL('https://example.com/api/valorant/consent?state='+state),{db,env});
 assert.equal(page.status,200);
 assert.match(page.body,/계정 소유자만/);
 const auth=response();
 await optin.http({method:'GET'},auth,new URL('https://example.com/api/valorant/authorize?state='+state),{db,env});
 assert.equal(auth.status,302);
 assert.match(auth.headers.Location,/auth\.riotgames\.com\/authorize/);
 assert.match(auth.headers.Location,/response_type=code/);
 assert.equal(await optin.isVerified(target.player,db),false);
 // OAuth code is exchanged with Riot and the account identity must match.
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url)=>({
  ok:true,status:200,json:async()=>url.includes('/token')
   ?{access_token:'test-only-token'}
   :{puuid:'verified-puuid',gameName:'Demo User',tagLine:'KR1'}
 });
 try{
  const done=response();
  await optin.http({method:'GET'},done,new URL('https://example.com/api/valorant/callback?state='+state+'&code=one-use-code'),{db,env});
  assert.equal(done.status,200);
  assert.equal(await optin.isVerified(target.player,db),true);
  assert.equal(db.verified.get('demo user#kr1'),'verified-puuid');
  const replay=response();
  await optin.http({method:'GET'},replay,new URL('https://example.com/api/valorant/callback?state='+state+'&code=one-use-code'),{db,env});
  assert.equal(replay.status,400,'Callback state cannot be replayed');
 }finally{globalThis.fetch=originalFetch;}
});
test('A requester cannot approve a different Riot account',async()=>{
 const db=dbMock(),target={player:'different#kr1'};
 const request=await optin.requestLink(target,{db,env,userId:'102'});
 const state=new URL(request.url).searchParams.get('state');
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async url=>({
  ok:true,status:200,json:async()=>url.includes('/token')
   ?{access_token:'test-only-token'}:{puuid:'puuid',gameName:'Other',tagLine:'KR1'}
 });
 try{
  const done=response();
  await optin.http({method:'GET'},done,new URL('https://example.com/api/valorant/callback?state='+state+'&code=one-use-code'),{db,env});
  assert.equal(done.status,400);
  assert.match(done.body,/일치하지 않습니다/);
  assert.equal(db.verified.size,0);
 }finally{globalThis.fetch=originalFetch;}
});
test('Unconfigured RSO does not create pending consent or mark accounts approved',async()=>{
 const db=dbMock();
 const result=await optin.requestLink({player:'someone#ap'},{db,env:{},userId:'103'});
 assert.equal(result,null);
 assert.equal(db.pending.size,0);
 assert.equal(db.verified.size,0);
});
