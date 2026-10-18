'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const feature=require('../manage/leave-reply');
const target='9007199254740993123',log='9007199254740993456';
const msg=(author='9999',id=log)=>({message:{type:26},attachmentsRaw:[`{"src_userId":${author},"src_logId":${id}}`]});

test('leave notice folds details and shows profile URL without changing exact IDs',()=>{
 const out=feature.leaveNotice({name:'테스트',userId:target,joins:3,leaves:2,time:'오늘',profileLink:'https://open.kakao.com/o/example'});
 assert.equal(out.split('\u200b')[0],'👋 테스트님이 나갔습니다.\n');
 assert.match(out,/\u200b{1200}/);assert.match(out,new RegExp(target));
 assert.match(out,/입장 3회 · 퇴장 2회/);assert.match(out,/https:\/\/open.kakao.com\/o\/example/);
 assert.match(feature.leaveNotice({name:'A'}),/확인된 오픈프로필 링크 없음/);
 assert.equal(feature.replyReference(msg(),'9999'),log);
 assert.equal(feature.replyReference(msg('8888'),'9999'),null);
 assert.equal(feature.replyReference({message:{type:1},attachmentsRaw:msg().attachmentsRaw},'9999'),null);
 for(const field of ['threadId','tid','thread']){
  assert.equal(feature.replyReference({message:{type:1},raw:{chatLog:{[field]:log}}},'9999'),log);
 }
 assert.equal(feature.replyReference({message:{type:1},text:'a'},'9999'),null);
});

test('reply ban survives restart, enforces room and role, retries errors and claims each notice once',async()=>{
 const storage=new PGlite();const db={query:async(sql,params)=>storage.query(sql,params)};
 try{
  await feature.init(db);await feature.init(db);
  await feature.record(db,{roomId:'100',botId:'9999',userId:target,name:'테스트',result:[{body:{logId:log}}]});
  let calls=0;const replies=[];
  const context={roomId:'100',botId:'9999',userId:'7777',senderType:1,text:'a',msg:msg(),send:async s=>replies.push(s),kick:async id=>{assert.equal(id,target);calls++;}};
  assert.equal(await feature.handle({...context,text:'hello'},db),false);
  assert.equal(await feature.handle({...context,msg:{message:{type:1}}},db),false);
  assert.equal(await feature.handle({...context,roomId:'200'},db),false);
  assert.equal(await feature.handle({...context,msg:msg('8888')},db),false);
  await feature.handle({...context,senderType:2},db);assert.equal(calls,0);
  await feature.handle({...context,kick:async()=>{throw Error('server refused')}},db);
  assert.match(replies.at(-1),/server refused/);
  const restarted=require('../manage/leave-reply');
  const comment={message:{type:1},raw:{chatLog:{threadId:log}}};
  assert.equal(await restarted.handle({...context,msg:comment,roomId:'200'},db),false);
  await Promise.all([restarted.handle({...context,senderType:4,msg:comment},db),restarted.handle(context,db)]);
  assert.equal(calls,1);
  await restarted.handle(context,db);assert.equal(calls,1);assert.match(replies.at(-1),/이미 벤 요청/);
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
