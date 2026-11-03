'use strict';

// Live, room-scoped LOCO MEMLIST. Do not inflate the total with chat-history
// participants or expired cache entries.
const MORE='\u200b'.repeat(500);
const numberId=value=>{
 if(value==null)return '';
 const text=typeof value==='object'&&typeof value.toString==='function'
  ?value.toString():String(value);
 return /^[1-9]\d{1,24}$/.test(text)?text:'';
};
const textName=m=>String(m?.nickname??m?.nickName??m?.name??m?.profile?.nickname??m?.profile?.name??'').trim().slice(0,80);
async function handle({text,roomId,client,send}){
 if(!/^!방인원\s+체크$/.test(text))return false;
 const carriage=client?._carriage;
 if(!carriage||typeof carriage.chatOnRoom!=='function'){
  await send('❌ 현재 참여자 목록 조회 기능을 사용할 수 없습니다.');
  return true;
 }
 const members=new Map();
 let complete=false, error='';
 try{
  // MEMLIST returns -203 for this open-chat room and can disconnect Carriage.
  // Use the CHATONROOM member snapshot (the same source as the existing roster cache).
  const response=await carriage.chatOnRoom({chatId:roomId,token:0,opt:0});
  if(response?.status!=null&&Number(response.status)!==0)throw Error('서버 상태 '+response.status);
  const body=response?.body||{};
  if(body.status!=null&&Number(body.status)!==0)throw Error('참여자 응답 상태 '+body.status);
  const list=body.m??body.members??body.memberList??body.memList;
  if(!Array.isArray(list))throw Error('현재 인원 목록이 응답에 없습니다.');
  for(const m of list){
   const userId=numberId(m?.userId??m?.id??m?.memberId??m?.user_id);
   if(!userId)continue;
   const name=textName(m)||String(client?._memberNames?.get(String(roomId))?.get(userId)||'이름 확인 불가');
   const prior=members.get(userId);
   if(!prior||prior.name==='이름 확인 불가')members.set(userId,{id:userId,name});
  }
  complete=true;
  console.log('[ROOM MEMBERS OK]',{roomId:String(roomId),count:members.size});
 }catch(e){
  error=String(e?.message||e).slice(0,120);
  console.warn('[ROOM MEMBERS FAILED]',{roomId:String(roomId),error});
 }
 if(!members.size){
  await send('❌ 현재 방의 참여자를 확인하지 못했습니다.'+(error?'\\n사유: '+error:''));
  return true;
 }
 const sorted=[...members.values()].sort((a,b)=>a.name.localeCompare(b.name,'ko')||a.id.localeCompare(b.id));
 if(!sorted.length){
  await send('❌ 현재 방의 참여자를 확인하지 못했습니다.'+(error?'\n사유: '+error:''));
  return true;
 }
 const heading='👥 NEXI | 방 인원 확인\n━━━━━━━━━━━━━━━━\n'+
  '✅ 확인된 인원: '+sorted.length+'명\n'+
  '📋 조회 방식: CHATONROOM\n'+
  (complete?'ℹ️ 서버 응답 기준 확인된 인원입니다.':'⚠️ 조회가 완전히 끝나지 않아 일부 인원만 표시될 수 있습니다.')+
  (error?'\n⚠️ 일부 조회 실패: '+error:'')+
  '\n━━━━━━━━━━━━━━━━\n📂 전체보기에서 이름 · ID 확인'+MORE+'\n';
 const lines=sorted.map((m,i)=>(i+1)+'. '+m.name+'\n🆔 '+m.id);
 let output=heading, continuation=1;
 for(const line of lines){
  if(output.length+line.length+2>8500){
   await send(output);
   continuation++;
   output='👥 NEXI | 방 인원 확인 (계속 '+continuation+')\n'+line;
  }else output+='\n'+line;
 }
 if(output)await send(output);
 return true;
}
module.exports={handle};
