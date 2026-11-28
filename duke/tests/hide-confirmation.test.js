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
