'use strict';
const {isRoomBotAdmin}=require('./room-bot-admin');
const {roots}=require('../manage/targets');
const recent=new Map();
const active=new Set();

function id(v){
 if(typeof v==='bigint')return v>0n?String(v):'';
 if(typeof v==='number')return Number.isSafeInteger(v)&&v>0?String(v):'';
 if(typeof v==='string')return /^[1-9]\d*$/.test(v)?v:'';
 if(v&&typeof v==='object'&&typeof v.toString==='function')return id(v.toString());
 return '';
}
function reference(msg){
 // A reply is type 26. Thread comments and normal messages must not trigger deletion.
 if(Number(msg?.message?.type??msg?.type)!==26)return null;
 for(const attachment of roots(msg)){
  const source=attachment?.reply??attachment?.quote??attachment?.replyTo??attachment;
  const log=id(source?.src_logId??source?.srcLogId??source?.src_log_id??source?.logId);
  const author=id(source?.src_userId??source?.srcUserId??source?.src_user_id??source?.userId);
  if(log)return {log,author};
 }
 return null;
}
function info(msg){
 return {
  room:id(msg?.room?.id??msg?.chatId??msg?.raw?.chatLog?.chatRoomId),
  log:id(msg?.message?.logId??msg?.logId??msg?.raw?.chatLog?.logId??msg?.raw?.chatLog?.id),
  author:id(msg?.sender?.id??msg?.senderId??msg?.raw?.chatLog?.userId)
 };
}
function observe(msg,botId){
 const value=info(msg);
 if(!botId||!value.room||!value.log||value.author!==id(botId))return;
 recent.set(value.room+':'+value.log,{msg,at:Date.now()});
 if(recent.size>2000)recent.delete(recent.keys().next().value);
}
async function handle({client,chat,msg,roomId,senderId,text,isBotAccount}){
 if(text!=='삭제'&&text!=='!삭제')return false;
 const ref=reference(msg);
 if(!ref)return false;
 if(msg?.room?.isOpenChat===false||isBotAccount)return true;
 const room=id(roomId),user=id(senderId),bot=id(client?.userId);
 if(!room||!user||!bot)return true;
 let type=Number(msg?.sender?.type);
 // A missing role is not permission. Look up the current cached member type when available.
 if(![1,4].includes(type)&&typeof client?._resolveMemberType==='function'){
  try{
   if(typeof client?._ensureMemberType==='function')await client._ensureMemberType(room,user);
   type=Number(client._resolveMemberType(room,user));
  }catch(error){console.warn('[REPLY DELETE] member role unavailable');}
 }
 let authorized=[1,4].includes(type);
 if(!authorized){
  try{authorized=await isRoomBotAdmin(room,user);}
  catch(error){console.error('[REPLY DELETE] admin check failed');}
 }
 if(!authorized)return true;
 const send=typeof chat?.sendText==='function'?chat.sendText.bind(chat):
   typeof client?.sendText==='function'?client.sendText.bind(client):null;
 const fail=async message=>{console.warn('[REPLY DELETE]',message);if(send)await send(room,'❌ '+message);};
 // A reply declaring a different author cannot be used to delete the bot's message.
 if(ref.author&&ref.author!==bot)return true;
 const key=room+':'+ref.log;
 if(active.has(key))return true;
 active.add(key);
 try{
  let original=recent.get(key)?.msg;
  if(!original){
   const fetch=typeof chat?.fetchMessage==='function'?chat.fetchMessage.bind(chat):
     typeof client?.fetchMessage==='function'?client.fetchMessage.bind(client):null;
   if(fetch){
    try{original=await fetch(room,ref.log);}
    catch(error){console.warn('[REPLY DELETE] original fetch failed');}
   }
  }
  const found=info(original);
  // Verify exact room, log ID and sender. Never trust only the quoted author field.
  if(found.room!==room||found.log!==ref.log||found.author!==bot){
   await fail('봇이 보낸 원본 메시지를 확인할 수 없어 삭제하지 않았습니다.');
   return true;
  }
  const del=typeof chat?.deleteMessage==='function'?chat.deleteMessage.bind(chat):
    typeof client?.deleteMessage==='function'?client.deleteMessage.bind(client):null;
  if(!del){await fail('현재 KakaoForge에 실제 메시지 삭제 API가 없습니다.');return true;}
  const result=await del(room,ref.log);
  if(result===false||result?.success===false||result?.ok===false||
     (typeof result?.status==='number'&&result.status!==0))
   throw Error('DELETEMSG was rejected');
  recent.delete(key);
  console.log('[REPLY DELETE] DELETEMSG succeeded');
 }catch(error){
  console.error('[REPLY DELETE] DELETEMSG failed',String(error?.message||error));
  await fail('봇 메시지 삭제에 실패했습니다. Railway 로그를 확인해 주세요.');
 }finally{active.delete(key);}
 return true;
}
module.exports={observe,handle,reference,info};
