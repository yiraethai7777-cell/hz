'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCore}=require('../core'),{createMembership}=require('../manage/membership'),{createProfileWatch}=require('../manage/profile-watch'),{createDeleteWatch}=require('../manage/delete-watch');
test('all six watcher settings permit only room owner and bot; no cohost or additional admin bypass',async()=>{
 const out=[],send=async(r,t)=>out.push(t),botId=()=> '9000';
 const core=createCore({send}),opts={send,botId};
 const membership=createMembership(opts),profile=createProfileWatch(opts),deletion=createDeleteWatch({...opts,edit:async()=>({status:0})});
 try{
  membership.register(core);profile.register(core);deletion.register(core);
  const commands=['삭제감지','수정감지','닉변감지','프로필감지','입장알림','퇴장알림'];
  const cmd=(name,value,userId,type,isOpenChat=true,senderId=userId)=>core.handle({roomId:'1000',userId,text:'-'+name+' '+value,msg:{room:{isOpenChat},sender:{id:senderId,type}}});
  for(const name of commands){
   for(const type of [2,4,undefined]){await cmd(name,'on','3000',type);assert.match(out.at(-1),/방장과 봇 계정만/);}
   await cmd(name,'on','3000',1,false);assert.match(out.at(-1),/방장과 봇 계정만/);
   await cmd(name,'on','3000',1,true,'4000');assert.match(out.at(-1),/방장과 봇 계정만/);
   await cmd(name,'on','3000',1);assert.match(out.at(-1),/: ON/);
   await cmd(name,'off','9000',2);assert.match(out.at(-1),/: OFF/);
  }
  await core.handle({roomId:'1000',userId:'3000',text:'-도움말'});const detail=out.at(-1).split('[ 관리자명령어 ]')[1];assert.ok(detail);for(const name of commands)assert.ok(detail.includes('-'+name+' :'));
 }finally{profile.stop();deletion.close();}
});
