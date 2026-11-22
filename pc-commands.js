'use strict';
// DB-free Windows KakaoTalk manager commands. Reuse the existing target parser;
// never import the PostgreSQL management dispatcher.
const {exact,mentions,reference}=require('./manage/targets');
const MAX_ID=/^\d{4,25}$/;
const isRoomManager=role=>[1,4].includes(Number(role));
const errText=e=>String(e?.message||e||'알 수 없는 오류').slice(0,260);

async function resolveTarget({msg,text,roomId,client}){
 const parts=String(text||'').trim().split(/\s+/);
 const arg=parts.length>1?parts[1]:'';
 if(arg&&MAX_ID.test(arg))return {id:arg,name:arg};
 const tagged=mentions(msg);
 if(tagged.length>1)throw Error('대상은 한 명만 지정해 주세요.');
 if(tagged.length===1)return tagged[0];
 if(arg)throw Error('사용자 ID(숫자), 실제 멘션 또는 답장을 사용해 주세요.');
 const ref=reference(msg);
 if(!ref)return null;
 if(ref.userId&&MAX_ID.test(ref.userId))return {id:ref.userId,name:ref.userId};
 if(!ref.logId||typeof client.fetchMessage!=='function')
  throw Error('답장한 메시지의 작성자 정보를 확인할 수 없습니다.');
 const original=await client.fetchMessage(roomId,ref.logId);
 if(String(original?.room?.id)!==String(roomId)||
    String(original?.message?.logId??original?.logId??'')!==ref.logId)
  throw Error('답장한 원본 메시지를 검증할 수 없습니다.');
 const id=exact(original?.sender?.id);
 if(!id||!MAX_ID.test(id))throw Error('답장 원본 작성자의 ID를 확인할 수 없습니다.');
 return {id,name:String(original?.sender?.name||id)};
}

function kickResult(response){
 if(response===false||response?.ok===false||response?.success===false)
  throw Error('카카오 서버에서 강퇴를 거부했습니다.');
 const statuses=[response?.status,response?.body?.status,response?.result?.status,response?.result?.body?.status]
  .filter(v=>v!==undefined&&v!==null);
 if(statuses.some(v=>Number(v)!==0))
  throw Error('카카오 서버에서 강퇴를 거부했습니다 (상태 '+statuses.join(', ')+').');
 return statuses.length?'accepted':'unverified';
}

function createPcCommands({client,roomId,loadRoster,send,canKick=()=>true,logger=console}){
 if(!client||typeof loadRoster!=='function'||typeof send!=='function')
  throw Error('PC 명령어 초기화에 필요한 카카오 클라이언트와 방 정보가 없습니다.');
 const room=String(roomId);
 let busy=false;
 async function kickOne(userId){
  const id=String(userId||'');
  if(!MAX_ID.test(id))throw Error('대상의 정확한 사용자 ID가 필요합니다.');
  if(id===String(client.userId))throw Error('본인 계정은 강퇴할 수 없습니다.');
  if(!canKick()||busy)throw Error('다른 강퇴 작업이 진행 중입니다.');
  busy=true;
  try{
   if(!client.connected)throw Error('PC 카카오톡 연결이 끊어져 있습니다.');
   const members=await loadRoster();
   const me=members.find(m=>String(m.id)===String(client.userId));
   if(!me||!isRoomManager(me.role))throw Error('PC 로그인 계정의 방장·부방장 권한을 확인하지 못했습니다.');
   const target=members.find(m=>String(m.id)===id);
   if(target&&!Number.isInteger(Number(target.role)))throw Error('대상 역할을 확인하지 못했습니다.');
   if(target&&isRoomManager(target.role))throw Error('방장·부방장은 강퇴할 수 없습니다.');
   // An already-departed member may not appear in the live roster. In that case
   // only a verified numeric ID is sent; the Kakao server decides whether
   // KICKMEM can act on a departed member. Do not claim a persistent ban.
   if(typeof client.openChatKick!=='function')throw Error('강퇴 API가 지원되지 않습니다.');
   return kickResult(await client.openChatKick(room,id));
  }finally{busy=false;}
 }
 async function handleChat(msg){
  if(String(msg?.room?.id)!==room)return false;
  const text=String(msg?.message?.text??msg?.text??'').trim();
  const command=text.split(/\s+/)[0]?.toLowerCase();
  if(!['!핑','!id','!k','!kick'].includes(command))return false;
  const sender=String(msg?.sender?.id??msg?.senderId??'');
  if(!sender)return false;
  async function reply(body){
   try{await send(room,body)}catch(e){logger.error('PC 명령 응답 실패: '+errText(e));}
  }
  if(command==='!핑'){
   await reply('🏓 퐁! PC 봇 연결 정상');
   return true;
  }
  const privileged=sender===String(client.userId)||isRoomManager(msg?.sender?.type);
  try{
   const resolved=await resolveTarget({msg,text,roomId:room,client});
   if(command==='!id'){
    if(resolved&&!privileged){
     await reply('⛔ 다른 사람의 ID 조회는 방장·부방장 또는 PC 봇 계정만 가능합니다.');
     return true;
    }
    const id=resolved?.id||sender;
    await reply('🆔 사용자 ID: '+id);
    return true;
   }
   if(!privileged){await reply('⛔ 강퇴 권한이 없습니다.');return true;}
   if(!resolved){await reply('사용법: !k 사용자ID / !k @실제멘션 / 대상 메시지에 답장으로 !k');return true;}
   const status=await kickOne(resolved.id);
   await reply(status==='accepted'
    ?'✅ '+resolved.name+'님 강퇴 요청을 서버에서 수락했습니다.'
    :'⚠️ '+resolved.name+'님 강퇴 요청을 전송했지만 결과는 확인되지 않았습니다.');
  }catch(error){
   await reply('❌ '+errText(error));
  }
  return true;
 }
 return {kickOne,handleChat,isBusy:()=>busy};
}
module.exports={createPcCommands,resolveTarget,kickResult};
