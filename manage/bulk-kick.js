'use strict';
const running=new Set();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const numeric=v=>/^[1-9]\d*$/.test(String(v??''))?String(v):'';
function role(m){
 const value=m?.type??m?.memberType??m?.role??m?.userType;
 return value==null?null:Number(value);
}
function collect(members,{botId,actorId,protectedIds=new Set()}){
 if(!Array.isArray(members))throw Error('유효한 참가자 명단을 읽을 수 없습니다.');
 const unique=new Set(),skipped={protected:0,unknownRole:0,invalid:0};
 const eligible=[];
 for(const m of members){
  const id=numeric(m?.id??m?.userId??m?.memberId);
  if(!id||unique.has(id)){skipped.invalid++;continue;}
  unique.add(id);
  if(id===String(botId)||id===String(actorId)||protectedIds.has(id)){skipped.protected++;continue;}
  const t=role(m);
  // 1 = owner, 4 = co-host; only known ordinary-member role 0 or 2.
  if(t!==0&&t!==2){skipped.unknownRole++;continue;}
  eligible.push({id,name:String(m?.name??m?.nickname??id)});
 }
 return {eligible,skipped};
}
async function handle({client,roomId,msg,userId,send,kick,db,owner}){
 const room=String(roomId);
 if(msg?.room?.isOpenChat!==true){await send('오픈채팅방에서만 사용할 수 있습니다.');return;}
 if(!owner){await send('⛔ 일괄강퇴는 봇 소유자만 사용할 수 있습니다.');return;}
 if(running.has(room)){await send('이미 이 방의 일괄강퇴가 실행 중입니다.');return;}
 if(typeof kick!=='function'||typeof client?.getCachedMemberProfiles!=='function'){
  await send('강퇴 API 또는 참가자 캐시를 이용할 수 없습니다.');return;
 }
 running.add(room);
 try{
  const saved=await db.query('SELECT user_id FROM gl_manage_admins WHERE room_id=$1',[room]);
  const protectedIds=new Set(saved.rows.map(r=>String(r.user_id)));
  // Observed profiles can contain departed users. Do not treat this as a complete roster.
  const members=await client.getCachedMemberProfiles(roomId);
  const {eligible,skipped}=collect(members,{botId:client.userId,actorId:userId,protectedIds});
  if(!eligible.length){await send('강퇴할 수 있는 일반 참여자가 없습니다. (관리자·역할 미확인 대상 제외)');return;}
  let success=0,failed=0;
  for(const member of eligible){
   if(client?.connected===false){failed+=eligible.length-success-failed;break;}
   try{await kick(member.id);success++;}
   catch(error){failed++;console.warn('[BULK KICK] 실패:',room,member.id,String(error?.message||error));}
   try{
    await db.query("INSERT INTO gl_manage_actions(room_id,actor_id,target_id,action,detail) VALUES($1,$2,$3,'KICK',$4)",[room,String(userId),member.id,'일괄강퇴 '+(success+failed)]);
   }catch(e){console.warn('[BULK KICK] 기록 실패:',String(e?.message||e));}
   await pause(30);
  }
  await send('🚫 일괄강퇴 처리 결과\n성공: '+success+'명\n실패·중단: '+failed+'명\n역할 확인 불가 제외: '+skipped.unknownRole+'명\n관리자·봇·실행자 제외: '+skipped.protected+'명\n※ 캐시 기반으로 현재 전체 인원을 보장하지 않습니다.');
 }finally{running.delete(room);}
}
module.exports={collect,handle};
