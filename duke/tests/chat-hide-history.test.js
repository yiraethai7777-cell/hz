'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {previousChats}=require('../manage/chat-hide-history');
const {createChatHide}=require('../manage/chat-hide');
const {createCore}=require('../core');
const base=90071992547409930n;
const log=(n,type=1,room='1')=>({logId:String(base+BigInt(n)),authorId:'40',chatId:room,type,message:'message '+n});
function mock(pages){const calls=[];const client={_carriage:{syncMsg:async args=>{calls.push(args);return {status:0,body:{chatLogs:pages.shift()??[]}};}}};return {client,calls};}
test('server history selects previous chat messages across pages, excluding command and later logs',async()=>{
 const {client,calls}=mock([[log(1),log(2),log(3)],[log(3),log(4,0),log(5),log(6),log(7)]]);
 const result=await previousChats(client,'1',log(6).logId,3);
 assert.deepEqual(result.map(x=>x.log),[log(5).logId,log(3).logId,log(2).logId]);
 assert.equal(calls[1].cur,log(3).logId);
 assert.equal(result[0].msg.raw.chatLog.logId,log(5).logId);
});
test('server history rejects missing anchor or another room',async()=>{
 for(const pages of [[[log(1),log(2)]],[[log(1,1,'2'),log(6)]]]){
  const {client}=mock(pages);
  await assert.rejects(previousChats(client,'1',log(6).logId,2));
 }
});
test('manual hide uses old server history after restart with no local cache',async()=>{
 const sent=[],hidden=[],{client}=mock([[log(1),log(2),log(3),log(4)]]);
 const core=createCore({send:async(r,t)=>sent.push(t)});
 const mod=createChatHide({canManage:()=>true,loadHistory:(r,a,n)=>previousChats(client,r,a,n),hide:async(r,m)=>{hidden.push(m.message.logId);return {status:0};}});
 mod.register(core);
 await core.handle({roomId:'1',userId:'10',text:'-가리기 3',msg:{room:{id:'1',isOpenChat:true},sender:{id:'10',type:1},message:{logId:log(4).logId,type:1}}});
 assert.match(sent[0],/가리기 : 3개/);
 assert.deepEqual(hidden,[log(3).logId,log(2).logId,log(1).logId]);
});

test('manual hide skips own bot and configured bot messages before counting five user messages',async()=>{
 const bot=(n,authorId)=>({...log(n),authorId});
 const {client}=mock([[log(1),log(2),bot(3,'10'),log(4),bot(5,'20'),log(6),bot(7,'10'),log(8),log(9),bot(10,'10')]]);
 client.userId='10';
 const sent=[],hidden=[],core=createCore({send:async(r,t)=>sent.push(t)});
 const mod=createChatHide({canManage:()=>true,botId:()=>client.userId,otherBotIds:['20'],loadHistory:(r,a,n,options)=>previousChats(client,r,a,n,options),hide:async(r,m)=>{hidden.push(m.message.logId);return {status:0};}});
 mod.register(core);
 await core.handle({roomId:'1',userId:'10',text:'-가리기 5',msg:{room:{id:'1',isOpenChat:true},sender:{id:'10',type:1},message:{logId:log(10).logId,type:1}}});
 assert.match(sent[0],/가리기 : 5개/);
 assert.deepEqual(hidden,[9,8,6,4,2].map(n=>log(n).logId));
});
