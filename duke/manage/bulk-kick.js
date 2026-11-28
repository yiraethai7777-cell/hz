'use strict';
// Preserve the KakaoTalk Manager implementation. Only adapt DUKE permissions,
// the existing admin list, audit sink and the explicitly requested count.
const bulk=require('./manager-bulk-kick');
const roster=require('./manager-live-roster');
const {format}=require('../core');
const id=v=>typeof v==='number'&&!Number.isSafeInteger(v)?'':/^[1-9]\d*$/.test(String(v??''))?String(v):'';
function registerBulkKick(core,{client,listAdmins,audit,kick,loadRoster=roster.refresh,handler=bulk.handle,logger=console}){
 core.register({name:'일괄강퇴',section:'BOT',description:'봇 계정 전용 · 1~10명',execute:async e=>{
  const actor=id(e.userId),bot=id(client?.userId),sender=id(e.msg?.sender?.id??e.msg?.senderId),room=id(e.roomId);
  if(!bot||actor!==bot||sender!==bot)return format('ADMIN','봇 계정만 사용할 수 있습니다.');
  if(!room||e.msg?.room?.isOpenChat!==true)return format('ADMIN','오픈채팅방에서만 사용할 수 있습니다.');
  if(e.args.length!==1||!/^(?:[1-9]|10)$/.test(e.args[0]))return format('ADMIN','사용법 : -일괄강퇴 10 (1~10명)');
  const limit=Number(e.args[0]);
  try{
   const protectedIds=new Set((await listAdmins(room)).map(id).filter(Boolean));
   const db={query:async(sql,args)=>{
    if(sql.startsWith('SELECT user_id FROM gl_manage_admins'))return {rows:[...protectedIds].map(user_id=>({user_id}))};
    if(sql.startsWith('INSERT INTO gl_manage_actions')){
     const out=JSON.parse(args[3]);
     audit?.record({roomId:room,actorId:actor,actorName:e.msg?.sender?.name,targetName:'현재 채팅방',command:'-일괄강퇴 '+limit,result:'성공 '+out.success+' / 실패 '+out.failed+' / 미확인 '+out.unverified});
     return {rows:[]};
    }
    throw Error('Unsupported Manager audit operation');
   }};
   const result=await handler({client,roomId:room,msg:e.msg,userId:actor,kick:u=>kick(room,u),db,owner:true,listSuperAdmins:async()=>[],
    loadRoster:async(c,r,o)=>{
     const snapshot=await loadRoster(c,r,o);
     const self=snapshot.members.find(m=>id(m.id??m.userId??m.memberId)===bot);
     if(!self||self.roleKnown===false||![1,4].includes(Number(self.type??self.memberType)))throw Error('봇의 방장 또는 부방장 권한을 확인할 수 없습니다.');
     const {eligible}=bulk.collect(snapshot.members,{botId:bot,actorId:actor,protectedIds});
     const all=new Set(eligible.map(m=>m.id)),selected=new Set(eligible.slice(0,limit).map(m=>m.id));
     return {...snapshot,members:snapshot.members.filter(m=>{const uid=id(m.id??m.userId??m.memberId);return !all.has(uid)||selected.has(uid);})};
    }});
   return format('ADMIN','일괄강퇴 결과\n요청 : '+limit+'명\n처리 : '+result.attempted+'명\n성공 : '+result.success+'명\n실패 : '+result.failed+'명\n미확인 : '+result.unverified+'명');
  }catch(error){logger.warn?.('[DUKE BULK KICK]',String(error?.message||error).slice(0,150));return format('ADMIN','일괄강퇴 실패 : '+String(error?.message||'처리 실패').slice(0,150));}
 }});
}
module.exports={registerBulkKick};
