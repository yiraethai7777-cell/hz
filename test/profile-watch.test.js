'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{EventEmitter}=require('node:events');
const {createWatcher}=require('../manage/profile-watch');

test('startup calls watcher only after game and management initialize; failure is visible',async()=>{
 async function run(fail=false){
  const calls=[],logs=[],client=new EventEmitter();client.onMessage=()=>{};client.onReady=fn=>{client.ready=fn;};
  client.refreshMemberProfiles=async()=>[];
  const context={module:{exports:{}},console:{log:(...a)=>logs.push(a.join(' ')),error:(...a)=>logs.push(a.join(' '))},process:{env:{GL_WEB_ENABLED:'0'}},setInterval:()=>({unref(){}}),require:name=>{
   if(name==='./dist')return {createClient:()=>client};
   if(name==='./shared/router')return {attachRouter:()=>{}};
   if(name==='./game')return {createGame:()=>({init:async()=>{calls.push('game');if(fail)throw Error('DB unavailable');}})};
   if(name==='./manage')return {init:async()=>calls.push('manage')};
   if(name==='./shared/runtime')return {startProfileWatch:c=>{assert.equal(c,client);calls.push('watch');}};
   throw Error(name);
  }};
  vm.runInNewContext(fs.readFileSync(require.resolve('../hz-new'),'utf8'),context);
  context.module.exports.start();await client.ready();await Promise.resolve();
  return {calls,logs};
 }
 assert.deepEqual((await run()).calls,['game','manage','watch']);
 const failure=await run(true);assert.deepEqual(failure.calls,['game']);assert.match(failure.logs.join('\n'),/initialization failed.*DB unavailable/);
});

test('unsupported API, empty rooms and member failures have distinct diagnostics; start is idempotent',async()=>{
 const logs=[],original={log:console.log,error:console.error};
 console.log=(...a)=>logs.push(a.join(' '));console.error=console.log;
 let watcher;
 try{
  await createWatcher({},{}).tick();assert.match(logs.join('\n'),/refreshMemberProfiles unsupported/);
  const client={connected:true,getKnownChatRooms:()=>[{id:'100'}],refreshMemberProfiles:async()=>{throw Error('MEMLIST refused');}};
  let rows=[];const ctx={pool:{query:async()=>({rows})}};
  watcher=createWatcher(ctx,client);await watcher.tick();assert.match(logs.join('\n'),/room list succeeded.*"eligible":0/);
  rows=[{room_id:'100'}];await watcher.tick();assert.match(logs.join('\n'),/member refresh failed.*MEMLIST refused/);
  watcher.start();watcher.start();assert.equal(logs.filter(x=>x.includes('] started ')).length,1);
 }finally{watcher?.stop();Object.assign(console,original);}
});

test('observations retain old names, distinguish unknown from removed links, isolate rooms and deduplicate',async()=>{
 const {PGlite}=require('@electric-sql/pglite'),db=new PGlite();
 const query=async(sql,p)=>p?.length?db.query(sql,p):(await db.exec(sql)).at(-1);
 const pool={query,connect:async()=>({query,release(){}})};
 const ctx=require('../shared/runtime').createRuntime({pool,economyEnabled:false});
 try{
  await ctx.initDb();
  const uid='9007199254740993123',oldLink='https://open.kakao.com/o/old';
  for(const room of ['100','200']){
   await query('INSERT INTO hz_rooms(room_id,data) VALUES($1,$2::jsonb)',[room,JSON.stringify({manage:true,players:{preserved:{points:123}}})]);
   await ctx.withRoom(room,'',(_,c)=>ctx.profileObserve(c,room,uid,'old','photo',oldLink));
  }
  await query('UPDATE hz_members SET name=$3 WHERE room_id=$1 AND user_id=$2',['100',uid,'new']);
  const observe=(name,link)=>ctx.withRoom('100','',(_,c)=>ctx.profileObserve(c,'100',uid,name,'photo',link));
  const changed=await observe('new',undefined);assert.equal(changed.oldName,'old');assert.equal(changed.oldOpenLink,oldLink);
  assert.equal(await observe('new','invalid'),null);
  const removal=await observe('new','');assert.equal(removal.newOpenLink,'');
  assert.equal(await observe('new',''),null);
  const other=(await query('SELECT * FROM hz_members WHERE room_id=$1',['200'])).rows[0];assert.equal(other.name,'old');assert.equal(other.observed_open_profile_link,oldLink);
  assert.equal((await query('SELECT * FROM hz_profiles')).rows.length,2);
  assert.equal((await query('SELECT data FROM hz_rooms WHERE room_id=$1',['100'])).rows[0].data.players.preserved.points,123);
 }finally{await db.close();}
});

