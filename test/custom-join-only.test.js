'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const session=require('../shared/session');

async function emit(type,template,{warningDb,roomId='777777',userId='1234567890123456789'}={}){
 const sent=[],handlers={};
 const queries=[];
 const ctx={
  id:v=>String(v??''),initDb:async()=>{},
  pool:{query:async(sql,args)=>{
   queries.push({sql,args});
   if(warningDb&&sql.includes('FROM gl_manage_warnings'))return warningDb.query(sql,args);
   if(sql.includes('SELECT join_count,leave_count,open_profile_link,last_profile_url'))
    return {rows:[{join_count:3,leave_count:type==='leave'?2:1,open_profile_link:null,last_profile_url:null}]};
   if(sql.includes('COUNT(*)::integer AS count FROM hz_events'))return {rows:[{count:0}]};
   if(sql.includes('COUNT(*)::integer AS n FROM gl_manage_warnings'))return {rows:[{n:2}]};
   if(sql.includes('SELECT created_at FROM hz_events'))return {rows:[]};
   return {rows:[],rowCount:1};
  }},
  promoTick:async()=>{},autoFishTick:async()=>{},quizExpiryTick:async()=>{},
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
  await handlers[type]({room:{id:roomId,name:'발로란트 학교'},
    member:{ids:[userId],names:['ㅇㅡㅇ']}});
 }finally{
  clearInterval(ctx.promoTimer);
  clearInterval(ctx.autoFishTimer);
  clearInterval(ctx.quizExpiryTimer);
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

test('entry warning reasons use active records for this room and member, including reason-only templates',async()=>{
 const {PGlite}=require('@electric-sql/pglite'),db=new PGlite();
 const uid='1234567890123456789',options={warningDb:db};
 try{
  await db.exec(`CREATE TABLE gl_manage_warnings(id BIGSERIAL PRIMARY KEY,room_id TEXT,user_id TEXT,reason TEXT,removed BOOLEAN DEFAULT FALSE)`);
  const output=async(template='(경고횟수)개\n(경고사유)',opts=options)=>(await emit('join',template,opts)).sent[0];
  assert.equal(await output(),'0개\n없음');
  await db.query('INSERT INTO gl_manage_warnings(room_id,user_id,reason,removed) VALUES ($1,$2,$3,$4),($1,$2,$5,FALSE),($1,$2,$5,FALSE)',
   ['777777',uid,'삭제된 사유',true,'도배']);
  await db.query('INSERT INTO gl_manage_warnings(room_id,user_id,reason) VALUES ($1,$2,$3),($4,$2,$5),($1,$6,$5)',
   ['777777',uid,'욕설 (이름)','다른방','유출되면 안 됨','다른회원']);
  assert.equal(await output(),'3개\n욕설 (이름)\n도배\n도배');
  assert.equal(await output('(경고사유)'),'욕설 (이름)\n도배\n도배');
  assert.equal(await output('(경고횟수)/(경고사유)',{warningDb:db,roomId:'빈방'}),'0/없음');
  await db.query('UPDATE gl_manage_warnings SET removed=TRUE WHERE id=(SELECT MAX(id) FROM gl_manage_warnings WHERE room_id=$1 AND user_id=$2)',['777777',uid]);
  assert.equal(await output(),'2개\n도배\n도배');
  await db.query('UPDATE gl_manage_warnings SET removed=TRUE WHERE room_id=$1 AND user_id=$2',['777777',uid]);
  assert.equal(await output(),'0개\n없음');
  const {queries}=await emit('join','(경고사유)',options);
  assert.equal(queries.filter(q=>q.sql.includes('FROM gl_manage_warnings')).length,1);
  const plain=await emit('join','(이름)님 환영합니다',options);
  assert.ok(!plain.queries.some(q=>q.sql.includes('FROM gl_manage_warnings')));
 }finally{await db.close();}
});
