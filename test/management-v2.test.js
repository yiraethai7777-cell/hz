'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function fixture({image}={}){
 const state={enabled:true,admins:new Set(['2000']),deleteEnabled:false,spamEnabled:false,rows:[],
  actions:[],kicks:[],unbans:[],sent:[],sql:[],attenders:[],images:[],templates:[],warnings:[]};
 const db={
  async query(sql,v=[]){
   state.sql.push(String(sql));
   if(String(sql).includes('SELECT COALESCE((SELECT enabled'))return {rows:[{enabled:state.enabled}]};
   if(String(sql).includes('SELECT 1 FROM gl_manage_admins'))return {rowCount:state.admins.has(String(v[1]))?1:0,rows:[]};
   if(String(sql).includes('INSERT INTO gl_manage_rooms(room_id,enabled)')){state.enabled=v[1];return {rows:[],rowCount:1};}
   if(String(sql).includes('INSERT INTO gl_manage_rooms(room_id,enabled,deleted_enabled)')){state.deleteEnabled=v[1];return {rows:[],rowCount:1};}
   if(String(sql).includes('INSERT INTO gl_manage_rooms(room_id,enabled,spam_enabled)')){state.spamEnabled=true;return {rows:[],rowCount:1};}
   if(String(sql).includes('SELECT user_name,attended_at FROM hz_new_attendance'))return {rows:state.rows};
   if(String(sql).includes('INSERT INTO gl_manage_admins')){state.admins.add(String(v[1]));return {rowCount:1,rows:[]};}
   if(String(sql).includes('DELETE FROM gl_manage_admins')){state.admins.delete(String(v[1]));return {rowCount:1,rows:[]};}
   if(String(sql).includes('INSERT INTO gl_manage_actions')){state.actions.push(v);return {rowCount:1,rows:[]};}
   if(String(sql).includes('INSERT INTO gl_manage_warnings')){state.warnings.push(v);return {rowCount:1,rows:[]};}
   if(String(sql).includes('COUNT(*)::int AS n FROM gl_manage_warnings'))return {rows:[{n:state.warnings.length}]};
   if(String(sql).includes('SELECT id,reason,issuer_id,created_at FROM gl_manage_warnings'))return {rows:state.warnings.map((x,i)=>({id:i+1,reason:x[3],issuer_id:x[4],created_at:new Date()}))};
   if(String(sql).includes('SELECT created_at,action,actor_id,target_id FROM gl_manage_actions'))return {rows:[]};
   if(String(sql).includes('SELECT created_at,user_id AS target_id,meta FROM hz_events'))return {rows:[]};
   if(String(sql).includes('SELECT event_type,created_at FROM hz_events'))return {rows:[]};
   if(String(sql).includes("INSERT INTO hz_rooms(room_id,data) VALUES($1,jsonb_build_object($2")){state.templates.push(v);return {rows:[]};}
   return {rowCount:0,rows:[]};
  },
  async connect(){return {...this,release(){}};}
 };
 const m={exports:{}};
 const source=fs.readFileSync(path.join(__dirname,'../manage/commands-v2.js'),'utf8');
 const deps={
  '../shared/db':{getPool:()=>db},
  './attendance':{attend:async(room,user)=>{state.attenders.push(user);return {message:state.attenders.length===1?'✅ 출석 성공':'📌 이미 출석',isNew:state.attenders.length===1,date:'2026-10-24'};}},
  './attendance-image/automatic':{sendAttendanceImage:async(client,context)=>{state.images.push(context);return image?image(context):true;}},
  './chat-ranking-image/automatic':{sendRankingImage:async(db,ctx)=>{state.rankingImage=ctx;return true;}},
  './chat-ranking':{messages:async(db,room,all)=>[all?'전체 채팅 순위 20명':'채팅 순위 TOP 10']},
  './targets':{mentions:msg=>msg.mentions||[],reference:msg=>msg.replyId?{userId:msg.replyId}:null,resolve:async({msg})=>msg.replyId?{id:msg.replyId,name:'답장 대상'}:null},
  '../shared/help':{formatCommandHelp:()=>'📜 명령어 안내'},
  './spam':{reset(){}},
  './profile-alerts':{setEnabled:async(db,room,on)=>{state.profileSetting={room,on};}},
  './profile-history':{message:async()=> '👤 오픈프로필 기록'}
 };
 vm.runInNewContext(source,{module:m,exports:m.exports,require:n=>deps[n]||(()=>{throw Error('Unexpected import '+n)})(),
  console,process:{env:{}},Date,Intl,Set,Number,String,Object,RegExp,Promise},{filename:'manage/commands-v2.js'});
 const impl=m.exports;
 async function emit(text,{role=2,user='1000',self=false,mentions=[],replyId=null}={}){
  let sentStart=state.sent.length;
  const handled=await impl.handle({
   client:{},roomId:'1849',userId:user,userName:'Tester',text,
   send:async x=>state.sent.push(String(x)),kick:async id=>{state.kicks.push(id);},
   unban:async id=>{state.unbans.push(id);},isBotAccount:self,senderType:role,
   botId:'9999',msg:{room:{id:'1849',isOpenChat:true},sender:{id:user,type:role},mentions,replyId}
  });
  return {handled,sent:state.sent.slice(sentStart)};
 }
 return {state,emit,impl};
}
test('public commands work for a regular user',async()=>{
 const f=fixture();
 assert.match((await f.emit('!출석')).sent[0],/출석 성공/);
 assert.deepEqual((await f.emit('!채팅순위')).sent,[]);
 assert.equal(f.state.rankingImage.userName,'Tester');
 assert.match((await f.emit('!채팅순위전체')).sent[0],/전체 채팅 순위/);
});
test('attendance image auto-send is new-only and manual resend does not reward again',async()=>{
 const f=fixture();
 const first=await f.emit('!출석');
 assert.match(first.sent[0],/출석 성공/);
 await Promise.resolve();
 assert.equal(f.state.images.length,1);
 assert.equal(f.state.images[0].onDemand,false);
 assert.equal(f.state.images[0].attendanceDate,'2026-10-24');
 assert.equal(f.state.attenders.length,1);
 const duplicate=await f.emit('!출석');
 assert.match(duplicate.sent[0],/이미 출석/);
 await Promise.resolve();
 assert.equal(f.state.images.length,1,'duplicate must not upload an image');
 const manual=await f.emit('!출석이미지');
 assert.equal(manual.handled,true);
 await Promise.resolve();
 assert.equal(f.state.images.length,2);
 assert.equal(f.state.images[1].onDemand,true);
 assert.equal(f.state.attenders.length,2,'manual resend must not update attendance');
});

