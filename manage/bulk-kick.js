'use strict';
const running=new Set();
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
async function handle({client,roomId,msg,userId,kick,db,owner}){
 const room=String(roomId);
 if(msg?.room?.isOpenChat!==true)throw Error('오픈채팅방에서만 사용할 수 있습니다.');
 if(!owner)throw Error('일괄강퇴 권한이 없습니다.');
 if(running.has(room))throw Error('이미 실행 중입니다.');
 if(typeof kick!=='function'||typeof client?.getCachedMemberProfiles!=='function')throw Error('강퇴 API 또는 참가자 캐시를 이용할 수 없습니다.');
 running.add(room);
 try{
  const saved=await db.query('SELECT user_id FROM gl_manage_admins WHERE room_id=$1',[room]);
  const protectedIds=new Set(saved.rows.map(r=>String(r.user_id)));
  const members=await client.getCachedMemberProfiles(roomId);
  const {eligible,skipped}=collect(members,{botId:client.userId,actorId:userId,protectedIds});
  let next=0,success=0,failed=0;
  // No artificial 30ms delay or per-member database round trip. Keep concurrency bounded
  // so LOCO requests can finish without overwhelming the connection.
  const workers=Array.from({length:Math.min(4,eligible.length)},async()=>{
   while(next<eligible.length){
    const member=eligible[next++];
    if(client.connected===false){failed++;continue;}
    try{await kick(member.id);success++;}
    catch(error){failed++;console.warn('[BULK KICK] failed',room,member.id,String(error?.message||error));}
   }
  });
  await Promise.all(workers);
  try{await db.query('INSERT INTO gl_manage_actions(room_id,actor_id,action,detail) VALUES($1,$2,$3,$4)',[room,String(userId),'BULK_KICK',JSON.stringify({success,failed,skipped,attempted:eligible.length})]);}
  catch(error){console.warn('[BULK KICK] audit failed',String(error?.message||error));}
  console.log('[BULK KICK] completed',JSON.stringify({room,success,failed,skipped}));
  return {success,failed,skipped,attempted:eligible.length};
 }finally{running.delete(room);}
}
module.exports={collect,handle};
