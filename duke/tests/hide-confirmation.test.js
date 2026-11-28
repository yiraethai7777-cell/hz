'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHideConfirmation}=require('../manage/hide-confirmation');
const {createChatHide}=require('../manage/chat-hide');
const {createCore}=require('../core');
const msg={room:{id:'1',isOpenChat:true},sender:{id:'30'},message:{logId:'100',type:1}};
const event=(room='1',log='100',method='BLINDMSG',hidden=true)=>({type:'hide',room:{id:room,isOpenChat:true},message:{logId:log},hidden,raw:{method,body:{chatId:room}}});
test('acknowledgment alone does not prove a hide',async()=>{
 const c=createHideConfirmation({request:async()=>({status:0}),timeoutMs:10});
 assert.deepEqual(await c.hide('1',msg),{status:0,verified:false});
});
test('only matching room and message confirmation succeeds',async()=>{
 const c=createHideConfirmation({timeoutMs:100,request:async()=>{
  assert.equal(c.observe(event('2')),false);
  assert.equal(c.observe(event('1','101')),false);
  assert.equal(c.observe(event('1','100','BLINDMSG',false)),false);
  assert.equal(c.observe(event()),true);
  return {status:0};
 }});
 assert.deepEqual(await c.hide('1',msg),{status:0,verified:true});
});
test('server body rejection is not a confirmed hide',async()=>{
 const c=createHideConfirmation({request:async()=>({status:0,body:{status:-1}}),timeoutMs:10});
 assert.deepEqual(await c.hide('1',msg),{status:-1,verified:false});
});
test('unconfirmed hide is reported as unverified, not success',async()=>{
 const sent=[],core=createCore({send:async(r,t)=>sent.push(t)});
 const mod=createChatHide({canManage:()=>true,botId:()=> '10',hide:async()=>({status:0,verified:false})});
 mod.register(core);
 await mod.observe(msg,{roomId:'1',userId:'30',text:'test'});
 await core.handle({roomId:'1',userId:'10',text:'-가리기 1',msg:{room:{id:'1',isOpenChat:true},sender:{id:'10'},message:{logId:'101',type:1}}});
 assert.match(sent[0],/가리기 : 0개.*미확인 : 1개/);
});

test('raw hide completion can be verified before enriched event, including exact long IDs',async()=>{
 const exact='9007199254740993010';
 const target={...msg,message:{logId:exact,type:1}};
 const c=createHideConfirmation({timeoutMs:100,request:async()=>{
  assert.equal(c.observePush({method:'SYNCREWR',body:{chatId:'2',chatLog:{message:'{"hidden":true,"logId":9007199254740993010}'}}}),false);
  assert.equal(c.observePush({method:'SYNCREWR',body:{chatId:'1',chatLog:{message:'{"logId":9007199254740993010}'}}}),false);
  assert.equal(c.observePush({method:'SYNCREWR',body:{chatId:'1',chatLog:{message:'{"hidden":false,"logId":9007199254740993010}'}}}),false);
  assert.equal(c.observePush({method:'SYNCREWR',body:{chatId:'1',chatLog:{message:'{"hidden":true,"logId":9007199254740993010}'}}}),true);
  return {status:0};
 }});
 assert.deepEqual(await c.hide('1',target),{status:0,verified:true});
});

test('slow request does not consume the post-ack confirmation window',async()=>{
 const c=createHideConfirmation({timeoutMs:20,request:async()=>{
  await new Promise(resolve=>setTimeout(resolve,40));
  setImmediate(()=>c.observe(event()));
  return {status:0};
 }});
 assert.deepEqual(await c.hide('1',msg),{status:0,verified:true});
});
test('manual hide push logs shape only, not message or identifiers',()=>{
 const entries=[];
 const c=createHideConfirmation({request:async()=>({status:0}),logger:{info:(...args)=>entries.push(args)}});
 assert.equal(c.observePush({method:'SYNCREWR',body:{chatId:'123456789',chatLog:{message:'{"hidden":true,"logId":987654321,"text":"private text"}'}}}),false);
 assert.equal(entries.length,1);
 assert.equal(entries[0][0],'[DUKE HIDE PUSH]');
 assert.deepEqual(JSON.parse(entries[0][1]),{method:'SYNCREWR',explicit:true,hasTarget:true,hasRecords:false,matched:false});
 assert.doesNotMatch(JSON.stringify(entries),/123456789|987654321|private text/);
});
