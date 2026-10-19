'use strict';
const running=new Set();
async function handle(ctx,db){
 const command=ctx.text.split(/\s+/)[0];if(!['#내풀','#벤해제'].includes(command))return false;
 if(![1,4].includes(Number(ctx.senderType))){await ctx.send('⛔ 방장·부방장만 사용할 수 있습니다.');return true;}
 let target;
 try{target=await ctx.resolveTarget();}catch(e){await ctx.send('대상 확인 실패: '+e.message);return true;}
 if(!target){await ctx.send(`사용법: ${command} 사용자ID 또는 실제 @멘션\n대상 메시지에 답장·댓글로 ${command}만 보내도 됩니다.`);return true;}
 if(target.id===String(ctx.botId)||target.id===String(ctx.userId)){await ctx.send('⛔ 봇 또는 본인은 대상으로 지정할 수 없습니다.');return true;}
 if(typeof ctx.unban!=='function'||(command==='#내풀'&&typeof ctx.kick!=='function')){await ctx.send('❌ 내보내기·해제 API를 사용할 수 없습니다.');return true;}
 const key=String(ctx.roomId)+':'+target.id;
 if(running.has(key)){await ctx.send('같은 대상의 내보내기·해제를 처리 중입니다.');return true;}
 running.add(key);let kicked=false;
 try{
  if(command==='#내풀'){
   try{await ctx.kick(target.id);kicked=true;}catch(e){await ctx.send('❌ 벤 실패: '+e.message);return true;}
  }
  try{await ctx.unban(target.id);}catch(e){await ctx.send(`${kicked?'⚠️ '+target.name+'님을 벤했지만 해제에 실패했습니다.':'❌ 벤 해제 실패:'}\n${e.message}${kicked?'\n#벤해제 '+target.id+' 로 다시 해제할 수 있습니다.':''}`);return true;}
  try{await db.query('INSERT INTO gl_manage_actions(room_id,actor_id,target_id,action,detail) VALUES($1,$2,$3,$4,$5)',[String(ctx.roomId),String(ctx.userId),target.id,kicked?'KICK_RELEASE':'UNKICK','카카오 내보내기 목록 해제 확인']);}catch(e){console.error('[NEXUS UNKICK LOG]',e.message);}
  await ctx.send(kicked?`✅ ${target.name}님을 벤한 뒤 해제했습니다.\n다시 입장할 수 있습니다.`:`✅ ${target.name}님의 벤을 해제했습니다.\n다시 입장할 수 있습니다.`);
  return true;
 }finally{running.delete(key);}
}
module.exports={handle};
