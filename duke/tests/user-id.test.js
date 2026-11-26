'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCore}=require('../core'),{createUserId}=require('../utility/user-id'),{createProfilePhoto}=require('../utility/profile-photo'),{createOpenProfileLink}=require('../utility/open-profile-link');
test('id, photo and open link enforce bot/owner/cohost before target lookup',async()=>{
 const out=[],calls=[],send=async(r,t)=>out.push(t),botId=()=> '9000',core=createCore({send});
 const opts={botId,getName:(r,u)=>u==='18500479612113742'?'회원':'',fetchMessage:async(r,l)=>{calls.push(l);return {room:{id:r},message:{logId:l,type:1},sender:{id:'18500479612113742',name:'회원'}};}};
 createUserId(opts).register(core);
 createProfilePhoto({...opts,lookup:async()=>{calls.push('photo');return null;}}).register(core);
 createOpenProfileLink({...opts,lookup:async()=>{calls.push('link');return {name:'회원',url:'https://open.kakao.com/o/Example'};}}).register(core);
 const cmd=(text,u,type,extra={})=>core.handle({roomId:'1000',userId:u,text,msg:{room:{isOpenChat:true},sender:{id:u,type,name:'사용자'},...extra}});
 for(const name of ['id','프사','옾링']){
  for(const type of [2,undefined]){await cmd('-'+name,'3000',type);assert.match(out.at(-1),/봇 계정, 방장, 부방장만/);}
  assert.equal(calls.length,0);
 }
 await cmd('-id','9000',2);assert.equal(out.at(-1),'사용자님의 아이디\n9000');
 await cmd('-id @회원','3000',1,{mentions:[{userId:'18500479612113742',name:'회원'}]});assert.equal(out.at(-1),'회원님의 아이디\n18500479612113742');
 await cmd('-id','3000',4,{message:{type:26,attachment:{src_userId:'18500479612113742',src_logId:'6000'}}});assert.equal(out.at(-1),'회원님의 아이디\n18500479612113742');
 await cmd('-프사','3000',4);assert.equal(calls.at(-1),'photo');
 await cmd('-옾링','3000',1);assert.equal(calls.at(-1),'link');
 await cmd('-도움말','3000',2);const detail=out.at(-1).split('[ 관리자명령어 ]')[1];for(const n of ['id','프사','옾링'])assert.ok(detail.includes('-'+n+' :'));
});
