'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCore}=require('../core'),{createProfileHistory}=require('../utility/profile-history'),{createProfileWatch}=require('../manage/profile-watch'),{createMembership}=require('../manage/membership'),{createOpenProfileLink}=require('../utility/open-profile-link'),{tableFor}=require('../database');
test('profile history records only verified room-scoped links; dedup, permissions, pagination and restore',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-profile-history-')),out=[],dirty=[];let enabled=true,at=1700000000000;
 const send=async(r,t)=>out.push(t),opts={dir,botId:()=> '9000',now:()=>at,onPersist:k=>dirty.push(k),isEnabled:()=>enabled,fetchMessage:async(r,l)=>({room:{id:r},message:{type:1,logId:l},sender:{id:'3000',name:'회원'}})};
 let h=createProfileHistory(opts),core=createCore({send});h.register(core);
 const cmd=(text,type=1,r='1000',extra={})=>core.handle({roomId:r,userId:'5000',text,msg:{room:{id:r,isOpenChat:true},sender:{id:'5000',type},...extra}});
 try{
  assert.equal(h.observe('1000','3000','회원',['https://example.com/o/Fake','확인 불가']),false);
  assert.equal(h.observe('1000','3000','회원',['https://open.kakao.com/o/A','https://open.kakao.com/o/B']),true);
  assert.equal(h.observe('1000','3000','회원','https://open.kakao.com/o/A/'),false);assert.equal(dirty.length,1);
  await cmd('-프로필로그 3000',2);assert.match(out.at(-1),/봇 계정/);assert.doesNotMatch(out.at(-1),/open.kakao.com/);
  await cmd('-프로필로그 @회원',4,'1000',{mentions:[{userId:'3000',name:'회원'}]});assert.match(out.at(-1),/저장된 링크 : 2개/);
  await cmd('-프로필로그 3000',1,'2000');assert.match(out.at(-1),/기록이 없습니다/);
  await cmd('-프로필로그',1,'1000',{message:{type:26,attachment:{src_userId:'3000',src_logId:'7000'}}});assert.match(out.at(-1),/저장된 링크 : 2개/);
  for(let i=0;i<12;i++){at++;h.observe('1000','3000','회원','https://open.kakao.com/o/P'+i);}
  h=createProfileHistory(opts);core=createCore({send});h.register(core);await cmd('-프로필로그 3000 2');assert.match(out.at(-1),/페이지 : 2 \/ 2/);assert.match(out.at(-1),/https:\/\/open.kakao.com\/o\/A/);
  enabled=false;assert.equal(h.observe('1000','3000','회원','https://open.kakao.com/o/New'),false);
  assert.equal(tableFor('profile-history/1000-3000.json'),'duke_profile_history');assert.equal(tableFor('profile-history/../auth.json'),null);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('existing join, verified profile changes and authorized open link query feed history without new scan',async()=>{
 let at=0,rows=[{id:'3000',nickName:'회원',ptp:3,pli:'4000'}];const out=[],send=async(r,t)=>out.push(t),botId=()=> '9000',h=createProfileHistory({botId,now:()=>at});
 const core=createCore({send}),w=createProfileWatch({botId,now:()=>at,send,listRooms:async()=>['1000'],fetchRoster:async()=>rows,lookupLinks:async ids=>new Map(ids.map(i=>[i,'https://open.kakao.com/o/P'+i])),onProfileObserved:h.observe});
 const m=createMembership({botId,send,onProfileObserved:h.observe,lookupProfile:async()=>({profileType:3,url:'https://open.kakao.com/o/P4000'})});
 h.register(core);w.register(core);m.register(core);createOpenProfileLink({botId,lookup:async()=>({name:'회원',url:'https://open.kakao.com/o/Manual'}),onProfileObserved:h.observe}).register(core);
 const cmd=text=>core.handle({roomId:'1000',userId:'9000',text,msg:{room:{isOpenChat:true},sender:{name:'봇'}}});
 try{
  await cmd('-입장알림 on');await cmd('-프로필감지 on');await m.handle('join',{room:{id:'1000',isOpenChat:true},members:[{id:'3000',name:'회원'}],message:{logId:'8000'}});
  await w.tick();at+=3000;rows=[{...rows[0],pli:'4001'}];await w.tick();await cmd('-옾링 3000');await cmd('-프로필로그 3000');assert.match(out.at(-1),/저장된 링크 : 3개/);assert.match(out.at(-1),/P4000/);assert.match(out.at(-1),/P4001/);assert.match(out.at(-1),/Manual/);
 }finally{w.stop();}
});
