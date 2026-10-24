'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const alerts=require('../manage/profile-alerts');
const {createRuntime}=require('../shared/runtime');
const {createWatcher}=require('../manage/profile-watch');
test('profile toggle persists per room, preserves other settings and gates background notices after restart',async()=>{
 const {PGlite}=require('@electric-sql/pglite'),storage=new PGlite();
 const query=async(sql,args)=>args?.length?storage.query(sql,args):(await storage.exec(sql)).at(-1);
 const pool={query,connect:async()=>({query,release(){}})},runtime=createRuntime({pool,economyEnabled:false});
 const sent=[];runtime.globalBotId='9999';runtime.globalChat={sendText:async(room,text)=>sent.push(text)};
 try{
  await runtime.initDb();
  await query("INSERT INTO hz_rooms(room_id,data) VALUES('100',$1::jsonb),('200',$1::jsonb)",[JSON.stringify({manage:true,game:true,players:{'42':{coins:9}},locked:false})]);
  let member={id:'12345',name:'처음',imageUrl:'old-image',profileType:1,type:0};
  const client={getKnownChatRooms:()=>[{id:'100'}],refreshMemberProfiles:async()=>[member]};
  const watcher=createWatcher(runtime,client);
  await watcher.tick();assert.equal(sent.length,0);
  member={...member,name:'기본 ON'};await watcher.tick();assert.equal(sent.length,1);
  await alerts.setEnabled(pool,'100',false);
  const settings=(await query("SELECT data FROM hz_rooms WHERE room_id='100'")).rows[0].data;
  assert.equal(settings.profileAlerts,false);assert.equal(settings.game,true);assert.equal(settings.manage,true);assert.equal(settings.players['42'].coins,9);
  member={...member,name:'OFF에서 변경'};await createWatcher(runtime,client).tick();assert.equal(sent.length,1);
  assert.equal((await query("SELECT COUNT(*)::int AS n FROM hz_profiles WHERE room_id='100'")).rows[0].n,2,'history continues while alerts are off');
  const change={newName:'다른방',oldName:'이전'};
  assert.equal(await alerts.sendNotice(runtime,runtime.globalChat,'200',change),true);assert.equal(sent.length,2);
  await alerts.setEnabled(pool,'100',true);await watcher.tick();assert.equal(sent.length,2,'no queued duplicate for changes already observed during OFF');
  member={...member,name:'다시 ON'};await watcher.tick();assert.equal(sent.length,3);
  client.refreshMemberProfiles=async()=>{await alerts.setEnabled(pool,'100',false);return [{...member,name:'검사 도중 OFF'}];};
  await watcher.tick();assert.equal(sent.length,3,'in-flight watcher checks OFF immediately before sending');
 }finally{await storage.close();}
});
test('incoming-chat profile notices honor the same room toggle',async()=>{
 let callback,on=false;const sent=[];
 const pool={query:async sql=>({rows:sql.includes('AS profile_alerts')?[{profile_alerts:on}]:[]})};
 const ctx={OWNER_IDS:new Set(),pool,id:v=>String(v??''),initDb:async()=>{},promoTick:async()=>{},autoFishTick:async()=>{},
  roomFlags:async()=>({manage:true,game:true,locked:false}),senderExactId:msg=>msg.sender.id,
  processMentionAlerts:async()=>{},addChatCount:async()=>{},saveOpenProfileLink:async()=>{},extractProfile:()=>null,findOpenProfileLink:()=>null,
  profileObserve:async()=>({oldName:'이전',newName:'새이름'}),withRoom:async(r,n,fn)=>fn({game:true,locked:false},{}),
  handleGame:async()=>null,send:async(c,r,text)=>sent.push(text),nowK:()=> '오늘'};
 const client={userId:'9999',chat:{},onMessage:fn=>callback=fn,onJoin(){},onLeave(){},onKick(){}};
 await require('../shared/session')(ctx).attachHZBot(client);
 const message={__gameCommandFastPath:true,room:{id:'100'},sender:{id:'12345',name:'새이름'},message:{text:'#낚시'}};
 await callback(message);assert.deepEqual(sent,[]);
 on=true;await callback(message);assert.equal(sent.length,1);assert.match(sent[0],/프로필을 변경/);
});
test('management help documents both profile alert commands',()=>{
 const help=require('../shared/help').formatCommandHelp({manage:true},'관리');
 assert.ok(help.includes('!프로필감지on'));assert.ok(help.includes('!프로필감지off'));
});
