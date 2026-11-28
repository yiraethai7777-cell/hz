'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspectHideReadback}=require('../manage/hide-readback');
const {createHideConfirmation}=require('../manage/hide-confirmation');
const room='123',log='9007199254740993010',author='456';
const msg={room:{id:room,isOpenChat:true},sender:{id:author},message:{logId:log,type:1}};
const response=(fields={})=>({status:0,body:{status:0,chatLogs:[{logId:log,chatId:room,authorId:author,type:1,...fields}]}});
test('GETMSGS explicit hidden metadata is verified for exact target only',()=>{
 assert.equal(inspectHideReadback(response({hidden:true}),room,log,author).state,'hidden');
 assert.equal(inspectHideReadback(response({hidden:false}),room,log,author).state,'visible');
 assert.equal(inspectHideReadback(response({hidden:true,chatId:'999'}),room,log,author).state,'mismatch');
 assert.equal(inspectHideReadback(response({hidden:true,authorId:'999'}),room,log,author).state,'mismatch');
 assert.equal(inspectHideReadback(response({hidden:true,logId:'999'}),room,log,author).state,'missing');
});
test('missing metadata or user JSON cannot prove hiding',()=>{
 assert.equal(inspectHideReadback(response({message:'{"hidden":true}',attachment:'{"hidden":true}'}),room,log,author).state,'unknown');
 assert.equal(inspectHideReadback(response({hidden:true,isHidden:false}),room,log,author).state,'ambiguous');
 assert.equal(inspectHideReadback({status:0,body:{status:-500}},room,log,author).state,'unavailable');
 assert.equal(inspectHideReadback({status:0,body:{chatLogs:[]}},room,log,author).state,'missing');
});
test('successful ACK without push uses readback but unknown is not success',async()=>{
 for(const state of ['hidden','visible','unknown','missing']){
  const c=createHideConfirmation({request:async()=>({status:0}),timeoutMs:5,readback:async(r,l,u,t)=>{assert.deepEqual([r,l,u,t],[room,log,author,1]);return {state};}});
  assert.deepEqual(await c.hide(room,msg),{status:0,verified:state==='hidden'});
 }
});
test('rejected request cannot become success through readback',async()=>{
 const c=createHideConfirmation({request:async()=>({status:0,body:{status:-500}}),readback:async()=>{assert.fail('must not read back rejected request');}});
 assert.deepEqual(await c.hide(room,msg),{status:-1,verified:false});
});
test('manual hide metadata sampled once and no unrelated target queried',async()=>{
 const calls=[];
 const c=createHideConfirmation({request:async()=>({status:0}),readback:async(...args)=>{calls.push(args);return {state:'unknown'};}});
 c.observePush({method:'SYNCMODMSG',body:{chatId:room,chatLog:{message:'{"hidden":true,"logId":'+log+'}'}}});
 c.observePush({method:'SYNCMODMSG',body:{chatId:room,chatLog:{message:'{"hidden":true,"logId":999}'}}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,[[room,log,undefined,undefined]]);
});

test('live REWRITE hidden type offset requires matching original type, author and room',()=>{
 assert.equal(inspectHideReadback(response({type:16385}),room,log,author,1).state,'hidden');
 assert.equal(inspectHideReadback(response({type:16386}),room,log,author,2).state,'hidden');
 assert.equal(inspectHideReadback(response({type:16385}),room,log,author,2).state,'unknown');
 assert.equal(inspectHideReadback(response({type:16385}),room,log,author).state,'unknown');
 assert.equal(inspectHideReadback(response({type:16385,authorId:undefined}),room,log,author,1).state,'unknown');
 assert.equal(inspectHideReadback(response({type:16385,chatId:'999'}),room,log,author,1).state,'mismatch');
 assert.equal(inspectHideReadback(response({type:16385,hidden:false}),room,log,author,1).state,'ambiguous');
});
test('REWRITE readback confirms immediately without waiting for a push',async()=>{
 let reads=0;
 const c=createHideConfirmation({request:async()=>({status:0,body:{status:0}}),timeoutMs:8000,readback:async(r,l,u,t)=>{reads++;return inspectHideReadback(response({type:16385}),r,l,u,t);}});
 assert.deepEqual(await c.hide(room,msg),{status:0,verified:true});
 assert.equal(reads,1);
});
