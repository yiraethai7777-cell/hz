'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHangupDriver}=require('../shared/vox30-hangup-driver');
const ver='26.9.2';
const evidence={reviewed:true,recordedHangUp:true,appVer:ver,requestMethod:12001,replyMethod:12002};
const builder=({callId})=>({callId});
test('no packet can be sent without version-matched observed contract',()=>{
 for(const contract of [null,{...evidence,recordedHangUp:false},
  {...evidence,appVer:'26.3.1'},{...evidence,requestMethod:11009},
  {...evidence,requestMethod:0}])
  assert.throws(()=>createHangupDriver({appVer:ver,contract,buildBody:builder}));
});
test('a reviewed contract uses authenticated request/response, not event 11009',async()=>{
 const sent=[];
 const driver=createHangupDriver({appVer:ver,contract:evidence,buildBody:builder});
 const result=await driver.hangUp({roomId:'101',callId:'202',csId:'303',
  actorUserId:'404',connection:{async request(method,body,replyMethod){
   sent.push({method,body,replyMethod});return {resCode:0};
  }}});
 assert.deepEqual(sent,[{method:12001,replyMethod:12002,body:{callId:'202'}}]);
 assert.deepEqual(result,{requestAccepted:true,serverEnded:false});
});
test('failed request must not be reported as hangup success',async()=>{
 const driver=createHangupDriver({appVer:ver,contract:evidence,buildBody:builder});
 await assert.rejects(driver.hangUp({roomId:'101',callId:'202',actorUserId:'404',
  connection:{async request(){throw Error('rejected')}}}),/rejected/);
});
test('invalid IDs and malformed BSON prevent wire calls',async()=>{
 let called=false;
 const driver=createHangupDriver({appVer:ver,contract:evidence,buildBody:()=>null});
 await assert.rejects(driver.hangUp({roomId:'101',callId:'202',actorUserId:'404',
  connection:{async request(){called=true;return {}}}}),/BSON/);
 assert.equal(called,false);
 await assert.rejects(driver.hangUp({roomId:'not-numeric',callId:'202',actorUserId:'404',
  connection:{async request(){called=true;return {}}}}),/ID/);
 assert.equal(called,false);
});