test('attendance ranking includes everyone and splits if needed',async()=>{
 const f=fixture();
 f.state.rows=Array.from({length:75},(_,i)=>({user_name:'참가자'+i,attended_at:new Date(2026,9,24,10,i%60)}));
 await f.emit('!출석순위');
 assert.match(f.state.sent.join('\n'),/참가자74/);
 assert.match(f.state.sent.join('\n'),/75\. 참가자74/);
 assert.ok(f.state.sent.length>1);
});
test('designated manager can issue staff commands, regular user cannot',async()=>{
 const f=fixture();
 assert.match((await f.emit('!경고내역 5555')).sent[0],/⛔/);
 assert.doesNotMatch((await f.emit('!경고내역 5555',{user:'2000'})).sent[0],/⛔/);
});
test('only bot administrator controls management and admin assignments',async()=>{
 const f=fixture();
 assert.match((await f.emit('!관리off',{role:1})).sent[0],/⛔/);
 assert.match((await f.emit('!관리off',{self:true})).sent[0],/중지/);
 assert.equal(f.state.enabled,false);
 assert.match((await f.emit('!출석')).sent[0],/중지/);
 assert.match((await f.emit('!관리on',{self:true})).sent[0],/작동/);
 assert.equal(f.state.enabled,true);
 assert.match((await f.emit('!관리자추가 5555',{role:1})).sent[0],/⛔/);
 await f.emit('!관리자추가 5555',{self:true});
 assert.ok(f.state.admins.has('5555'));
});
test('!kick, !k and !내풀 are restricted and recorded',async()=>{
 const f=fixture();
 assert.match((await f.emit('!kick 5555')).sent[0],/⛔/);
 await f.emit('!kick 5555',{role:1});
 await f.emit('!k 5556',{user:'2000'});
 await f.emit('!내풀 5557',{role:4});
 assert.deepEqual(f.state.kicks,['5555','5556','5557']);
 assert.deepEqual(f.state.unbans,['5557']);
 assert.deepEqual(f.state.actions.map(x=>x[3]),['KICK','KICK','KICK_RELEASE']);
});
test('delete and spam settings obey owner role',async()=>{
 const f=fixture();
 assert.match((await f.emit('!삭제감지on',{role:1})).sent[0],/⛔/);
 await f.emit('!삭제감지on',{self:true});assert.equal(f.state.deleteEnabled,true);
 await f.emit('!삭제감지off',{self:true});assert.equal(f.state.deleteEnabled,false);
 await f.emit('!도배감지on',{self:true});assert.equal(f.state.spamEnabled,true);
});
test('warning target works for mention and reply',async()=>{
 const f=fixture();
 await f.emit('!경고 @Test 2 도배',{role:1,mentions:[{id:'5555',name:'Test'}]});
 assert.equal(f.state.warnings.length,2);
 await f.emit('!경고 1 테스트',{role:1,replyId:'6666'});
 assert.equal(f.state.warnings.length,3);
});
test('greeting text reaches room config and retired # prefix is not recognized here',async()=>{
 const f=fixture();
 await f.emit('!입장변경 어서오세요',{role:4});
 assert.equal(f.state.templates[0][1],'joinTemplate');
 assert.equal(f.state.templates[0][2],'어서오세요');
 assert.equal((await f.emit('#관리작동',{self:true})).handled,false);
});

