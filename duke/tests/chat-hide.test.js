'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCore}=require('../core'),{createChatHide,hasLink}=require('../manage/chat-hide');
function fixture(dir){
 const sent=[],hidden=[],lookups=[],persist=[],admins=['30'],role=new Map([['40',2],['50',1],['60',4]]);let enabled=true;
 const core=createCore({send:async(r,t)=>sent.push(t)});
 const mod=createChatHide({dir,onPersist:k=>persist.push(k),isEnabled:()=>enabled,canManage:e=>['10','20','30','50','60'].includes(e.userId),botId:()=> '10',listAdmins:()=>admins,getRole:async(r,u)=>{lookups.push([r,u]);return role.get(u);},hide:async(r,msg)=>{hidden.push([r,msg.message.logId]);return {status:0};}});
 mod.register(core);
 const event=(roomId,userId,log,text,type=2)=>({roomId,userId,text,msg:{room:{id:roomId,isOpenChat:true},sender:{id:userId,type},message:{logId:log,type:1,text}}});
 const observe=async(...args)=>{const e=event(...args);return mod.observe(e.msg,e);};
 const cmd=async(...args)=>{const e=event(...args);await mod.observe(e.msg,e);await core.handle(e);return sent.at(-1);};
 return {sent,hidden,lookups,persist,mod,observe,cmd,disable:()=>{enabled=false}};
}
test('manual hide selects only N earlier messages in the same room with exact large log IDs',async()=>{
 const x=fixture();
 await x.observe('1','40','90071992547409930','a');
 await x.observe('1','40','90071992547409931','b');
 await x.observe('2','40','90071992547409932','other room');
 await x.observe('1','40','90071992547409934','later');
 assert.match(await x.cmd('1','20','90071992547409933','-가리기 2'),/가리기 : 2개/);
 assert.deepEqual(x.hidden,[['1','90071992547409931'],['1','90071992547409930']]);
 assert.match(await x.cmd('1','40','90071992547409935','-가리기 1'),/권한이 없습니다/);
 assert.match(await x.cmd('2','20','90071992547409936','-가리기 5'),/이전 채팅/);
 assert.equal(x.hidden.length,2);
});
test('room link filter is opt-in, ignores owners cohosts bot and designated admins, and checks live role',async()=>{
 const x=fixture();
 await x.observe('1','40','100','https://example.com');assert.equal(x.hidden.length,0);
 assert.match(await x.cmd('1','40','101','-홍금'),/권한이 없습니다/);
 assert.match(await x.cmd('1','30','102','-홍금'),/ON/);
 await x.observe('2','40','103','https://example.com');
 await x.observe('1','10','104','https://example.com');
 await x.observe('1','30','105','https://example.com');
 await x.observe('1','50','106','https://example.com',1);
 await x.observe('1','60','107','https://example.com',4);
 await x.observe('1','50','108','https://example.com',2);
 await x.observe('1','70','109','https://example.com',2);
 await x.observe('1','40','110','normal chat');
 await x.observe('1','40','111','https://example.com');
 await x.observe('1','40','111','https://example.com');
 assert.deepEqual(x.hidden,[['1','111']]);
 assert.match(await x.cmd('1','20','112','-홍금 off'),/OFF/);
 await x.observe('1','40','113','https://example.com');
 assert.equal(x.hidden.length,1);
 assert(hasLink('www.example.com/path'));assert(hasLink('discord.gg/test'));assert(!hasLink('normal chat'));
});
test('link setting survives recreation and stays room scoped',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-hide-'));
 try{const a=fixture(dir);await a.cmd('1','20','101','-홍금 on');assert(a.persist.includes('link-filter-settings.json'));assert(a.persist.includes('hide-index/1.json'));const b=fixture(dir);await b.observe('1','40','102','https://example.com');await b.observe('2','40','103','https://example.com');assert.deepEqual(b.hidden,[['1','102']]);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('reply hide uses exact original quoted message, not newer messages or thread root',async()=>{
 const sent=[],hidden=[],lookups=[],core=createCore({send:async(r,t)=>sent.push(t)});
 const original={room:{id:'1',isOpenChat:true},sender:{id:'4000',type:2},message:{logId:'9007199254740993010',type:26},attachmentsRaw:[{src_logId:'9007199254740993000',src_userId:'5000'}]};
 const mod=createChatHide({canManage:e=>e.userId==='1000',botId:()=> '1000',fetchMessage:async(r,l)=>{lookups.push([r,l]);return original;},hide:async(r,m)=>{hidden.push([r,m.message.logId]);return {status:0,verified:true};}});
 mod.register(core);
 const event={roomId:'1',userId:'1000',text:'-가리기',msg:{room:{id:'1',isOpenChat:true},sender:{id:'1000',type:1},message:{logId:'9007199254740993020',type:26},raw:{chatLog:{threadId:'9007199254740993000',attachment:'{"src_logId":9007199254740993010,"src_userId":4000}'}}}};
 await core.handle({...event,userId:'4000'});
 assert.match(sent.at(-1),/권한이 없습니다/);
 await core.handle(event);
 assert.match(sent.at(-1),/원본 메시지를 가렸습니다/);
 assert.deepEqual(lookups,[['1','9007199254740993010']]);
 assert.deepEqual(hidden,[['1','9007199254740993010']]);
});
test('reply hide rejects mismatched room or log and never hides command itself',async()=>{
 const sent=[],hidden=[],core=createCore({send:async(r,t)=>sent.push(t)});
 const mod=createChatHide({canManage:()=>true,fetchMessage:async()=>({room:{id:'2',isOpenChat:true},sender:{id:'4000'},message:{logId:'2000',type:1}}),hide:async(r,m)=>{hidden.push(m);return {status:0,verified:true};}});
 mod.register(core);
 const run=async log=>core.handle({roomId:'1',userId:'1000',text:'-가리기',msg:{room:{id:'1',isOpenChat:true},sender:{id:'1000'},message:{logId:'3000',type:26},attachmentsRaw:[{src_logId:log,src_userId:'4000'}]}});
 await run('2000');assert.match(sent.at(-1),/원본 메시지를 확인할 수 없습니다/);
 await run('3000');assert.match(sent.at(-1),/원본 메시지를 확인할 수 없습니다/);
 assert.equal(hidden.length,0);
});

test('batch hide uses at most two concurrent verified operations',async()=>{
 const sent=[],started=[],core=createCore({send:async(r,t)=>sent.push(t)});
 let running=0,peak=0;
 const mod=createChatHide({canManage:()=>true,botId:()=> '10',hide:async(r,m)=>{
  started.push(m.message.logId);running++;peak=Math.max(peak,running);
  await new Promise(resolve=>setImmediate(resolve));running--;
  return {status:0,verified:m.message.logId!=='102'};
 }});
 mod.register(core);
 for(let i=100;i<105;i++){
  const msg={room:{id:'1',isOpenChat:true},sender:{id:'40'},message:{logId:String(i),type:1}};
  await mod.observe(msg,{roomId:'1',userId:'40',text:'chat'});
 }
 await core.handle({roomId:'1',userId:'10',text:'-가리기 5',msg:{room:{id:'1',isOpenChat:true},sender:{id:'10'},message:{logId:'105',type:1}}});
 assert.equal(peak,2);
 assert.deepEqual(started,['104','103','102','101','100']);
 assert.match(sent.at(-1),/가리기 : 4개.*미확인 : 1개/);
});
test('queued batch stops dispatching if management is disabled',async()=>{
 const sent=[],started=[],core=createCore({send:async(r,t)=>sent.push(t)});
 let enabled=true;
 const mod=createChatHide({isEnabled:()=>enabled,canManage:()=>true,botId:()=> '10',hide:async(r,m)=>{
  started.push(m.message.logId);enabled=false;return {status:0,verified:true};
 }});
 mod.register(core);
 for(let i=100;i<104;i++){
  const msg={room:{id:'1',isOpenChat:true},sender:{id:'40'},message:{logId:String(i),type:1}};
  await mod.observe(msg,{roomId:'1',userId:'40',text:'chat'});
 }
 await core.handle({roomId:'1',userId:'10',text:'-가리기 4',msg:{room:{id:'1',isOpenChat:true},sender:{id:'10'},message:{logId:'105',type:1}}});
 assert.deepEqual(started,['103']);
 assert.match(sent.at(-1),/가리기 : 1개.*미확인 : 3개/);
});

test('promotion exemptions are room scoped, persisted, revocable, and only bypass automatic hiding',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-promotion-'));
 const setup=()=>{
  const sent=[],hidden=[],lookups=[],core=createCore({send:async(r,t)=>sent.push(t)});
  const mod=createChatHide({dir,canManage:e=>e.userId==='1000',botId:()=> '1000',getRole:async(r,u)=>{lookups.push(u);return 2;},hide:async(r,m)=>{hidden.push([r,m.message.logId]);return {status:0,verified:true};}});
  mod.register(core);
  const event=(r,u,l,t,extra={})=>({roomId:r,userId:u,text:t,msg:{room:{id:r,isOpenChat:true},sender:{id:u},message:{logId:l,type:1},...extra}});
  const cmd=async(r,u,l,t,extra)=>{await core.handle(event(r,u,l,t,extra));return sent.at(-1);};
  const observe=async(r,u,l,t)=>{const e=event(r,u,l,t);return mod.observe(e.msg,e);};
  return {cmd,observe,hidden,lookups};
 };
 try{
  const a=setup();
  await a.cmd('1','1000','100','-홍금 on');
  await a.cmd('2','1000','101','-홍금 on');
  assert.match(await a.cmd('1','4000','102','-홍보가능 4000'),/권한이 없습니다/);
  assert.match(await a.cmd('1','1000','103','-홍보가능 @user',{mentions:[{userId:'4000'}]}),/홍보 허용 완료/);
  assert.equal(await a.observe('1','4000','104','https://example.com'),false);
  assert.deepEqual(a.lookups,[]);
  assert.equal(await a.observe('2','4000','105','https://example.com'),true);
  assert.match(await a.cmd('1','1000','106','-가리기 1'),/가리기 : 1개/);
  const b=setup();
  assert.equal(await b.observe('1','4000','107','https://example.com'),false);
  assert.match(await b.cmd('1','1000','108','-홍보불가 4000'),/홍보 허용 해제/);
  assert.equal(await b.observe('1','4000','109','https://example.com'),true);
  await b.observe('1','5000','110','hello');
  assert.match(await b.cmd('1','1000','111','-홍보가능',{message:{logId:'111',type:26},attachmentsRaw:[{src_logId:'1100',src_userId:'5000'}]}),/사용법/);
  await b.observe('1','5000','1100','hello');
  assert.match(await b.cmd('1','1000','1101','-홍보가능',{message:{logId:'1101',type:26},attachmentsRaw:[{src_logId:'1100',src_userId:'5000'}]}),/홍보 허용 완료/);
  assert.equal(await b.observe('1','5000','1102','https://example.com'),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
