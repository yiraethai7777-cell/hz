'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const session=require('../shared/session');

async function emit(type,template){
 const sent=[],handlers={};
 const queries=[];
 const ctx={
  id:v=>String(v??''),initDb:async()=>{},
  pool:{query:async(sql,args)=>{
   queries.push({sql,args});
   if(sql.includes('SELECT join_count,leave_count,open_profile_link,last_profile_url'))
    return {rows:[{join_count:3,leave_count:type==='leave'?2:1,open_profile_link:null,last_profile_url:null}]};
   if(sql.includes('COUNT(*)::integer AS count FROM hz_events'))return {rows:[{count:0}]};
   if(sql.includes('COUNT(*)::integer AS n FROM gl_manage_warnings'))return {rows:[{n:2}]};
   if(sql.includes('SELECT created_at FROM hz_events'))return {rows:[]};
   return {rows:[],rowCount:1};
  }},
  promoTick:async()=>{},autoFishTick:async()=>{},
  roomFlags:async()=>({manage:true,locked:false,name:'발로란트 학교',
   joinTemplate:type==='join'?template:null,
   leaveTemplate:type==='leave'?template:null}),
  validOpenProfileLink:()=>'',saveOpenProfileLink:async()=>{},
  extractProfile:()=>null,
  send:async(_chat,_room,text)=>{sent.push(text);return [{body:{logId:'123456'}}]},
  pendingManualKicks:new Map(),kickBurst:new Map(),
  isSubManagerType:()=>false
 };
 const client={
  userId:'999999',
  chat:{mention:(id,name)=>'\u0002'+id+'\u0003'+name+'\u0004'},
  onMessage:fn=>handlers.message=fn,
  onJoin:fn=>handlers.join=fn,
  onLeave:fn=>handlers.leave=fn,
  onKick:fn=>handlers.kick=fn
 };
 await session(ctx).attachHZBot(client);
 try{
  await handlers[type]({room:{id:'777777',name:'발로란트 학교'},
    member:{ids:['1234567890123456789'],names:['ㅇㅡㅇ']}});
 }finally{
  clearInterval(ctx.promoTimer);
  clearInterval(ctx.autoFishTimer);
 }
 return {sent,queries};
}
test('custom entry notice replaces rather than appends default profile card',async()=>{
 const template='📌 입장 안내\n👤 (이름)님 어서오세요!\n(멘션)님 환영합니다!\n🆔 (아이디)\n입장 (입장횟수)회 퇴장 (퇴장횟수)회 경고 (경고횟수)개';
 const {sent,queries}=await emit('join',template);
 assert.equal(sent.length,1);
 assert.ok(sent[0].startsWith('📌 입장 안내'));
 assert.ok(sent[0].includes('입장 3회 퇴장 1회 경고 2개'));
 assert.ok(sent[0].includes('\u00021234567890123456789\u0003ㅇㅡㅇ\u0004'));
 assert.ok(!sent[0].includes('회원 프로필'));
 assert.ok(!sent[0].includes('💬 '));
 assert.ok(queries.some(x=>x.sql.includes('gl_manage_warnings')));
});
test('default entry notice remains when custom entry setting is unset',async()=>{
 const {sent}=await emit('join',null);
 assert.equal(sent.length,1);
 assert.ok(sent[0].includes('회원 프로필'));
 assert.ok(sent[0].includes('누적 입장'));
});
test('custom exit notice also replaces rather than appends default card',async()=>{
 const {sent}=await emit('leave','👋 (이름)님 퇴장 (퇴장횟수)회');
 assert.equal(sent.length,1);
 assert.equal(sent[0],'👋 ㅇㅡㅇ님 퇴장 2회');
});
