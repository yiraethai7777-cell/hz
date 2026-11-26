'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCore}=require('../core'),{createMembership}=require('../manage/membership');
const event=(room='1')=>({room:{id:room,isOpenChat:true,name:'테스트'},members:[{id:'20',name:'테스트 사용자'},{id:'10',name:'봇'}],message:{logId:'100'}});
test('membership opt-in, room isolation, owner authorization, fold, dedup and persisted state',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-members-'));try{
 const messages=[],send=async(r,t)=>messages.push([r,t]);const opts={dir,botId:()=> '10',send,now:()=>1700000000000};
 let m=createMembership(opts),core=createCore({send});m.register(core);
 const command=(text,userId='10',roomId='1')=>core.handle({text,userId,roomId,msg:{room:{isOpenChat:true}}});
 assert.equal(await m.handle('join',event()),0);
 await command('-입장알림 on','20');assert.equal(m.activeCount(),0);
 await command('-입장알림 on');assert.equal(m.activeCount(),1);
 assert.equal(await m.handle('join',event('2')),0);
 assert.equal(await m.handle('leave',event()),0);
 assert.equal(await m.handle('join',event()),1);
 assert.equal(messages.at(-1)[1].split('\u200b'.repeat(1200))[0],'@테스트 사용자님이 입장하셨습니다.');assert.doesNotMatch(messages.at(-1)[1],/DUKE/);
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
test('ignore non-open rooms, unknown rooms, invalid IDs and self',async()=>{const m=createMembership({botId:()=> '10',allowedRooms:new Set(['1']),send:async()=>{throw Error('unexpected')}});const core=createCore({send:async()=>{}});m.register(core);await core.handle({text:'-입장알림 on',roomId:'1',userId:'10',msg:{room:{isOpenChat:true}}});assert.equal(await m.handle('join',{...event(),room:{id:'1',isOpenChat:false}}),0);assert.equal(await m.handle('join',{...event(),members:[{id:'10',name:'봇'},{id:9007199254740992}]}),0);});

test('join detail includes exact user ID and verified public profile; leave also looks it up',async()=>{
 const messages=[],calls=[],send=async(r,t)=>messages.push(t);const m=createMembership({botId:()=> '10',send,lookupProfile:async(r,u)=>{calls.push([r,u]);return 'https://open.kakao.com/o/sExample';}});const core=createCore({send});m.register(core);
 await core.handle({text:'-입장알림 on',roomId:'1',userId:'10',msg:{room:{isOpenChat:true}}});await core.handle({text:'-퇴장알림 on',roomId:'1',userId:'10',msg:{room:{isOpenChat:true}}});
 const e={...event(),members:[{id:'18500479612113742',name:'회원'}]};await m.handle('join',e);const [summary,detail]=messages.at(-1).split('\u200b'.repeat(1200));assert.ok(!summary.includes('18500479612113742'));assert.match(detail,/아이디 : 18500479612113742/);assert.match(detail,/\[ 입장 기록 \]/);assert.match(detail,/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} KST/);assert.doesNotMatch(detail,/━|닉네임 :/);assert.ok(detail.includes('https://open.kakao.com/o/sExample'));
 await m.handle('leave',e);assert.ok(messages.at(-1).includes('오픈프로필'));assert.ok(messages.at(-1).includes('아이디 : 18500479612113742'));assert.deepEqual(calls,[['1','18500479612113742'],['1','18500479612113742']]);
});
test('join survives missing, invalid or failed profile lookup and timeout',async()=>{
 for(const lookupProfile of [async()=>'',async()=> 'https://example.com/o/sFake',async()=>{throw Error('no profile')},()=>new Promise(()=>{})]){
  let out;const send=async(r,t)=>{out=t;};const m=createMembership({botId:()=> '10',send,lookupProfile,profileTimeoutMs:10});const core=createCore({send});m.register(core);await core.handle({text:'-입장알림 on',roomId:'1',userId:'10',msg:{room:{isOpenChat:true}}});assert.equal(await m.handle('join',event()),1);assert.ok(out.includes('오픈프로필 : 확인 불가'));assert.ok(out.includes('아이디 : 20'));
 }
});

test('non-open profile join is a real mention with folded details; open or unknown profile and leave stay normal',async()=>{
 const out=[],send=async(r,t,o)=>out.push({t,o});let profile={profileType:2,url:''};
 const m=createMembership({botId:()=> '10',send,lookupProfile:async()=>profile});const core=createCore({send});m.register(core);
 for(const text of ['-입장알림 on','-퇴장알림 on'])await core.handle({text,roomId:'1',userId:'10',msg:{room:{isOpenChat:true}}});
 let log=100;const run=async(kind)=>m.handle(kind,{...event(),message:{logId:String(++log)}});
 for(const type of [1,2,4]){profile={profileType:type,url:''};await run('join');const x=out.at(-1);assert.equal(x.t.split('\u200b'.repeat(1200))[0],'@테스트 사용자님이 입장하셨습니다.\n오픈프로필로 변경해 주세요.');assert.deepEqual(x.o,{mentions:[{userId:'20',at:[1],len:'테스트 사용자'.length}]});assert.match(x.t,/오픈프로필 : 없음/);assert.match(x.t,/아이디 : 20/);}
 profile={profileType:3,url:'https://open.kakao.com/o/Example'};await run('join');assert.match(out.at(-1).t,/테스트 사용자님이 입장하셨습니다/);assert.deepEqual(out.at(-1).o,{mentions:[{userId:'20',at:[1],len:'테스트 사용자'.length}]});
 profile=null;await run('join');assert.match(out.at(-1).t,/테스트 사용자님이 입장하셨습니다/);
 profile={profileType:2,url:''};await run('leave');assert.match(out.at(-1).t,/테스트 사용자님이 퇴장하셨습니다/);assert.deepEqual(out.at(-1).o,{mentions:[{userId:'20',at:[1],len:'테스트 사용자'.length}]});
});

test('leave mention rejection falls back to plain name and retains reply target',async()=>{
 const out=[],notices=[];
 const send=async(r,t,o)=>{if(o?.mentions)throw Error('mention rejected');out.push(t);return {body:{logId:'1234'}};};
 const core=createCore({send}),m=createMembership({botId:()=> '10',send,onLeaveNotice:n=>notices.push(n)});
 m.register(core);await core.handle({text:'-퇴장알림 on',roomId:'1',userId:'10',msg:{room:{isOpenChat:true}}});
 assert.equal(await m.handle('leave',event()),1);
 assert.equal(out.at(-1).split('\u200b'.repeat(1200))[0],'테스트 사용자님이 퇴장하셨습니다.');
 assert.doesNotMatch(out.at(-1),/DUKE/);assert.equal(notices[0].userId,'20');
});

test('membership timeout preserves already confirmed profile type and name, no stale guess',async()=>{
 const out=[],send=async(r,t)=>out.push(t);
 const m=createMembership({botId:()=> '10',send,profileTimeoutMs:10,lookupProfile:(r,u,kind,event,partial)=>{partial({profileType:2,name:'확인된 회원'});return new Promise(()=>{});}});
 const core=createCore({send});m.register(core);await core.handle({roomId:'1',userId:'10',text:'-입장알림 on',msg:{room:{isOpenChat:true}}});
 await m.handle('join',{...event(),members:[{id:'20',name:''}]});
 assert.match(out.at(-1),/@확인된 회원님이 입장하셨습니다.\n오픈프로필로 변경해 주세요./);
 assert.match(out.at(-1),/프로필 : 일반\/기본 프로필/);assert.match(out.at(-1),/오픈프로필 : 없음/);
});
