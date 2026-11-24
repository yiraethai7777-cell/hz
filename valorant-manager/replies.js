'use strict';
function id(v){
 if(typeof v==='bigint')return v>0n?String(v):'';
 if(typeof v==='number')return Number.isSafeInteger(v)&&v>0?String(v):'';
 if(typeof v==='string')return /^[1-9]\d*$/.test(v)?v:'';
 if(v&&typeof v==='object'&&typeof v.toString==='function')return id(v.toString());
 return '';
}
function attachments(msg){
 const values=[
  msg?.message?.attachment,msg?.message?.attachments,msg?.message?.extra,msg?.message?.reply,
  msg?.attachment,msg?.attachments,msg?.extra,msg?.raw?.attachment,
  msg?.raw?.chatLog?.attachment,msg?.raw?.chatLog?.extra,
  msg?.raw?.chatlog?.attachment,msg?.raw?.chatlog?.extra,
  msg?.raw?.chat?.attachment,msg?.raw?.chat?.extra,msg?.raw?.extra
 ];
 const parsed=[];
 for(let value of values){
  if(typeof value==='string'){try{value=require('lossless-json').parse(value)}catch{continue}}
  if(Array.isArray(value))parsed.push(...value);
  else if(value&&typeof value==='object')parsed.push(value);
 }
 return parsed;
}
function reference(msg){
 // Preserve the NEXI KakaoForge reply metadata extraction order.
 for(const a of attachments(msg)){
  for(const source of [a?.reply,a?.quote,a?.replyTo,a?.src,a]){
   if(!source||typeof source!=='object')continue;
   const log=id(source.src_logId??source.srcLogId??source.src_log_id??source.srcLogID??source.logId);
   const author=id(source.src_userId??source.srcUserId??source.src_user_id);
   if(log)return {log,author};
  }
 }
 const raw=msg?.raw?.chatLog??msg?.raw?.chatlog??msg?.raw?.chat??msg?.raw;
 const thread=id(raw?.threadId??raw?.tid??raw?.thread??msg?.raw?.threadId??msg?.message?.threadId??msg?.threadId);
 const current=id(msg?.message?.logId??msg?.logId??raw?.logId??raw?.id);
 if(thread&&thread!==current)return {log:thread,author:'',via:'threadId'};
 return null;
}
async function resolveReply({chat,msg,roomId,botId}){
 const ref=reference(msg);
 const log=ref?.log;
 if(log==null||typeof chat?.fetchMessage!=='function')return null;
 try{
  const original=await chat.fetchMessage(roomId,log);
  const author=String(original?.sender?.id??original?.senderId??'');
  if(author!==String(botId))return null;
  const text=String(original?.message?.text??original?.text??'');
  if(text.includes('현재 예약된 내전에 참여하시겠습니까?'))return {type:'scrim-registration'};
  if(text.startsWith('🎯 저장한 발로란트 계정'))return {type:'accounts'};
  const duo=/(?:🎮 VALORANT SCHOOL \||🎮 카카오톡 매니저 \| VALORANT ·) 듀오 모집 #(\d+)/.exec(text);
  if(duo)return {type:'duo',number:duo[1]};
  const m=/파티 #(\d+)/.exec(text);
  if(m)return {type:'party',number:m[1]};
 }catch(e){console.warn('[SCHOOL REPLY]',e?.message||e)}
 return null;
}
module.exports={reference,resolveReply};
