'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {applyOpenChatMixin}=require('../../dist/client/openchat-mixin');
const {CarriageClient}=require('../../dist/net/carriage-client');
const {createHideConfirmation}=require('../manage/hide-confirmation');
const log='9007199254740993010';
test('REWRITE sends exact message and room identifiers, not BLIND',async()=>{
 let sent;
 const result=await CarriageClient.prototype.hideChat.call({request:async(method,body)=>{sent={method,body};return {status:0};}},{linkId:'2',chatId:'1',logId:log,type:1});
 assert.equal(sent.method,'REWRITE');
 assert.equal(String(sent.body.logId),log);
 assert.equal(String(sent.body.li),'2');
 assert.equal(String(sent.body.c),'1');
 assert.equal(sent.body.t,1);
 assert.equal(result.status,0);
});
test('openChatHide requires exact open chat target and uses REWRITE only',async()=>{
 const sent=[];
 class Fake{
  constructor(){this._chatRooms=new Map([['1',{isOpenChat:true,openLinkId:'2'}]]);this._carriage={hideChat:async args=>{sent.push(args);return {status:0};}};}
  _resolveChatId(v){return v}
 }
 applyOpenChatMixin(Fake);
 const c=new Fake(),msg={room:{id:'1',isOpenChat:true,openLinkId:'2'},message:{logId:log,type:1}};
 await c.openChatHide('1',msg);
 assert.equal(String(sent[0].logId),log);
 assert.equal(sent[0].type,1);
 await assert.rejects(()=>c.openChatHide('1',{...msg,room:{...msg.room,id:'3'}}));
 await assert.rejects(()=>c.openChatHide('1',{...msg,room:{...msg.room,openLinkId:'3'}}));
 assert.equal(sent.length,1);
});
test('system rewrite feed 13 confirms exact target; ordinary user JSON does not',async()=>{
 let c;
 const msg={room:{id:'1'},message:{logId:log,type:1}};
 const feed=(type,feedType,logId=log)=>({method:'SYNCREWR',body:{chatLog:{chatId:'1',type,logId:'999',message:JSON.stringify({feedType,logId})}}});
 c=createHideConfirmation({timeoutMs:20,request:async()=>{
  assert.equal(c.observePush(feed(1,13)),false);
  assert.equal(c.observePush(feed(0,25)),false);
  assert.equal(c.observePush(feed(0,13,'998')),false);
  assert.equal(c.observePush(feed(0,13)),true);
  return {status:0};
 }});
 assert.deepEqual(await c.hide('1',msg),{status:0,verified:true});
});
