'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const lossless=require('lossless-json');
const {buildSpamChatLogInfo}=require('../../dist/utils/parsing');
const {applyOpenChatMixin}=require('../../dist/client/openchat-mixin');
const log='9007199254740993010',user='9007199254740993011';
const raw=()=>({authorId:new lossless.LosslessNumber(user),logId:new lossless.LosslessNumber(log),type:1,message:'test',sendAt:1710000000,attachment:'{"quotedLogId":9007199254740993012}'});
test('BLIND serializes exact target and embedded attachment IDs',()=>{
 const v=lossless.parse(buildSpamChatLogInfo(raw()))[0];
 assert.equal(String(v.u),user);
 assert.equal(String(v.l),log);
 assert.equal(String(v.m.attachment.quotedLogId),'9007199254740993012');
 assert.equal(buildSpamChatLogInfo({...raw(),logId:Number(log)}),null);
});
function fixture(fetched){
 class Fake{
  constructor(){this._chatRooms=new Map([['1',{isOpenChat:true,openLinkId:'2'}]]);this._carriage={blind:async args=>{this.sent=args;return {status:0}}};}
  _resolveChatId(x){return x}
  async fetchMessage(){return fetched}
 }
 applyOpenChatMixin(Fake);return new Fake();
}
const target={room:{id:'1',isOpenChat:true},raw:{chatLog:{authorId:user,logId:log,type:1}},message:{logId:log}};
const fetched={room:{id:'1',isOpenChat:true,openLinkId:'2'},raw:{chatLog:raw()},message:{logId:log}};
test('BLIND fallback fills missing chatLogInfo without overwriting fetched values',async()=>{
 const c=fixture(fetched);await c.openChatBlind('1',target,{report:false});
 assert.equal(String(lossless.parse(c.sent.chatLogInfo)[0].l),log);
 assert.equal(String(c.sent.memberId),user);
 assert.equal(c.sent.report,false);
});
test('BLIND fallback rejects a fetched message from another room or author',async()=>{
 for(const bad of [{...fetched,room:{...fetched.room,id:'3'}},{...fetched,raw:{chatLog:{...raw(),authorId:'31'}}}]){
  const c=fixture(bad);await assert.rejects(()=>c.openChatBlind('1',target,{report:false}),/chatLogInfo/);
  assert.equal(c.sent,undefined);
 }
});
