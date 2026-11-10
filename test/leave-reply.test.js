'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const feature=require('../manage/leave-reply');
const target='9007199254740993123',log='9007199254740993456';
const msg=(author='9999',id=log)=>({message:{type:26},attachmentsRaw:[`{"src_userId":${author},"src_logId":${id}}`]});

test('manager join notice shows summary above fold and detailed activity below',()=>{
 const out=feature.joinNotice({
  name:'테스트',userId:target,joins:3,leaves:2,warnings:2,bans:1,
  time:'2026.11.10 09:00',profileLink:'https://open.kakao.com/o/example'
 });
 const [summary,details]=out.split('\u200b'.repeat(1200));
 assert.match(summary,/^💛 카카오톡 관리 매니저 \| 입장 안내/);
 assert.match(summary,/님, 환영합니다!/);
 assert.match(summary,/📊 입장 \/ 퇴장 : 3회 \/ 2회/);
 assert.match(summary,/⚠️ 누적 경고 : 2회/);
 assert.match(summary,new RegExp(target));
 assert.match(summary,/📋 상세 활동 기록/);
 assert.match(details,/2026.11.10 09:00/);
 assert.match(details,/https:\/\/open.kakao.com\/o\/example/);
 assert.match(details,/🛡️ 강퇴 기록 : 1회/);
 assert.match(details,/KakaoTalk Manager/);
 assert.match(feature.joinNotice({name:'A'}),/확인 불가/);
});

test('manager leave notice shows exit details, real warnings and reply-to-ban help',()=>{
 const out=feature.leaveNotice({
  name:'테스트',userId:target,joins:3,leaves:3,warnings:2,bans:1,
  joinedAt:'2026.11.10 09:00',time:'2026.11.10 10:30',stay:'1시간 30분'
 });
 const [summary,details]=out.split('\u200b'.repeat(1200));
 assert.match(summary,/^💛 카카오톡 관리 매니저 \| 퇴장 안내/);
 assert.match(summary,/님이 퇴장하셨습니다/);
 assert.match(summary,/📊 입장 \/ 퇴장 : 3회 \/ 3회/);
 assert.match(summary,/⚠️ 누적 경고 : 2회/);
 assert.match(summary,new RegExp(target));
 assert.match(details,/📅 입장 시각\n2026.11.10 09:00/);
 assert.match(details,/📅 퇴장 시각\n2026.11.10 10:30/);
 assert.match(details,/⏱️ 체류 시간\n1시간 30분/);
 assert.match(details,/🛡️ 강퇴 기록 : 1회/);
 assert.match(details,/k 또는 p 입력 시 강퇴 확인 요청/);
 assert.match(details,/방장·부방장·지정 관리자/);
 assert.match(details,/KakaoTalk Manager/);
 assert.equal(feature.replyReference(msg(),'9999'),log);
 assert.equal(feature.replyReference(msg('8888'),'9999'),null);
 assert.equal(feature.replyReference({message:{type:1},attachmentsRaw:msg().attachmentsRaw},'9999'),null);
 for(const field of ['threadId','tid','thread']){
  assert.equal(feature.replyReference({message:{type:1},raw:{chatLog:{[field]:log}}},'9999'),log);
 }
 assert.equal(feature.replyReference({message:{type:1},text:'a'},'9999'),null);
});

async function setupLeaveFixture(){
 const storage=new PGlite(),db={query:async(sql,params)=>storage.query(sql,params)};
 await feature.init(db);await feature.init(db);
 await db.query('CREATE TABLE gl_manage_admins(room_id TEXT,user_id TEXT,PRIMARY KEY(room_id,user_id))');
 await db.query('CREATE TABLE gl_manage_actions(room_id TEXT,actor_id TEXT,target_id TEXT,action TEXT,detail TEXT)');
 await feature.record(db,{roomId:'100',botId:'9999',userId:target,name:'테스트',result:{body:{logId:log}}});
 let calls=0;const replies=[];
 const ctx={roomId:'100',botId:'9999',userId:'7777',senderType:1,text:'k',msg:msg(),
  send:async s=>{replies.push(s);},kick:async id=>{assert.equal(id,target);calls++;}};
 return {storage,db,ctx,replies,called:()=>calls};
}

test('k/p only ask for confirmation; the same operator y authorizes a single kick after restart',async()=>{
 const {storage,db,ctx,replies,called}=await setupLeaveFixture();
 try{
  assert.equal(await feature.handle({...ctx,text:'hello'},db),false);
  assert.equal(await feature.handle({...ctx,text:'y'},db),false);
  assert.equal(await feature.handle({...ctx,msg:{message:{type:1}}},db),false);
  assert.equal(await feature.handle({...ctx,roomId:'200'},db),false);
  assert.equal(await feature.handle({...ctx,msg:msg('8888')},db),false);
  await feature.handle({...ctx,senderType:2},db);
  assert.equal(called(),0,'unprivileged k never kicks');
  await feature.handle(ctx,db);
  assert.equal(called(),0,'k only requests confirmation');
  assert.match(replies.at(-1),/정말 테스트 님을 강퇴하시겠습니까\?/);
  assert.match(replies.at(-1),/동의: y/);
  assert.equal((await db.query('SELECT state FROM gl_leave_replies')).rows[0].state,'pending');
  const restarted=require('../manage/leave-reply');
  const comment={message:{type:1},raw:{chatLog:{threadId:log}}};
  assert.equal(await restarted.handle({...ctx,text:'y',userId:'1234',msg:comment},db),false);
  assert.equal(await restarted.handle({...ctx,text:'y',roomId:'200'},db),false);
  assert.equal(called(),0,'another person/room cannot approve');
  await Promise.all([
   restarted.handle({...ctx,text:'y',msg:{message:{type:1}}},db),
   restarted.handle({...ctx,text:'y',msg:{message:{type:1}}},db)
  ]);
  assert.equal(called(),1,'duplicate y does not duplicate the kick');
  assert.equal((await db.query('SELECT state FROM gl_leave_replies')).rows[0].state,'done');
  assert.match(replies.at(-1),/강퇴했습니다|이미 처리된/);
  await feature.handle({...ctx,text:'p'},db);
  assert.equal(called(),1);
  assert.match(replies.at(-1),/이미 강퇴 요청을 완료한/);
 }finally{await storage.close();}
});

