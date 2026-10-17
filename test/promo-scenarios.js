'use strict';
const assert=require('node:assert/strict');
module.exports=async({t,request,headers,base,query,status})=>{
 const post=(path,b,h=headers,method='POST')=>request(path,{method,headers:h,body:JSON.stringify(b)});
 const anon={'Content-Type':'application/json',Origin:base};
 const pwd='isolated-promo-password-123';let alice,bob,aliceId,invite;
 const register=async(name,room)=>{const issued=await post('/api/admin/promo-invites',{label:name,hours:24,roomIds:[room]});assert.equal(issued.status,200);const i=(await issued.json()).invite;const token=i.path.split('invite=')[1];const r=await post('/api/promo/register',{invite:token,username:name,name,password:pwd},anon);assert.equal(r.status,200);const s=await r.json();return {h:{...anon,Cookie:r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':s.csrf},s,token};};
 await query('INSERT INTO hz_rooms(room_id,data) VALUES($1,$2::jsonb),($3,$4::jsonb)',['10',JSON.stringify({name:'홍보 테스트 A',game:true,manage:false,promo:{allowed:true}}),'11',JSON.stringify({name:'홍보 테스트 B',game:false,promo:{allowed:false}})]);
 await t.test('invite-only signup consumes one-use tokens; account cookies cannot access admin',async()=>{
  assert.equal((await post('/api/promo/register',{username:'intruder',name:'x',password:pwd},anon)).status,400);
  alice=await register('alice','10');aliceId=alice.s.user.id;invite=alice.token;bob=await register('bob','11');
  assert.equal((await post('/api/promo/register',{invite,username:'replay',name:'x',password:pwd},anon)).status,400);
  assert.equal((await request('/api/admin/rooms',{headers:alice.h})).status,401);
  assert.equal((await request('/api/promo/rooms',{headers})).status,401);
  const session=await(await request('/api/promo/session',{headers:alice.h})).json();assert.equal(session.user.username,'alice');assert.equal(session.csrf,alice.s.csrf);
  const listing=await(await request('/api/admin/promo-members',{headers})).json();assert.equal(listing.members.length,2);assert.ok(!JSON.stringify(listing).includes('password_hash'));
  const invites=await(await request('/api/admin/promo-invites',{headers})).json();assert.ok(!JSON.stringify(invites).includes(invite));assert.ok(!JSON.stringify(invites).includes('token_hash'));
 });
 await t.test('tenant rooms, logs and mutations are scoped; CSRF and interval validation block bypasses',async()=>{
  const rooms=await(await request('/api/promo/rooms',{headers:alice.h})).json();assert.deepEqual(rooms.rooms.filter(r=>r.canManage).map(r=>r.id),['10']);assert.ok(rooms.rooms.some(r=>r.name==='홍보 테스트 B'&&r.id===null&&!r.canManage));assert.ok(rooms.rooms.filter(r=>!r.canManage).every(r=>!r.promotion));
  for(const action of ['content','start','stop','delete','immediate'])assert.equal((await post('/api/promo/promotion',{roomId:'11',action,message:'forbidden',minutes:20,confirm:true},alice.h)).status,action==='immediate'&&!status.chat?503:403);
  assert.equal((await request('/api/promo/logs?roomId=11',{headers:alice.h})).status,403);
  assert.equal((await post('/api/promo/promotion',{roomId:'10',action:'content',message:'x'},{...alice.h,'X-CSRF-Token':''})).status,403);
  assert.equal((await post('/api/promo/promotion',{roomId:'10',action:'content',message:'x'},{...alice.h,Origin:'https://other.example'})).status,403);
  assert.equal((await post('/api/promo/promotion',{roomId:'10',action:'allow',allowed:true},alice.h)).status,400);
  assert.equal((await post('/api/promo/promotion',{roomId:'10',action:'start',minutes:25},alice.h)).status,400);
  assert.equal((await post('/api/promo/promotion',{roomId:'10',action:'interval',minutes:30},alice.h)).status,200);assert.equal((await query('SELECT data FROM hz_rooms WHERE room_id=$1',['10'])).rows[0].data.promo.minutes,30);
  assert.equal((await post('/api/promo/promotion',{roomId:'11',action:'start',minutes:20},bob.h)).status,403);
  assert.equal((await post('/api/promo/promotion',{roomId:'10',action:'schedule',scheduledAt:new Date().toISOString()},alice.h)).status,400);
  assert.equal((await post('/api/promo/login',{username:'alice',password:pwd},{...anon,Origin:'https://other.example'})).status,403);
 });
 await t.test('full bot room sync adds silent rooms and only changes names on existing game records',async()=>{
  const sync=require('../promotion/rooms');let calls=0;const client={getChatRooms:async()=>{calls++;},getKnownChatRooms:()=>[{id:'10',name:'홍보 테스트 A 변경'},{id:'12',name:'아직 메시지 없는 방'}]};await sync.refresh(client);await sync.refresh(client);assert.equal(calls,1);const r=(await query('SELECT data FROM hz_rooms WHERE room_id=$1',['10'])).rows[0].data;assert.equal(r.name,'홍보 테스트 A 변경');assert.equal(r.game,true);assert.equal(r.manage,false);assert.equal(r.promo.minutes,30);const fresh=(await query('SELECT data FROM hz_rooms WHERE room_id=$1',['12'])).rows[0].data;assert.equal(fresh.game,false);const listed=await(await request('/api/promo/rooms',{headers:alice.h})).json();assert.ok(listed.rooms.some(r=>r.name==='아직 메시지 없는 방'&&!r.canManage));
 });
 await t.test('ON sends only at 00/20/40 or 00/30; OFF, dedup and revoked access stop delivery',async()=>{
  const promotion=require('../promotion'),messages=[],clock=Date.now;status.chat={sendText:async(room,message)=>messages.push({room,message})};
  const mutate=(action,b={})=>post('/api/promo/promotion',{roomId:'10',action,...b},alice.h);
  assert.equal((await mutate('content',{message:'fixture message'})).status,200);
  try{
   let at=new Date('2026-10-18T01:03:00+09:00').getTime();Date.now=()=>at;
   assert.equal((await mutate('start',{minutes:20})).status,200);assert.equal(await promotion.deliver('10',status.chat),false);
   at=new Date('2026-10-18T01:20:08+09:00').getTime();assert.equal(await promotion.deliver('10',status.chat),true);assert.equal(await promotion.deliver('10',status.chat),false);
   at=new Date('2026-10-18T01:27:00+09:00').getTime();assert.equal(await promotion.deliver('10',status.chat),false);
   at=new Date('2026-10-18T01:40:08+09:00').getTime();assert.equal(await promotion.deliver('10',status.chat),true);
   assert.equal((await mutate('stop')).status,200);at=new Date('2026-10-18T02:00:08+09:00').getTime();assert.equal(await promotion.deliver('10',status.chat),false);
   assert.equal((await mutate('start',{minutes:30})).status,200);at=new Date('2026-10-18T02:20:08+09:00').getTime();assert.equal(await promotion.deliver('10',status.chat),false);
   at=new Date('2026-10-18T02:30:08+09:00').getTime();assert.equal(await promotion.deliver('10',status.chat),true);
   const d=(await query('SELECT data FROM hz_rooms WHERE room_id=$1',['10'])).rows[0].data;assert.equal(d.game,true);assert.equal(d.manage,false);
   await query("INSERT INTO gl_promotion_logs(room_id,slot,status) VALUES('10','operator-test','SENT')");const logs=await(await request('/api/promo/logs?roomId=10',{headers:alice.h})).json();assert.equal(logs.logs.length,3);
   assert.equal((await post('/api/admin/promo-members',{id:aliceId,enabled:true,roomIds:[]})).status,200);
   at=new Date('2026-10-18T03:00:08+09:00').getTime();assert.equal(await promotion.deliver('10',status.chat),false);assert.equal((await mutate('start',{minutes:20})).status,403);assert.equal(messages.length,3);
  }finally{Date.now=clock;}
 });
 await t.test('expired/revoked invites cannot create accounts; disabled accounts and password changes revoke sessions',async()=>{
  const issued=await(await post('/api/admin/promo-invites',{label:'revoked',roomIds:['10'],hours:24})).json();assert.equal((await post('/api/admin/promo-invites',{id:issued.invite.id},headers,'DELETE')).status,200);
  assert.equal((await post('/api/promo/register',{invite:issued.invite.path.split('invite=')[1],username:'revoked',name:'x',password:pwd},anon)).status,400);
  const expiry=await(await post('/api/admin/promo-invites',{label:'expired',roomIds:['10'],hours:24})).json();await query("UPDATE gl_promo_invites SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[expiry.invite.id]);assert.equal((await post('/api/promo/register',{invite:expiry.invite.path.split('invite=')[1],username:'expired',name:'x',password:pwd},anon)).status,400);
  assert.equal((await post('/api/promo/password',{oldPassword:'wrong',password:'new-isolated-password'},bob.h)).status,403);
  assert.equal((await post('/api/promo/password',{oldPassword:pwd,password:'new-isolated-password'},bob.h)).status,200);assert.equal((await request('/api/promo/rooms',{headers:bob.h})).status,401);
  const login=await post('/api/promo/login',{username:'bob',password:'new-isolated-password'},anon);assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));
  assert.equal((await post('/api/admin/promo-members',{id:bob.s.user.id,enabled:false,roomIds:['11']})).status,200);assert.equal((await request('/api/promo/rooms',{headers:{Cookie:cookie}})).status,401);
  for(const path of ['/promo/','/promo/app.js','/promo/style.css'])assert.equal((await request(path)).status,200);assert.equal((await request('/promo/accounts.js')).status,404);
 });
};
