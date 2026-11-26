'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCore}=require('../core'),{createMembership}=require('../manage/membership');
const event=(room='1')=>({room:{id:room,isOpenChat:true,name:'테스트'},members:[{id:'20',name:'테스트 사용자'},{id:'10',name:'봇'}],message:{logId:'100'}});
test('membership opt-in, room isolation, owner authorization, fold, dedup and persisted state',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-members-'));try{
 const messages=[],send=async(r,t)=>messages.push([r,t]);const opts={dir,botId:()=> '10',send,now:()=>1700000000000};
 let m=createMembership(opts),core=createCore({send});m.register(core);
 const command=(text,userId='10',roomId='1')=>core.handle({text,userId,roomId});
 assert.equal(await m.handle('join',event()),0);
 await command('-입장알림 on','20');assert.equal(m.activeCount(),0);
 await command('-입장알림 on');assert.equal(m.activeCount(),1);
 assert.equal(await m.handle('join',event('2')),0);
 assert.equal(await m.handle('leave',event()),0);
 assert.equal(await m.handle('join',event()),1);
 assert.match(messages.at(-1)[1],/테스트 사용자님이 입장하셨습니다\./);
 assert.match(messages.at(-1)[1],/\u200b{1200}/);
 assert.equal(await m.handle('join',event()),0);
 m=createMembership(opts);assert.equal(m.activeCount(),1);
 core=createCore({send});m.register(core);
 await command('-퇴장알림 on');assert.equal(await m.handle('leave',event()),1);
 await command('-입장알림 off');assert.equal(await m.handle('join',event()),0);
 await command('-퇴장알림 off');assert.equal(m.activeCount(),0);
 assert.equal(createMembership(opts).activeCount(),0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('ignore non-open rooms, unknown rooms, invalid IDs and self',async()=>{const m=createMembership({botId:()=> '10',allowedRooms:new Set(['1']),send:async()=>{throw Error('unexpected')}});const core=createCore({send:async()=>{}});m.register(core);await core.handle({text:'-입장알림 on',roomId:'1',userId:'10'});assert.equal(await m.handle('join',{...event(),room:{id:'1',isOpenChat:false}}),0);assert.equal(await m.handle('join',{...event(),members:[{id:'10',name:'봇'},{id:9007199254740992}]}),0);});