test('n cancels and 60-second expiry refuses y without a kick',async()=>{
 const {storage,db,ctx,replies,called}=await setupLeaveFixture();
 try{
  await feature.handle(ctx,db);
  await feature.handle({...ctx,text:'n',msg:{message:{type:1}}},db);
  assert.equal(called(),0);
  assert.match(replies.at(-1),/취소했습니다/);
  assert.equal(await feature.handle({...ctx,text:'y'},db),false,'after n there is no pending approval');
  await feature.handle({...ctx,text:'p'},db);
  await db.query("UPDATE gl_leave_ban_confirmations SET expires_at=NOW()-INTERVAL '1 second'");
  await feature.handle({...ctx,text:'y'},db);
  assert.equal(called(),0);
  assert.match(replies.at(-1),/확인 시간이 만료/);
  assert.equal((await db.query('SELECT state FROM gl_leave_replies')).rows[0].state,'pending');
 }finally{await storage.close();}
});

test('role is rechecked on y; declined permissions cannot execute a pending kick',async()=>{
 const {storage,db,ctx,replies,called}=await setupLeaveFixture();
 try{
  await feature.handle(ctx,db);
  await feature.handle({...ctx,text:'y',senderType:2},db);
  assert.equal(called(),0);
  assert.match(replies.at(-1),/강퇴 확인 권한이 없습니다/);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM gl_leave_ban_confirmations')).rows[0].count,1);
  await db.query("INSERT INTO gl_manage_admins(room_id,user_id) VALUES('100','7777')");
  await feature.handle({...ctx,text:'y',senderType:2},db);
  assert.equal(called(),1,'verified delegated admin can approve');
 }finally{await storage.close();}
});

test('failed kick resets state; user must explicitly re-confirm on retry',async()=>{
 const {storage,db,ctx,replies,called}=await setupLeaveFixture();
 try{
  await feature.handle(ctx,db);
  await feature.handle({...ctx,text:'y',kick:async()=>{throw Error('server refused')}},db);
  assert.equal(called(),0);
  assert.match(replies.at(-1),/server refused/);
  assert.equal((await db.query('SELECT state FROM gl_leave_replies')).rows[0].state,'pending');
  assert.equal(await feature.handle({...ctx,text:'y'},db),false,'approval is single-use after failure');
  await feature.handle(ctx,db);
  await feature.handle({...ctx,text:'y'},db);
  assert.equal(called(),1,'second k + y may retry');
  assert.equal((await db.query('SELECT state FROM gl_leave_replies')).rows[0].state,'done');
 }finally{await storage.close();}
});

require('ts-node/register/transpile-only');
const {KakaoForgeClient}=require('../src/client/client');
function profileClient(){
 const c=Object.create(KakaoForgeClient.prototype);
 Object.assign(c,{_memberProfileLinkIds:new Map(),_memberNames:new Map(),_memberTypes:new Map(),_chatRooms:new Map(),_resolveChatId:x=>x,_touchMemberCache:()=>{}});
 return c;
}
test('profile lookup uses only matching member pli and matching INFOLINK URL',async()=>{
 const c=profileClient(),requests=[];
 c._cacheMembers('100',[{userId:target,nickName:'테스트',pli:'12345',mt:2}]);
 c._carriage={member:async()=>{throw Error('departed member unavailable')},infoLink:async ids=>{requests.push(ids);return {status:0,body:{ols:[{li:'12345',lu:'https://open.kakao.com/o/example'}]}};}};
 assert.equal(await c.getUserOpenProfileLink('100',target),'https://open.kakao.com/o/example');
 assert.deepEqual(requests,[['12345']]);
 for(const profile of [{li:'54321',lu:'https://open.kakao.com/o/other'},{li:'12345',lu:'https://example.com/o/fake'}]){
  c._carriage.infoLink=async()=>({status:0,body:{ols:[profile]}});
  assert.equal(await c.getUserOpenProfileLink('100',target),'');
 }
 c._cacheMembers('100',[{userId:target,pli:0,mt:2}]);assert.equal(c._memberProfileLinkIds.size,0);
 c._carriage.member=async()=>({body:{members:[{userId:'8888',pli:'12345'}]}});
 assert.equal(await c.getUserOpenProfileLink('100',target),'');
});
