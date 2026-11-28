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

test('live user chats take priority over failing history and skip bot messages',async()=>{
 const sent=[],hidden=[],core=createCore({send:async(r,t)=>sent.push(t)});
 let attempts=0,now=1000;
 const mod=createChatHide({canManage:()=>true,botId:()=> '10',otherBotIds:['20'],now:()=>now,loadHistory:async()=>{attempts++;throw Error('history unavailable')},hide:async(r,m)=>{hidden.push(m.message.logId);return {status:0};}});
 mod.register(core);
 const event=(n,user,text)=>({roomId:'1',userId:user,text,msg:{room:{id:'1',isOpenChat:true},sender:{id:user,type:2},message:{logId:log(n).logId,type:1,text}}});
 for(const [n,user] of [[1,'40'],[2,'40'],[3,'10'],[4,'20']]){
  const e=event(n,user,'message');await mod.observe(e.msg,e);
 }
 now+=700000;
 const e=event(5,'10','-가리기 1');await mod.observe(e.msg,e);await core.handle(e);
 assert.equal(attempts,0);
 assert.deepEqual(hidden,[log(2).logId]);
 assert.match(sent[0],/가리기 : 1개/);
 mod.reset();
 await core.handle(event(6,'10','-가리기 1'));
 assert.equal(attempts,1);
 assert.match(sent.at(-1),/채팅 기록을 불러오지 못했습니다/);
});

test('manual hide restores bounded identifier-only index after restart and fetches exact target',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-hide-index-'));
 const sent=[],hidden=[],persist=[];
 const event=(n,user,text)=>({roomId:'1',userId:user,text,msg:{room:{id:'1',isOpenChat:true},sender:{id:user,type:2},message:{logId:log(n).logId,type:1,text}}});
 const make=()=>{const core=createCore({send:async(r,t)=>sent.push(t)});const mod=createChatHide({dir,onPersist:k=>persist.push(k),canManage:()=>true,botId:()=> '10',fetchMessage:async(r,l)=>{assert.equal(r,'1');assert.equal(l,log(2).logId);return event(2,'40','private text').msg;},loadHistory:async()=>{throw Error('unavailable')},hide:async(r,m)=>{hidden.push(m.message.logId);return {status:0}}});mod.register(core);return {core,mod};};
 try{
  const a=make();
  for(const [n,u] of [[1,'40'],[2,'40'],[3,'10']]){const e=event(n,u,'private text');await a.mod.observe(e.msg,e);}
  const data=JSON.parse(fs.readFileSync(path.join(dir,'hide-index','1.json'),'utf8'));
  assert.deepEqual(data.map(x=>x.log),[log(1).logId,log(2).logId]);
  assert(!JSON.stringify(data).includes('private text'));assert(persist.includes('hide-index/1.json'));
  const b=make();await b.core.handle(event(4,'10','-가리기 1'));
  assert.deepEqual(hidden,[log(2).logId]);assert.match(sent.at(-1),/가리기 : 1개/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
