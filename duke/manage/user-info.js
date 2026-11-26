'use strict';
const {format,fold}=require('../core'),{resolveTarget,mentions,reference}=require('./targets');
const {validImageUrl}=require('../utility/profile-photo'),{validLink}=require('../utility/open-profile-link');
const LINE='━━━━━━━━━━━━━━';
const clean=(v,max=200)=>[...String(v??'').replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ').trim()].slice(0,max).join('');
function createUserInfo({canManage,lookup,fetchMessage,noticeTarget=()=>null,role,getHistory,getActivity=()=>({}),logger=console}={}){
 const active=new Set();
 async function execute(e){
  if(!canManage?.(e))return format('ADMIN','관리 권한이 없습니다.');
  const key=e.roomId+':'+e.userId;if(active.has(key)||active.size>=4)return '사용자 정보 조회 중입니다. 잠시 후 다시 시도해 주세요.';
  active.add(key);
  try{
   const self=!e.args.length&&!mentions(e.msg).length&&!reference(e.msg);
   const t=self?{id:e.userId,name:e.msg?.sender?.name}:await resolveTarget({msg:e.msg,args:e.args,roomId:e.roomId,noticeTarget:l=>noticeTarget(e.roomId,l),fetchMessage});
   if(!t)return '사용법 : -정보 / -정보 @대상 / -정보 아이디 / 답장';
   const profile=await lookup(e.roomId,t.id);
   if(!profile)return '현재 채팅방에서 대상의 정보를 확인하지 못했습니다.';
   const name=clean(profile.name||t.name,80)||t.id,rows=getHistory(e.roomId,t.id),count=rows.filter(x=>!x.deleted).length;
   const reasons=rows.slice().reverse().slice(0,10).map(x=>x.number+'. '+(clean(x.reason)||'사유 없음')+(x.deleted?' (삭제)':'')).join('\n')||'등록된 경고 없음';
   const stats=getActivity(e.roomId,t.id),num=v=>Number.isSafeInteger(v)?v.toLocaleString('ko-KR'):'0',profileType=[1,2,4].includes(Number(profile.profileType))?'일반/기본 프로필 (세부 유형 미확인)':validLink(profile.url)||profile.profileLinkId?'오픈프로필':'확인 불가';
   const detail=LINE+'\n[ 사용자 정보 ]\n\n이름 : '+name+'\n아이디 : '+t.id+'\n옾링 : '+(validLink(profile.url)||'확인 불가')+'\n프사링크 : '+(validImageUrl(profile.imageUrl)||'확인 불가')+'\n권한 : '+role(e.roomId,t.id,profile.memberType)+'\n프로필 유형 : '+profileType+'\n\n'+LINE+'\n[ 활동 정보 ]\n\n최근 입장일 : '+(stats.lastJoin?new Date(stats.lastJoin).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false}):'기록 없음')+'\n재입장 횟수 : '+num(stats.rejoins)+'회\n전체 채팅량 : '+num(stats.chats)+'회\n\n'+LINE+'\n[ 관리 정보 ]\n\n강퇴 횟수 : '+num(stats.kicks)+'회\n내풀 횟수 : '+num(stats.releases)+'회\n경고 횟수 : '+count+'회\n\n[ 경고 사유 ]\n'+reasons+(rows.length>10?'\n\n전체 경고 내역 : -경고내역 '+t.id:'')+'\n'+LINE;
   return fold(format('INFORMATION',name+'님의 정보'),detail);
  }catch(err){logger.error('[DUKE] user info failed',err?.name||'Error');return '사용자 정보를 조회하지 못했습니다.';}finally{active.delete(key);}
 }
 return {register(core){core.register({name:'정보',section:'MANAGEMENT',description:'사용자 프로필·활동·권한·경고 정보 (본인 / 멘션 / 아이디 / 답장)',execute});}};
}
module.exports={createUserInfo};