test('malformed and incomplete server pages are rejected before observation',async()=>{
 require('ts-node/register/transpile-only');
 const {KakaoForgeClient}=require('../src/client/client');
 const client=Object.create(KakaoForgeClient.prototype);client._resolveChatId=x=>x;client._cacheMembers=()=>{};
 client._carriage={memList:async()=>({status:0,body:{}})};
 await assert.rejects(client.refreshMemberProfiles('100'),/Invalid profile member list/);
 let page=0;client._carriage.memList=async()=>({status:0,body:{members:[],token:[1,2,1][page++]}});
 await assert.rejects(client.refreshMemberProfiles('100'),/repeated token/);
});

test('stop cancels an in-flight refresh before any DB observation or notification',async()=>{
 const client=new EventEmitter();client.connected=true;client.getKnownChatRooms=()=>[{id:'100'}];
 let started,release,observations=0,sends=0;
 const began=new Promise(r=>{started=r;}),waiting=new Promise(r=>{release=r;});
 client.refreshMemberProfiles=async()=>{started();await waiting;return [{id:'10001',name:'new'}];};
 const ctx={pool:{query:async sql=>({rows:sql.includes('SELECT room_id')?[{room_id:'100'}]:[]})},withRoom:async()=>{observations++;},globalChat:{sendText:async()=>{sends++;}}};
 const watcher=createWatcher(ctx,client),tick=watcher.tick();await began;watcher.stop();release();await tick;
 assert.equal(observations,0);assert.equal(sends,0);assert.equal(client.listenerCount('disconnected'),0);
 client.getKnownChatRooms=()=>[];watcher.start();assert.equal(client.listenerCount('disconnected'),1);watcher.stop();
});

test('watcher rotates rooms, refreshes unchanged link IDs and cannot overwrite concurrent chat observations',async()=>{
 const {PGlite}=require('@electric-sql/pglite'),db=new PGlite();
 const query=async(sql,p)=>p?.length?db.query(sql,p):(await db.exec(sql)).at(-1);
 const pool={query,connect:async()=>({query,release(){}})};
 const ctx=require('../shared/runtime').createRuntime({pool,economyEnabled:false});
 let clock=1000,link='https://open.kakao.com/o/old',race=false;const sent=[],calls=[];
 ctx.globalChat={sendText:async(room,text)=>{sent.push({room,text});return {body:{logId:String(10000+sent.length)}};}};
 const member={id:'10001',name:'old',imageUrl:'photo',profileType:16,profileLinkId:'11',type:0};
 const client={getKnownChatRooms:()=>['100','200','300'].map(id=>({id})),refreshMemberProfiles:async room=>{
  calls.push(room);
  if(race&&room==='100')await ctx.withRoom(room,'',(_,c)=>ctx.profileObserve(c,room,member.id,'newer chat','photo',link));
  return [member];
 },getUserOpenProfileLink:async()=>link};
 try{
  await ctx.initDb();
  for(const room of ['100','200','300'])await query('INSERT INTO hz_rooms(room_id,data) VALUES($1,$2::jsonb)',[room,JSON.stringify({manage:true})]);
  const watcher=createWatcher(ctx,client,{now:()=>clock});
  await watcher.tick();await watcher.tick();assert.deepEqual(calls,['100','200','300','100']);assert.equal(sent.length,0);
  clock+=300001;link='https://open.kakao.com/o/new';
  await watcher.tick();await watcher.tick();assert.equal(sent.length,3);assert.equal(new Set(sent.map(x=>x.room)).size,3);
  race=true;await watcher.tick();await watcher.tick();
  const row=(await query('SELECT observed_profile_name FROM hz_members WHERE room_id=$1',['100'])).rows[0];assert.equal(row.observed_profile_name,'newer chat');
 }finally{await db.close();}
});
