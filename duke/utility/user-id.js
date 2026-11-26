'use strict';
const {canConfigure}=require('../manage/owner-permission'),{resolveTarget,mentions,reference}=require('../manage/targets');
const id=v=>typeof v==='number'&&!Number.isSafeInteger(v)?'':/^[1-9]\d*$/.test(String(v??''))?String(v):'';
const clean=v=>[...String(v??'').replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ').trim()].slice(0,80).join('');
function createUserId({botId=()=>'',getName=()=>'',fetchMessage,noticeTarget=()=>null}={}){
 async function execute(e){
  if(!canConfigure(e,botId))return '봇 계정, 방장, 부방장만 오픈채팅방에서 사용할 수 있습니다.';
  const tags=mentions(e.msg),ref=reference(e.msg);
  const self=!e.args.length&&!tags.length&&!ref;
  if(!self&&!tags.length&&!ref)return '사용법 : -id / -id @대상 / 대상 메시지에 답장하여 -id';
  const target=self?{id:e.userId,name:e.msg?.sender?.name}:await resolveTarget({msg:e.msg,args:e.args,roomId:e.roomId,noticeTarget:l=>noticeTarget(e.roomId,l),fetchMessage});
  if(!id(target?.id))return '사용법 : -id / -id @대상 / 대상 메시지에 답장하여 -id';
  const name=clean(getName(e.roomId,target.id)||target.name)||'이름 미확인';
  return name+'님의 아이디\n'+target.id;
 }
 return {register(core){core.register({name:'id',section:'OWNER',description:'사용자 아이디 확인 (본인 / 멘션 / 답장)',execute});}};
}
module.exports={createUserId};
