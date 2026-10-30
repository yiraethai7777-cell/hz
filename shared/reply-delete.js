'use strict';
const {isRoomBotAdmin}=require('./room-bot-admin');
const {roots}=require('../manage/targets');
const JSONExact=require('lossless-json');

const own=new Map();
const active=new Set();
const installed=new WeakSet();
const MAX_OWN=5000;

function id(v){
 if(typeof v==='bigint')return v>0n?String(v):'';
 if(typeof v==='number')return Number.isSafeInteger(v)&&v>0?String(v):'';
 if(typeof v==='string')return /^[1-9]\d*$/.test(v)?v:'';
 if(v&&typeof v==='object'&&typeof v.toString==='function')return id(v.toString());
 return '';
}
function key(room,log){return room+':'+log;}
function record(room,log){
 if(!room||!log)return;
 own.set(key(room,log),Date.now());
 if(own.size>MAX_OWN)own.delete(own.keys().next().value);
}
function install(client){
 if(!client||typeof client.sendMessage!=='function'||installed.has(client))return;
 const original=client.sendMessage;
 client.sendMessage=async function(chatId,...args){
  const res=await original.call(this,chatId,...args);
  const room=id(chatId);
  const log=id(res?.body?.logId??res?.body?.chatLog?.logId??res?.logId);
  if(room&&log&&(res?.status===undefined||res.status===0))record(room,log);
  return res;
 };
 installed.add(client);
}
function sourceAttachments(msg){
 const raw=msg?.raw?.chatLog??msg?.raw?.chatlog??msg?.raw?.chat??msg?.raw;
 // Prioritize the original wire JSON, which preserves 64-bit log IDs with lossless-json.
 const exact=[];
 for(const value of [raw?.attachment,raw?.attachments,raw?.extra]){
  if(typeof value!=='string')continue;
  try{
   const parsed=JSONExact.parse(value);
   exact.push(...(Array.isArray(parsed)?parsed:[parsed]));
  }catch{}
 }
 return [...exact,...roots(msg)];
}
function reference(msg){
 const type=Number(msg?.message?.type??msg?.type);
 for(const attachment of sourceAttachments(msg)){
  if(!attachment||typeof attachment!=='object')continue;
  const source=attachment.reply??attachment.quote??attachment.replyTo??attachment;
  const explicit=source?.src_logId!==undefined||source?.srcLogId!==undefined||
    source?.src_log_id!==undefined;
  if(type!==26&&!explicit)continue;
  const log=id(source?.src_logId??source?.srcLogId??source?.src_log_id??
    (source!==attachment?source?.logId:undefined));
  const author=id(source?.src_userId??source?.srcUserId??source?.src_user_id??
    (source!==attachment?source?.userId:undefined));
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
 if(value.room&&value.log&&value.author===id(botId))record(value.room,value.log);
}
async function handle({client,chat,msg,roomId,senderId,text,isBotAccount}){
 if(text!=='삭제'&&text!=='!삭제')return false;
 const ref=reference(msg);
 console.log('[REPLY DELETE] command',JSON.stringify({
  replyType:Number(msg?.message?.type??msg?.type)===26,
  referenceFound:!!ref,
  replyHasAuthor:!!ref?.author,
  isBotAccount:!!isBotAccount,
  isOpenChat:msg?.room?.isOpenChat!==false
 }));
 if(!ref)return false;
 if(msg?.room?.isOpenChat===false||isBotAccount)return true;
 const room=id(roomId),user=id(senderId),bot=id(client?.userId);
 if(!room||!user||!bot){console.warn('[REPLY DELETE] missing validated identity');return true;}
 const send=typeof chat?.sendText==='function'?chat.sendText.bind(chat):
   typeof client?.sendText==='function'?client.sendText.bind(client):null;
 const fail=async message=>{
  console.warn('[REPLY DELETE]',message);
  if(send)await send(room,'❌ '+message);
 };
 let type=Number(msg?.sender?.type);
 if(![1,4].includes(type)&&typeof client?._resolveMemberType==='function'){
  try{
   if(typeof client?._ensureMemberType==='function')await client._ensureMemberType(room,user);
   type=Number(client._resolveMemberType(room,user));
  }catch(error){console.warn('[REPLY DELETE] role lookup failed');}
 }
 let authorized=[1,4].includes(type),asAdmin=false;
 if(!authorized){
  try{
   asAdmin=await isRoomBotAdmin(room,user);
   authorized=asAdmin;
  }catch(error){console.error('[REPLY DELETE] admin lookup failed');}
 }
 console.log('[REPLY DELETE] authorization',JSON.stringify({
  role:type===1?'owner':type===4?'coowner':'other',
  designatedAdmin:asAdmin,allowed:authorized
 }));
 if(!authorized)return true;
 if(ref.author&&ref.author!==bot){
  console.log('[REPLY DELETE] rejected different quoted author');
  return true;
 }
 const targetKey=key(room,ref.log);
 if(active.has(targetKey))return true;
 active.add(targetKey);
 try{
  let verified=own.has(targetKey);
  let method=verified?'send-ack-or-receive':'fetch';
  if(!verified){
   const fetch=typeof chat?.fetchMessage==='function'?chat.fetchMessage.bind(chat):
     typeof client?.fetchMessage==='function'?client.fetchMessage.bind(client):null;
   if(fetch){
    try{
     const original=await fetch(room,ref.log);
     const found=info(original);
     verified=found.room===room&&found.log===ref.log&&found.author===bot;
    }catch(error){console.warn('[REPLY DELETE] fetch failed',String(error?.code||error?.name||'UNKNOWN'));}
   }
  }
  console.log('[REPLY DELETE] original check',JSON.stringify({verified,method}));
  if(!verified){
   await fail('봇이 보낸 원본 메시지를 확인할 수 없어 삭제하지 않았습니다.');
   return true;
  }
  const del=typeof chat?.deleteMessage==='function'?chat.deleteMessage.bind(chat):
    typeof client?.deleteMessage==='function'?client.deleteMessage.bind(client):null;
  if(!del){await fail('실제 메시지 삭제 API를 사용할 수 없습니다.');return true;}
  const res=await del(room,ref.log);
  if(res===false||res?.success===false||res?.ok===false||
     (res?.status!==undefined&&Number(res.status)!==0))
   throw Error('DELETEMSG_REJECTED');
  own.delete(targetKey);
  console.log('[REPLY DELETE] DELETEMSG succeeded');
 }catch(error){
  console.error('[REPLY DELETE] DELETEMSG failed',String(error?.code||error?.message||error));
  await fail('봇 메시지 삭제에 실패했습니다. Railway 로그를 확인해 주세요.');
 }finally{active.delete(targetKey);}
 return true;
}
module.exports={install,observe,handle,reference,info};
