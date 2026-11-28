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
