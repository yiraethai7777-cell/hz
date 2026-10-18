'use strict';
const assert=require('node:assert/strict');
module.exports=async({t,request,headers,base,query,status})=>{
 const mod=require('../promotion/kakao'),original=mod.service,messages=[],clients=[],EventEmitter=require('node:events');let nextId='7001',extraRoom=false;
 const provider={generateDeviceUuid:()=>require('node:crypto').randomUUID(),qrGenerate:async()=>({url:'fixture-qr-only',remainingSeconds:180}),qrPollLogin:async()=>({user:{userId:nextId},accessToken:'fixture-secret-'+nextId,refreshToken:'fixture-refresh'}),qrCancel:async()=>{}};
 const service=mod.createService({provider:()=>provider,makeClient:config=>{const c=new EventEmitter();c.userId=config.userId;c.connect=async()=>{};c.disconnect=()=>{c.emit('disconnected');};c.getChatRooms=async()=>{};c.getKnownChatRooms=()=>[...(extraRoom&&config.userId==='7001'?[{id:'303',name:'나중에 추가된 방'}]:[]),{id:'100',name:'본인 공통 방'},{id:config.userId==='7001'?'101':'202',name:'본인 전용 방'}];c.chat={sendText:async(room,message)=>messages.push({sender:c.userId,room,message})};clients.push(c);return c;}});mod.service=()=>service;
 const post=(path,b,h=headers,method='POST')=>request(path,{method,headers:h,body:JSON.stringify(b)}),anon={'Content-Type':'application/json',Origin:base};
 let alice,bob,token;
 async function qrLogin(kakaoId,invite=''){nextId=kakaoId;const start=await post('/api/promo/qr/start',{consent:true,invite},anon);assert.equal(start.status,200);const d=await start.json(),h={...anon,Cookie:start.headers.get('set-cookie').split(';')[0]};assert.ok(d.qr.startsWith('data:image/svg+xml;base64,'));assert.ok(!JSON.stringify(d).includes('fixture-secret'));
 const finish=await post('/api/promo/qr/poll',{csrf:d.csrf},h);const data=await finish.json();return {status:finish.status,data,h:{...anon,Cookie:(finish.headers.get('set-cookie')||'').split(';')[0],'X-CSRF-Token':data.csrf},qrHeaders:h,qrCsrf:d.csrf};}
 async function invite(label){const r=await post('/api/admin/promo-invites',{label,hours:24});assert.equal(r.status,200);return (await r.json()).invite;}
 try{
 await t.test('QR consent, origin, browser binding and invite-only first signup',async()=>{
 assert.equal((await post('/api/promo/qr/start',{consent:false},anon)).status,400);
 assert.equal((await post('/api/promo/qr/start',{consent:true},{...anon,Origin:'https://foreign.example'})).status,403);
 const uninvited=await qrLogin('7999');assert.equal(uninvited.status,403);
 const i=await invite('홍보 이용자 A');token=i.path.split('invite=')[1];alice=await qrLogin('7001',token);assert.equal(alice.status,200);assert.equal(alice.data.user.name,'홍보 이용자 A');
 assert.equal((await post('/api/promo/qr/start',{consent:true,invite:token},anon)).status,400);
 const i2=await invite('홍보 이용자 B');bob=await qrLogin('7002',i2.path.split('invite=')[1]);assert.equal(bob.status,200);
 assert.equal((await post('/api/promo/qr/poll',{csrf:alice.qrCsrf},bob.qrHeaders)).status,401);
 assert.equal((await request('/api/admin/rooms',{headers:alice.h})).status,401);
 const stored=(await query('SELECT user_id,credential FROM gl_promo_kakao')).rows;assert.equal(stored.length,2);for(const row of stored){assert.ok(!row.credential.includes('fixture-secret'));assert.throws(()=>mod.open('99999',row.credential));assert.ok(mod.open(row.user_id,row.credential).oauthToken.startsWith('fixture-secret'));}
 });
 await t.test('each account sees only its own full list; shared room settings and senders are independent',async()=>{
 for(const [s,expected,forbidden]of [[alice,'101','202'],[bob,'202','101']]){const d=await(await request('/api/promo/rooms',{headers:s.h})).json();assert.equal(d.connected,true);assert.ok(d.rooms.some(r=>r.id===expected));assert.ok(!d.rooms.some(r=>r.id===forbidden));assert.ok(!JSON.stringify(d).includes('fixture-secret'));assert.equal((await post('/api/promo/promotion',{roomId:forbidden,action:'content',message:'forbidden'},s.h)).status,403);}
 assert.equal((await request('/api/promo/logs?roomId=202',{headers:alice.h})).status,403);
 for(const [s,message]of [[alice,'A 계정 홍보'],[bob,'B 계정 홍보']]){assert.equal((await post('/api/promo/promotion',{roomId:'100',action:'content',message},s.h)).status,200);assert.equal((await post('/api/promo/promotion',{roomId:'100',action:'start',minutes:20},s.h)).status,200);assert.equal((await post('/api/promo/promotion',{roomId:'100',action:'immediate',confirm:true},s.h)).status,200);}
 assert.deepEqual(messages.map(m=>[m.sender,m.message]),[['7001','A 계정 홍보'],['7002','B 계정 홍보']]);
 const logs=await(await request('/api/promo/logs?roomId=100',{headers:alice.h})).json();assert.equal(logs.logs.length,1);
 assert.equal((await post('/api/promo/promotion',{roomId:'100',action:'stop'},{...alice.h,'X-CSRF-Token':''})).status,403);
 assert.equal((await post('/api/promo/promotion',{roomId:'100',action:'start',minutes:25},alice.h)).status,400);
 });
 await t.test('one account message updates all rooms including future rooms and stays isolated from other users',async()=>{
 const user=alice.data.user.id;
 assert.equal((await post('/api/promo/message',{message:'모든 방 공통 홍보'},alice.h)).status,200);
 assert.equal((await post('/api/promo/message',{message:'권한 없이 변경'},{...alice.h,'X-CSRF-Token':''})).status,403);
 assert.equal((await post('/api/promo/message',{message:'x'.repeat(1001)},alice.h)).status,400);
 assert.equal((await post('/api/promo/message',{message:'공통 문구 수정'},alice.h)).status,200);
 const before=messages.length;
 const clock=Date.now;Date.now=()=>clock()+600000;try{for(const room of ['100','101'])assert.equal(await service.deliver(user,room,true),true);}finally{Date.now=clock;}
 assert.deepEqual(messages.slice(before).map(m=>m.message),['공통 문구 수정','공통 문구 수정']);
 assert.equal((await(await request('/api/promo/message',{headers:bob.h})).json()).message,'B 계정 홍보');
 extraRoom=true;service.stopUser(user);const listed=await(await request('/api/promo/rooms',{headers:alice.h})).json();assert.ok(listed.rooms.some(r=>r.id==='303'));assert.equal(listed.message,'공통 문구 수정');
 assert.equal(await service.deliver(user,'303',true),true);assert.equal(messages.at(-1).message,'공통 문구 수정');
 await require('../api/schema').init();assert.equal(await service.commonMessage(user),'공통 문구 수정');
 });
 await t.test('deleting the common message stops all account rooms without changing another account or restoring old text',async()=>{
 const user=alice.data.user.id;
 assert.equal((await post('/api/promo/promotion',{roomId:'101',action:'start',minutes:20},alice.h)).status,200);
 assert.equal((await post('/api/promo/message',{action:'delete'},alice.h)).status,400);
 assert.equal((await post('/api/promo/message',{action:'delete',confirm:true},alice.h)).status,200);
 assert.ok((await query('SELECT promotion FROM gl_promo_account_rooms WHERE user_id=$1',[user])).rows.every(r=>r.promotion.enabled===false));
 assert.equal((await query('SELECT promotion FROM gl_promo_account_rooms WHERE user_id=$1 AND room_id=$2',[bob.data.user.id,'100'])).rows[0].promotion.enabled,true);
 assert.equal((await post('/api/promo/promotion',{roomId:'101',action:'start',minutes:20},alice.h)).status,400);
 await require('../api/schema').init();assert.equal(await service.commonMessage(user),'');
 assert.equal((await post('/api/promo/message',{message:'시간표 검증용 공통 문구'},alice.h)).status,200);
 });
 await t.test('fixed clock slots persist across reconnect; OFF and duplicate slots stop sending',async()=>{
 const now=Date.now;try{let at=new Date('2027-01-01T01:03:00+09:00').getTime();Date.now=()=>at;
 await service.configure(alice.data.user.id,'100','start',{minutes:30});assert.equal(await service.deliver(alice.data.user.id,'100'),false);
 at=new Date('2027-01-01T01:30:08+09:00').getTime();assert.equal(await service.deliver(alice.data.user.id,'100'),true);assert.equal(await service.deliver(alice.data.user.id,'100'),false);
 service.stopUser(alice.data.user.id);at=new Date('2027-01-01T02:00:08+09:00').getTime();assert.equal(await service.deliver(alice.data.user.id,'100'),true);
 await service.configure(alice.data.user.id,'100','stop',{});at=new Date('2027-01-01T02:30:08+09:00').getTime();assert.equal(await service.deliver(alice.data.user.id,'100'),false);
 }finally{Date.now=now;}
 });
 await t.test('QR reconnect logs in existing account without an invite; disconnect deletes server credentials and stops only that user',async()=>{
 const relog=await qrLogin('7001');assert.equal(relog.status,200);assert.equal(relog.data.user.id,alice.data.user.id);
 assert.equal((await post('/api/promo/disconnect',{},relog.h)).status,200);assert.equal((await query('SELECT credential FROM gl_promo_kakao WHERE user_id=$1',[alice.data.user.id])).rows[0].credential,'');const again=await qrLogin('7001');assert.equal(again.status,200);
 assert.equal((await query('SELECT * FROM gl_promo_kakao WHERE user_id=$1',[bob.data.user.id])).rowCount,1);
 assert.equal((await post('/api/admin/promo-members',{id:bob.data.user.id,enabled:false})).status,200);assert.equal((await request('/api/promo/rooms',{headers:bob.h})).status,401);await assert.rejects(()=>service.clientFor(bob.data.user.id));
 const rows=(await query('SELECT promotion FROM gl_promo_account_rooms WHERE user_id=$1',[bob.data.user.id])).rows;assert.ok(rows.every(r=>r.promotion.enabled===false));
 const inv=await invite('취소용');await post('/api/admin/promo-invites',{id:inv.id},headers,'DELETE');assert.equal((await post('/api/promo/qr/start',{consent:true,invite:inv.path.split('invite=')[1]},anon)).status,400);
 for(const route of ['/promo/','/promo/app.js','/promo/style.css'])assert.equal((await request(route)).status,200);
 });
 await t.test('legacy migration keeps a single shared text, never chooses between conflicting texts, and preserves original room records',async()=>{
 for(const [name,texts]of [['migration_same',['기존 공통 문구','기존 공통 문구']],['migration_conflict',['방 A 문구','방 B 문구']]]){const u=(await query("INSERT INTO gl_promo_users(username,password_hash,display_name) VALUES($1,'QR_ONLY',$1) RETURNING id",[name])).rows[0].id;
 for(let i=0;i<texts.length;i++)await query('INSERT INTO gl_promo_account_rooms(user_id,room_id,promotion) VALUES($1,$2,$3::jsonb)',[u,String(801+i),JSON.stringify({message:texts[i],enabled:true,minutes:20})]);
 await require('../api/schema').init();assert.equal(await service.commonMessage(u),name==='migration_same'?'기존 공통 문구':'');assert.deepEqual((await query('SELECT promotion FROM gl_promo_account_rooms WHERE user_id=$1 ORDER BY room_id',[u])).rows.map(r=>r.promotion.message),texts);
 }
 });
 await t.test('invited web signup and password login keep Kakao connection separate',async()=>{
 const fixturePassword='fixture-web-password-123';
 assert.equal((await post('/api/promo/register',{username:'web_new',name:'웹 회원',password:fixturePassword},anon)).status,400);
 const i=await invite('아이디 가입 테스트'),inviteToken=i.path.split('invite=')[1];
 assert.equal((await post('/api/promo/register',{invite:inviteToken,username:'web_new',name:'웹 회원',password:'short'},anon)).status,400);
 const created=await post('/api/promo/register',{invite:inviteToken,username:'web_new',name:'웹 회원',password:fixturePassword},anon);assert.equal(created.status,200);const d=await created.json();assert.equal(d.user.needsPassword,false);const h={...anon,Cookie:created.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':d.csrf};
 assert.equal((await query('SELECT * FROM gl_promo_kakao WHERE user_id=$1',[d.user.id])).rowCount,0);
 assert.equal((await post('/api/promo/register',{invite:inviteToken,username:'web_again',name:'중복',password:fixturePassword},anon)).status,400);
 assert.equal((await post('/api/promo/login',{username:'web_new',password:'wrong'},anon)).status,401);
 const logged=await post('/api/promo/login',{username:'web_new',password:fixturePassword},anon);assert.equal(logged.status,200);assert.equal((await logged.json()).user.id,d.user.id);
 assert.equal((await post('/api/promo/setup-login',{username:'not_overwrite',password:fixturePassword},h)).status,409);
 assert.equal((await post('/api/promo/password',{oldPassword:'wrong',password:'replacement-password-123'},h)).status,403);
 const stored=(await query('SELECT password_hash FROM gl_promo_users WHERE id=$1',[d.user.id])).rows[0].password_hash;assert.ok(!stored.includes(fixturePassword));
 });
 await t.test('existing QR member sets own web login once, preserving linked account, rooms and history',async()=>{
 const user=alice.data.user.id,fixturePassword='fixture-qr-web-password-123';
 const snapshot=async()=>({linked:(await query('SELECT * FROM gl_promo_kakao WHERE user_id=$1',[user])).rows,rooms:(await query('SELECT * FROM gl_promo_account_rooms WHERE user_id=$1 ORDER BY room_id',[user])).rows,logs:(await query('SELECT * FROM gl_promo_account_logs WHERE user_id=$1 ORDER BY id',[user])).rows,message:await service.commonMessage(user)});
 const before=await snapshot();
 assert.equal((await post('/api/promo/setup-login',{username:'alice_web',password:fixturePassword},anon)).status,401);
 assert.equal((await post('/api/promo/setup-login',{username:'alice_web',password:fixturePassword},{...alice.h,'X-CSRF-Token':''})).status,403);
 assert.equal((await post('/api/promo/setup-login',{username:'migration_same',password:fixturePassword},alice.h)).status,400);
 assert.equal((await query('SELECT password_hash FROM gl_promo_users WHERE id=$1',[user])).rows[0].password_hash,'QR_ONLY');
 const done=await post('/api/promo/setup-login',{username:'alice_web',password:fixturePassword,id:bob.data.user.id},alice.h);assert.equal(done.status,200);const d=await done.json();assert.equal(d.user.id,user);assert.equal(d.user.needsPassword,false);assert.deepEqual(await snapshot(),before);
 assert.equal((await request('/api/promo/session',{headers:alice.h})).status,200);assert.equal((await(await request('/api/promo/session',{headers:alice.h})).json()).authenticated,false);
 const h={...anon,Cookie:done.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':d.csrf};
 assert.equal((await post('/api/promo/setup-login',{username:'alice_twice',password:fixturePassword},h)).status,409);
 const login=await post('/api/promo/login',{username:'alice_web',password:fixturePassword},anon);assert.equal(login.status,200);assert.equal((await login.json()).user.id,user);
 assert.equal((await query('SELECT password_hash FROM gl_promo_users WHERE id=$1',[bob.data.user.id])).rows[0].password_hash,'QR_ONLY');
 });
 }finally{service.close();mod.service=original;}
};
