'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const billing=require('../shared/room-subscriptions');
function read(relative){return fs.readFileSync(path.join(__dirname,'..',relative),'utf8');}
async function fixture(){
 const store=new PGlite();
 const db={query:(sql,args)=>store.query(sql,args),
  connect:async()=>({query:(sql,args)=>store.query(sql,args),release(){}})};
 await store.exec("CREATE TABLE hz_rooms (room_id TEXT PRIMARY KEY, data JSONB NOT NULL DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());"+
  "CREATE TABLE gl_manage_rooms (room_id TEXT PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT FALSE);");
 await billing.init(db);
 return {store,db,close:()=>store.close()};
}
test('plan validation and 7-day start notice are exact',()=>{
 assert.equal(billing.validPlan('manage'),'manage');
 assert.equal(billing.validPlan('game'),'game');
 assert.equal(billing.validPlan('all'),'all');
 assert.throws(()=>billing.validPlan('unknown'),/요금제/);
 for(const days of [0,-5,1.5,3651,'abc'])assert.throws(()=>billing.validDays(days));
 assert.equal(billing.validDays(7),7);
 const current={roomId:'1234',plan:'all',planLabel:'종합',durationDays:7,remainingSeconds:7*86400,expiresAt:new Date(Date.now()+7*86400000).toISOString()};
 const message=billing.notice(current);
 assert.match(message,/봇 작동을 시작합니다/);
 assert.match(message,/일주일 \(7일\)/);
 assert.match(message,/종합 \(관리 \+ 게임\)/);
 assert.match(message,/자동 종료까지/);
 assert.match(message,/7일/);
});
test('legacy rooms are allowed; new unlicensed rooms denied',async()=>{
 const f=await fixture();
 try{
  assert.equal(await billing.permitted('5001',f.db),false);
  await f.db.query("INSERT INTO gl_room_subscription_legacy(room_id) VALUES('5001')");
  assert.equal(await billing.permitted('5001',f.db),true);
  assert.equal(await billing.permitted('5002',f.db),false);
 }finally{await f.close();}
});
test('paid management, game, all packages apply room flags without losing user data',async()=>{
 const f=await fixture();
 try{
  await f.db.query("INSERT INTO hz_rooms(room_id,data) VALUES('5001','{\"players\":{\"1\":{\"balance\":100}}}'::jsonb)");
  const issued=await billing.grant(f.db,{roomId:'5001',plan:'manage',days:7,actor:'master:test'});
  assert.equal(issued.durationDays,7);
  assert.equal(issued.plan,'manage');
  assert.equal(await billing.permitted('5001',f.db),true);
  let q=await f.db.query("SELECT data FROM hz_rooms WHERE room_id='5001'");
  assert.equal(q.rows[0].data.manage,true);
  assert.equal(q.rows[0].data.game,false);
  assert.equal(q.rows[0].data.players['1'].balance,100);
  assert.equal((await f.db.query("SELECT enabled FROM gl_manage_rooms WHERE room_id='5001'")).rows[0].enabled,true);
  await billing.changePlan(f.db,{roomId:'5001',plan:'game',actor:'master:test'});
  q=await f.db.query("SELECT data FROM hz_rooms WHERE room_id='5001'");
  assert.equal(q.rows[0].data.manage,false);
  assert.equal(q.rows[0].data.game,true);
  await billing.changePlan(f.db,{roomId:'5001',plan:'all',actor:'master:test'});
  q=await f.db.query("SELECT data FROM hz_rooms WHERE room_id='5001'");
  assert.equal(q.rows[0].data.manage,true);
  assert.equal(q.rows[0].data.game,true);
  await assert.rejects(billing.grant(f.db,{roomId:'5001',plan:'game',days:1,actor:'master:test'}),/이미/);
 }finally{await f.close();}
});
test('expiry auto-disables bot, then extension restores correct package',async()=>{
 const f=await fixture();
 try{
  await billing.grant(f.db,{roomId:'6001',plan:'all',days:1,actor:'master:test'});
  await f.db.query("UPDATE gl_room_subscriptions SET expires_at=NOW()-INTERVAL '1 second' WHERE room_id='6001'");
  assert.equal((await billing.get('6001',f.db)).active,false);
  assert.equal(await billing.permitted('6001',f.db),false);
  assert.deepEqual(await billing.expire(f.db),['6001']);
  const blocked=await f.db.query("SELECT data FROM hz_rooms WHERE room_id='6001'");
  assert.equal(blocked.rows[0].data.botEnabled,false);
  assert.equal(blocked.rows[0].data.game,false);
  assert.equal(blocked.rows[0].data.manage,false);
  assert.equal(await billing.permitted('6001',f.db),false);
  const restored=await billing.extend(f.db,{roomId:'6001',days:7,actor:'master:test'});
  assert.equal(restored.active,true);
  assert.equal(restored.durationDays,8);
  assert.equal(await billing.permitted('6001',f.db),true);
  const resumed=await f.db.query("SELECT data FROM hz_rooms WHERE room_id='6001'");
  assert.equal(resumed.rows[0].data.botEnabled,true);
  assert.equal(resumed.rows[0].data.game,true);
  assert.equal(resumed.rows[0].data.manage,true);
  assert.deepEqual(await billing.expire(f.db),[]);
 }finally{await f.close();}
});
test('initial and renewed plan announcements are delivered once per revision',async()=>{
 const f=await fixture();
 try{
  await billing.grant(f.db,{roomId:'7001',plan:'game',days:7,actor:'master:test'});
  const sent=[],client={connected:true,getKnownChatRooms:()=>[{id:'7001'}],chat:{sendText:async(room,message)=>{sent.push({room,message});return {ok:true};}}};
  assert.equal(await billing.sendNotice(client,'7001',f.db),true);
  assert.equal(await billing.sendNotice(client,'7001',f.db),false);
  assert.equal(sent.length,1);
  assert.match(sent[0].message,/게임 요금제|요금제 : 게임/);
  await billing.extend(f.db,{roomId:'7001',days:7,actor:'master:test'});
  assert.equal(await billing.sendNotice(client,'7001',f.db),true);
  assert.equal(sent.length,2);
  assert.match(sent[1].message,/연장되었습니다/);
 }finally{await f.close();}
});
test('all chat and automatic operations have a paid-plan gate',()=>{
 for(const file of ['shared/room-subscriptions.js','shared/bot-power.js','shared/router.js','shared/session.js','game/features.js','game/fishing-coin-event.js','manage/scheduled-notices.js']){
  assert.doesNotThrow(()=>new Function(read(file)),file);
 }
 assert.match(read('shared/router.js'),/!남은시간/);
 assert.match(read('shared/router.js'),/permitted\(roomId\)/);
 assert.match(read('shared/session.js'),/bot-power/);
 assert.match(read('shared/bot-power.js'),/gl_room_subscription_legacy/);
 assert.match(read('shared/room-subscriptions.js'),/gl_room_subscription_setup/);
 assert.match(read('api/routes.js'),/room-portal-extend/);
 assert.match(read('api/room-portal.js'),/masterExtend/);
 assert.match(read('admin-web/room-portals.js'),/room-portal-extend/);
 assert.match(read('room-panel/app.js'),/subscriptionCountdown/);
});
