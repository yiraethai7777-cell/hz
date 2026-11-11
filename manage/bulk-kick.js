'use strict';
const running=new Set(),jobs=new Map();
const numeric=v=>/^[1-9]\d*$/.test(String(v??''))?String(v):'';
const safeError=e=>String(e?.message||e||'알 수 없는 오류').slice(0,180);

function role(m){
 if(m?.roleKnown===false)return null;
 const raw=m?.type??m?.memberType??m?.role??m?.userType;
 if(raw==null||String(raw).trim()==='')return null;
 const n=Number(raw);
 return Number.isInteger(n)?n:null;
}
function collect(members,{botId,actorId,protectedIds=new Set()}){
 if(!Array.isArray(members))throw Error('유효한 참가자 명단을 읽을 수 없습니다.');
 const unique=new Set(),skipped={protected:0,unknownRole:0,invalid:0},eligible=[];
 for(const m of members){
  const id=numeric(m?.id??m?.userId??m?.memberId);
  if(!id||unique.has(id)){skipped.invalid++;continue;}
  unique.add(id);
  if(id===String(botId)||id===String(actorId)||protectedIds.has(id)){skipped.protected++;continue;}
  // Explicit member type 0 or 2 is required. Never assume a missing role is ordinary.
  const t=role(m);
  if(t===1||t===4){skipped.protected++;continue;}
  if(t!==0&&t!==2){skipped.unknownRole++;continue;}
  eligible.push({id,name:String(m?.name??m?.nickname??id)});
 }
 return {eligible,skipped};
}
function kickState(reply){
 if(reply===false||reply?.ok===false||reply?.success===false||reply?.status==='error')return 'rejected';
 let accepted=false;
 for(const value of [reply?.body?.status,reply?.result?.body?.status,
  reply?.complete?.body?.status,reply?.result?.status,reply?.complete?.status,reply?.status]){
  if(value==null)continue;
  const number=Number(value);
  if(Number.isFinite(number)){
   if(number!==0)return 'rejected';
   accepted=true;
  }else if(String(value).toLowerCase()==='error')return 'rejected';
 }
 if(accepted||reply?.ok===true||reply?.success===true)return 'accepted';
 return 'unverified';
}
function publicJob(job){
 if(!job)return {status:'unknown',reason:'이 서버에서 확인되는 일괄강퇴 기록이 없습니다.'};
 const {roomId,status,startedAt,finishedAt,attempted,success,failed,unverified,skipped,error,errors}=job;
 return {roomId,status,startedAt,finishedAt,attempted,success,failed,unverified,skipped,error,errors};
}
function getStatus(roomId){return publicJob(jobs.get(String(roomId)));}
function progress(callback,details){if(typeof callback==='function')callback(details);}
async function handle({client,roomId,msg,userId,kick,db,owner,onProgress,
 loadRoster=require('../shared/live-roster').refresh,
 listSuperAdmins=require('../shared/super-admin').list}){
 const room=String(roomId);
 if(msg?.room?.isOpenChat!==true)throw Error('오픈채팅방에서만 사용할 수 있습니다.');
 if(!owner)throw Error('일괄강퇴 권한이 없습니다.');
 if(running.has(room))throw Error('이 채팅방의 일괄강퇴가 이미 실행 중입니다.');
 if(typeof kick!=='function')throw Error('강퇴 API를 사용할 수 없습니다.');
 if(!client?.connected)throw Error('카카오톡 봇 연결이 끊겨 있습니다. 재연결 후 다시 실행해 주세요.');
 running.add(room);
 try{
  const saved=await db.query('SELECT user_id FROM gl_manage_admins WHERE room_id=$1',[room]);
  const protectedIds=new Set(saved.rows.map(r=>String(r.user_id)));
  const superAdmins=await listSuperAdmins(room,db);
  for(const user of superAdmins)protectedIds.add(String(user.user_id));
  // getCachedMemberProfiles is only an event-roster cache and can be empty
  // or incomplete. A fresh CHATONROOM snapshot is required for mass removal.
  const snapshot=await loadRoster(client,room,{force:true});
  const members=snapshot.members;
  if(!members.length)throw Error('실시간 참가자 목록이 비어 있어 실행을 중단했습니다.');
  const {eligible,skipped}=collect(members,{botId:client.userId,actorId:userId,protectedIds});
  progress(onProgress,{attempted:eligible.length,skipped});
  let next=0,success=0,failed=0,unverified=0;
  const errors=[];
  const workers=Array.from({length:Math.min(4,eligible.length)},async()=>{
   while(next<eligible.length){
    const member=eligible[next++];
    if(!client.connected){failed++;if(errors.length<3)errors.push('카카오톡 연결 끊김');progress(onProgress,{success,failed,unverified,errors});continue;}
    try{
     const state=kickState(await kick(member.id));
     if(state==='accepted')success++;
     else if(state==='unverified')unverified++;
     else {failed++;if(errors.length<3)errors.push('서버에서 강퇴 거부');}
    }catch(error){
     failed++;
     if(errors.length<3)errors.push(safeError(error));
     console.warn('[BULK KICK] rejected',room,member.id,safeError(error));
    }
    progress(onProgress,{success,failed,unverified,errors});
   }
  });
  await Promise.all(workers);
  const outcome={success,failed,unverified,skipped,attempted:eligible.length,errors};
  try{
   await db.query('INSERT INTO gl_manage_actions(room_id,actor_id,action,detail) VALUES($1,$2,$3,$4)',
    [room,String(userId),'BULK_KICK',JSON.stringify(outcome)]);
  }catch(error){console.warn('[BULK KICK] audit failed',safeError(error));}
  console.log('[BULK KICK] completed',JSON.stringify({room,...outcome}));
  return outcome;
 }finally{running.delete(room);}
}
function start(args){
 const room=String(args.roomId);
 if(running.has(room)){const err=Error('이 채팅방의 일괄강퇴가 이미 진행 중입니다. 진행 상태를 확인해 주세요.');err.status=409;throw err;}
 const job={roomId:room,status:'running',startedAt:new Date().toISOString(),
  finishedAt:null,attempted:0,success:0,failed:0,unverified:0,
  skipped:{protected:0,unknownRole:0,invalid:0},error:'',errors:[]};
 jobs.set(room,job);
 // Assign a running job before the first async query, so a repeated button
 // press cannot launch another kick wave.
 void handle({...args,onProgress:state=>Object.assign(job,state)})
  .then(result=>Object.assign(job,result,{status:'completed',finishedAt:new Date().toISOString()}))
  .catch(error=>{
   job.status='failed';job.error=safeError(error);job.finishedAt=new Date().toISOString();
   console.error('[WEB BULK KICK FAILED]',room,job.error);
  });
 if(jobs.size>200)for(const [key,value] of jobs){
  if(key!==room&&value.status!=='running'){jobs.delete(key);break;}
 }
 return publicJob(job);
}
module.exports={collect,kickState,handle,start,getStatus};
