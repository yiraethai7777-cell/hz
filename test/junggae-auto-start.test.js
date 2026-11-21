'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseArgs,createWatcher}=require('../junggae-auto-start');
const ROOM='18496234145974738', OTHER='18357439193628181';
const payload=(room=ROOM,log='501',sender='999999999',text='@A @B 준개 신청',role=2)=>{
 const mentions=[
  {user_id:'11111111',at:[1],len:1},
  {user_id:'22222222',at:[2],len:1}
 ];
 return {room:{id:room,isOpenChat:true},sender:{id:sender,type:role},
  message:{logId:log,text},attachmentsRaw:[JSON.stringify({mentions})]};
};
test('must specify one or more explicitly authorized rooms',()=>{
 assert.throws(()=>parseArgs([]),/방을 반드시 지정/);
 assert.throws(()=>parseArgs(['--room','abc']),/올바르지/);
 assert.throws(()=>parseArgs(['--room',ROOM,'--room','abc']),/올바르지/);
 const args=parseArgs(['--room',ROOM,'--rooms',ROOM+','+OTHER,'--dry-run']);
 assert.deepEqual([...args.rooms],[ROOM,OTHER]);
 assert.equal(args.dryRun,true);
});
test('sends opening message only into the configured room that received the request',async()=>{
 const sent=[];
 const watch=createWatcher({rooms:new Set([ROOM]),client:{userId:'123456789'},
  message:'준개시작 멘트',send:async (_chat,room,message)=>{
   sent.push({room,message});return {status:0};
  }});
 assert.equal(await watch({},payload(OTHER)),false);
 assert.equal(await watch({},payload(ROOM)),true);
 assert.deepEqual(sent,[{room:ROOM,message:'준개시작 멘트'}]);
});
test('existing rule blocks fake mentions, non-requests and submanager requests',async()=>{
 const sent=[];
 const watch=createWatcher({rooms:new Set([ROOM]),client:{userId:'123456789'},
  message:'준개 시작',send:async (_c,room,text)=>{sent.push({room,text});return {status:0}}});
 const sample=[
  payload(ROOM,'1','999999999','준개 신청'),
  payload(ROOM,'2','999999999','@A @B'),
  payload(ROOM,'3','999999999','@A @B 템맡'),
  payload(ROOM,'4','999999999','@A @B 준개 신청',4),
  payload(ROOM,'5','123456789','@A @B 준개 신청',2)
 ];
 for(const msg of sample)assert.equal(await watch({},msg),false);
 assert.equal(sent.length,0);
});
test('does not send duplicate responses for replayed message events',async()=>{
 let sends=0,time=1000;
 const watch=createWatcher({rooms:new Set([ROOM]),client:{userId:'123456789'},
  message:'준개 시작',now:()=>time,send:async()=>{sends++;return {status:0}}});
 assert.equal(await watch({},payload(ROOM,'10')),true);
 assert.equal(await watch({},payload(ROOM,'10')),false);
 assert.equal(sends,1);
 assert.equal(await watch({},payload(ROOM,'11')),true);
 assert.equal(sends,2);
 time+=120001;
 assert.equal(await watch({},payload(ROOM,'10')),true);
 assert.equal(sends,3);
});
test('dry run logs matches but never sends a KakaoTalk message',async()=>{
 let sends=0;const events=[];
 const watch=createWatcher({rooms:new Set([ROOM]),client:{userId:'123456789'},
  dryRun:true,message:'준개 시작',send:async()=>{sends++},
  onEvent:(type,detail)=>events.push({type,detail})});
 assert.equal(await watch({},payload()),true);
 assert.equal(sends,0);
 assert(events.some(e=>e.type==='dry-run'));
});
test('failed sends can retry but rejected status is not mistaken for success',async()=>{
 let sends=0;const events=[];
 const watch=createWatcher({rooms:new Set([ROOM]),client:{userId:'123456789'},
  message:'준개 시작',send:async()=>{
   sends++;return {status:sends===1?500:0};
  },onEvent:(type,detail)=>events.push({type,detail})});
 assert.equal(await watch({},payload()),false);
 assert.equal(await watch({},payload()),true);
 assert.equal(sends,2);
 assert(events.some(e=>e.type==='error'));
});
test('unknown sender role is validated before applying the original matcher',async()=>{
 let sends=0;
 const client={userId:'123456789',
  _ensureMemberType:async(room,user)=>{assert.equal(room,ROOM);assert.equal(user,'999999999')},
  _resolveMemberType:()=>2};
 const watch=createWatcher({rooms:new Set([ROOM]),client,
  message:'준개 시작',send:async()=>{sends++;return {status:0}}});
 assert.equal(await watch({},payload(ROOM,'50','999999999','@A @B 준개 신청',0)),true);
 assert.equal(sends,1);
});
