'use strict';
const {resolveTarget,mentions,reference}=require('../manage/targets');
function validLink(value){
 if(typeof value!=='string'||/[\r\n]/.test(value))return '';
 try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='open.kakao.com'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&/^\/o\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)?u.href:'';}catch{return '';}
}
function createOpenProfileLink({lookup,fetchMessage,noticeTarget=()=>null,logger=console,now=Date.now}={}){
 const active=new Set(),last=new Map();
 async function execute(e){
  if(e.msg?.room?.isOpenChat!==true)return '오픈채팅방에서만 사용할 수 있습니다.';
  const key=e.roomId+':'+e.userId,at=now();
  if(active.has(key)||active.size>=4)return '오픈프로필 조회 중입니다. 잠시 후 다시 시도해 주세요.';
  if(last.has(key)&&at-last.get(key)<3000)return '옾링 명령어는 3초 후 다시 사용해 주세요.';
  active.add(key);last.delete(key);last.set(key,at);while(last.size>1024)last.delete(last.keys().next().value);
  try{
   const self=!e.args.length&&!mentions(e.msg).length&&!reference(e.msg);
   const t=self?{id:e.userId,name:e.msg?.sender?.name}:await resolveTarget({msg:e.msg,args:e.args,roomId:e.roomId,noticeTarget:l=>noticeTarget(e.roomId,l),fetchMessage});
   if(!t)return '사용법 : -옾링 / -옾링 @대상 / -옾링 아이디 / 답장';
   const profile=await lookup(e.roomId,t.id);
   if(!profile)return '현재 채팅방에서 대상의 프로필을 확인하지 못했습니다.';
   const name=[...String(profile.name||t.name||t.id).replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ').trim()].slice(0,80).join('')||t.id;
   const url=validLink(profile.url);
   if(!url)return name+'님은 현재 확인 가능한 오픈프로필 링크가 없습니다.';
   return name+'님의 오픈프로필 링크\n'+url;
  }catch(err){logger.error('[DUKE] open profile lookup failed',err?.name||'Error');return '오픈프로필 링크를 조회하지 못했습니다.';}
  finally{active.delete(key);}
 }
 return {register(core){core.register({name:'옾링',description:'현재 오픈프로필 링크 조회 (본인 / 멘션 / 아이디 / 답장)',execute});}};
}
module.exports={createOpenProfileLink,validLink};