test('attendance completion text waits until the photo finishes uploading',async()=>{
 let release,started;const uploading=new Promise(r=>started=r);
 const f=fixture({image:async()=>{started();await new Promise(r=>release=r);}});
 const pending=f.emit('!출석');await uploading;
 assert.deepEqual(f.state.sent,[],'no completion text before photo confirmation');
 release();await pending;assert.match(f.state.sent[0],/출석 성공/);
});
test('photo failure still sends committed attendance completion without another reward',async()=>{
 const f=fixture({image:async()=>{throw Error('upload unavailable');}});
 assert.match((await f.emit('!출석')).sent[0],/출석 성공/);
 assert.match((await f.emit('!출석')).sent[0],/이미 출석/);
 assert.equal(f.state.images.length,1);
});


test('only bot administrators can persist room profile alert toggles',async()=>{
 const f=fixture();
 for(const role of [1,2,4]){
  assert.match((await f.emit('!프로필감지off',{role})).sent[0],/봇 관리자/);
  assert.equal(f.state.profileSetting,undefined);
 }
 assert.match((await f.emit('!프로필감지off',{self:true})).sent[0],/OFF/);
 assert.deepEqual(f.state.profileSetting,{room:'1849',on:false});
 assert.match((await f.emit('!프로필감지on',{self:true})).sent[0],/ON/);
 assert.deepEqual(f.state.profileSetting,{room:'1849',on:true});
});


test('!id shows self or selected target ID for submanagers only',async()=>{
 const f=fixture(),id='9007199254740993123';
 assert.equal((await f.emit('!id',{role:4,user:id})).sent[0],'🆔 내 아이디: '+id);
 for(const role of [1,2,8])assert.match((await f.emit('!id',{role})).sent[0],/부방장만/);
 assert.match((await f.emit('!id '+id,{role:4})).sent[0],new RegExp(id));
 assert.match((await f.emit('!id @대상',{role:4,mentions:[{id,name:'대상'}]})).sent[0],new RegExp(id));
 assert.match((await f.emit('!id',{role:4,replyId:id})).sent[0],new RegExp(id));
 assert.match((await f.emit('!id')).sent[0],/부방장만/);
 assert.match((await f.emit('!id',{self:true})).sent[0],/부방장만/);
 assert.match((await f.emit('!id',{user:'2000'})).sent[0],/부방장만/);
 assert.match((await f.emit('!id 대상',{role:4})).sent[0],/대상을 확인할 수 없습니다/);
 await f.emit('!관리off',{self:true});assert.match((await f.emit('!id',{role:4})).sent[0],/관리 기능 중지/);
 assert.ok(require('../shared/help').formatCommandHelp({manage:true},'관리').includes('!id'));
});
