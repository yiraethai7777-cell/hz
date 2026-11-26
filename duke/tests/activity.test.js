'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createActivity}=require('../manage/activity'),{tableFor}=require('../database');
test('activity: scoped chat dedup, join and rejoin, moderation counters, persistence',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-activity-')),keys=[];let a;
 try{
  const opts={dir,onPersist:k=>keys.push(k),botId:()=> '9000',now:()=>1234567890};
  a=createActivity(opts);
  const room={id:'1000',isOpenChat:true},event={room,members:[{id:'3000'}],message:{logId:'4000'}};
  a.member('join',event);a.member('join',event);a.member('leave',{...event,message:{logId:'4001'}});a.member('join',{...event,message:{logId:'4002'}});
  const msg={room,message:{logId:'5000',type:1}},e={roomId:'1000',userId:'3000'};
  a.chat(msg,e);a.chat(msg,e);a.chat({...msg,message:{logId:'5001',type:0}},e);a.chat({...msg,message:{logId:'5002',type:2}},e);
  a.moderation('1000','3000','kick');a.moderation('1000','3000','release');
  assert.deepEqual(a.get('1000','3000'),{lastJoin:1234567890,rejoins:1,chats:2,kicks:1,releases:1,presence:'in'});
  assert.equal(a.get('2000','3000').chats,0);a.close();a=createActivity(opts);assert.equal(a.get('1000','3000').chats,2);
  assert.equal(tableFor(keys[0]),'duke_activity');
 }finally{a?.close();fs.rmSync(dir,{recursive:true,force:true});}
});
