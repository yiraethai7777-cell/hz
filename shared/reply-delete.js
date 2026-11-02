'use strict';
const {isRoomBotAdmin}=require('./room-bot-admin');
const {isSuperAdmin}=require('./super-admin');
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
function record(room,log,message){
 if(!room||!log)return;
 own.set(key(room,log),{at:Date.now(),message:message||null});
 if(own.size>MAX_OWN)own.delete(own.keys().next().value);
}
function install(client){
 if(!client||typeof client.sendMessage!=='function'||installed.has(client))return;
 const original=client.sendMessage;
 client.sendMessage=async function(chatId,...args){
  const res=await original.call(this,chatId,...args);
  const room=id(chatId);
  const log=id(res?.body?.logId??res?.body?.chatLog?.logId??res?.logId);
  if(room&&log&&(res?.status===undefined||res.status===0))record(room,log,res);
  return res;
 };
 installed.add(client);
}
function sourceAttachments(msg){
 const raw=msg?.raw?.chatLog??msg?.raw?.chatlog??msg?.raw?.chat??msg?.raw;
 const values=[
  ...roots(msg),
  msg?.message?.attachment,msg?.message?.attachments,msg?.message?.extra,
  msg?.attachment,msg?.attachments,msg?.extra,
  msg?.raw?.chatLog?.attachment,msg?.raw?.chatLog?.extra,
  msg?.raw?.chat?.attachment,msg?.raw?.chat?.extra,
  msg?.raw?.attachment,msg?.raw?.extra,msg?.raw?.supplement,
  msg?.message?.supplement,msg?.supplement,
  raw?.attachment,raw?.attachments,raw?.extra,raw?.supplement
 ];
 const parsed=[];
 for(let value of values){
  if(typeof value==='string'){
   try{value=JSONExact.parse(value);}catch{continue;}
  }
  if(Array.isArray(value))parsed.push(...value);
  else if(value&&typeof value==='object')parsed.push(value);
 }
 return parsed;
}
function reference(msg){
 // A quoted Kakao message can carry its reply metadata in attachment or
 // extra even if the higher-level adapter reports the wrong message type.
 for(const attachment of sourceAttachments(msg)){
  if(!attachment||typeof attachment!=='object')continue;
  for(const source of [attachment.reply,attachment.quote,attachment.replyTo,attachment.src,attachment]){
   if(!source||typeof source!=='object')continue;
   const log=id(source.src_logId??source.srcLogId??source.src_log_id??source.srcLogID);
   const author=id(source.src_userId??source.srcUserId??source.src_user_id);
   if(log)return {log,author};
  }
 }
 // KakaoForge may normalize a real quote as type=1 without attachments.
 // The underlying chatlog's threadId points to its quoted log.
 const raw=msg?.raw?.chatLog??msg?.raw?.chatlog??msg?.raw?.chat??msg?.raw;
 const thread=id(raw?.threadId??raw?.tid??raw?.thread??msg?.raw?.threadId??msg?.message?.threadId??msg?.threadId);
 const current=id(msg?.message?.logId??msg?.logId??raw?.logId??raw?.id);
 if(thread&&thread!==current)return {log:thread,author:'',via:'threadId'};
 return null;
}
function replyShape(msg){
 const raw=msg?.raw?.chatLog??msg?.raw?.chatlog??msg?.raw?.chat??msg?.raw;
 const items=sourceAttachments(msg);
 return {
  messageType:String(msg?.message?.type??''),
  eventType:String(msg?.type??''),
  rawType:String(raw?.type??''),
  threadIdValid:!!id(raw?.threadId??raw?.tid??raw?.thread??msg?.raw?.threadId??msg?.message?.threadId??msg?.threadId),
  hasAttachment:items.length>0,
  attachmentKeys:items.slice(0,4).map(v=>Object.keys(v||{}).slice(0,12)),
  messageKeys:Object.keys(msg?.message||{}).slice(0,15),
  rawKeys:Object.keys(raw||{}).slice(0,15)
 };
}
function info(msg){
 return {
  room:id(msg?.room?.id??msg?.chatId??msg?.raw?.chatLog?.chatRoomId??msg?.raw?.chatLog?.chatId),
  log:id(msg?.message?.logId??msg?.logId??msg?.raw?.chatLog?.logId??msg?.raw?.chatLog?.id),
  author:id(msg?.sender?.id??msg?.senderId??msg?.raw?.chatLog?.userId??msg?.raw?.chatLog?.authorId)
 };
}
function observe(msg,botId){
 const value=info(msg);
 if(value.room&&value.log&&value.author===id(botId))record(value.room,value.log,msg);
}
async function handle({client,chat,msg,roomId,senderId,text,isBotAccount}){
 if(text!=='삭제'&&text!=='!삭제')return false;
 const ref=reference(msg);
 console.log('[REPLY DELETE] command',JSON.stringify({
  replyType:Number(msg?.message?.type??msg?.type)===26,
  referenceFound:!!ref,
  referenceSource:ref?.via||'attachment',
  replyHasAuthor:!!ref?.author,
  isBotAccount:!!isBotAccount,
  isOpenChat:msg?.room?.isOpenChat!==false,
  shape:ref?undefined:replyShape(msg)
 }));
 if(!ref){
  // A plain '삭제' is otherwise ignored by the command dispatcher.
  // Explicitly explain that the bot did not receive a usable quoted reference.
  const send=typeof chat?.sendText==='function'?chat.sendText.bind(chat):
    typeof client?.sendText==='function'?client.sendText.bind(client):null;
  if(send)await send(roomId,'❌ 답장으로 지정한 원본 메시지를 확인하지 못했습니다. NEXI 메시지의 답장 기능을 눌러 다시 시도해 주세요.');
  return true;
 }
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
 let authorized=[1,4].includes(type),asAdmin=false,asSuperAdmin=false;
 if(!authorized){
  try{
   asAdmin=await isRoomBotAdmin(room,user);
   authorized=asAdmin;
  }catch(error){console.error('[REPLY DELETE] admin lookup failed');}
 }
 if(!authorized){
  try{asSuperAdmin=await isSuperAdmin(room,user);authorized=asSuperAdmin;}
  catch(error){console.error('[REPLY DELETE] superadmin lookup failed',String(error?.code||'DB_ERROR'));}
 }
 console.log('[REPLY DELETE] authorization',JSON.stringify({
  role:type===1?'owner':type===4?'coowner':'other',
  designatedAdmin:asAdmin,superAdmin:asSuperAdmin,allowed:authorized
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
  let original=own.get(targetKey)?.message||null;
  let method=verified?'send-ack-or-receive':'fetch';
  if(!verified||!original?.message){
   const fetch=typeof chat?.fetchMessage==='function'?chat.fetchMessage.bind(chat):
     typeof client?.fetchMessage==='function'?client.fetchMessage.bind(client):null;
   if(fetch){
    try{
     const fetched=await fetch(room,ref.log);
     const found=info(fetched);
     const fetchedOwn=found.room===room&&found.log===ref.log&&found.author===bot;
     verified=verified||fetchedOwn;
     if(fetchedOwn)original=fetched;
    }catch(error){console.warn('[REPLY DELETE] fetch failed',String(error?.code||error?.name||'UNKNOWN'));}
   }
  }
  console.log('[REPLY DELETE] original check',JSON.stringify({verified,method,hasMessageEvent:!!original?.message}));
  if(!verified){
   await fail('봇이 보낸 원본 메시지를 확인할 수 없어 삭제하지 않았습니다.');
   return true;
  }
  const del=typeof chat?.deleteMessage==='function'?chat.deleteMessage.bind(chat):
    typeof client?.deleteMessage==='function'?client.deleteMessage.bind(client):null;
  if(!del){await fail('실제 메시지 삭제 API를 사용할 수 없습니다.');return true;}
  // Use the exact source log ID. This call shape succeeded in earlier
  // production DELETEMSG traces, while passing the send response object did not.
  const res=await del(room,ref.log);
  if(res===false||res?.success===false||res?.ok===false||
     (res?.body?.status!==undefined&&Number(res.body.status)!==0)||
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
