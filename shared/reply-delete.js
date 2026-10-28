'use strict';
const {isRoomBotAdmin}=require('./room-bot-admin');
const LosslessJSON=require('lossless-json');
const recent=new Map();
function id(v){
 if(typeof v==='bigint')return v>0n?String(v):'';
 if(typeof v==='number')return Number.isSafeInteger(v)&&v>0?String(v):'';
 if(typeof v==='string')return /^[1-9]\d*$/.test(v)?v:'';
 if(v&&typeof v==='object'&&typeof v.toString==='function')return id(v.toString());
 return '';
}
function parse(v){if(typeof v!=='string')return v;try{return LosslessJSON.parse(v);}catch{return null;}}
function reference(msg){
 const raw=msg?.raw?.chatLog??msg?.raw?.chatlog??msg?.raw?.chat??msg?.raw;
 const roots=[...(msg?.attachmentsRaw||[]),msg?.message?.attachment,raw?.attachment,raw?.extra];
 if(Number(msg?.message?.type??msg?.type)===26){
  for(let root of roots){
   root=parse(root);
   for(const v of Array.isArray(root)?root:[root]){
    const log=id(v?.src_logId??v?.srcLogId);
    if(log)return {log,author:id(v?.src_userId??v?.srcUserId)};
   }
  }
 }
 const log=id(raw?.threadId??raw?.tid??raw?.thread??msg?.message?.threadId??msg?.threadId);
 return log?{log,author:''}:null;
}
function observe(msg){
 const room=id(msg?.room?.id),log=id(msg?.message?.logId??msg?.logId??msg?.raw?.chatLog?.logId);
 if(!room||!log)return;
 recent.set(room+':'+log,{msg,at:Date.now()});
 if(recent.size>3000)recent.delete(recent.keys().next().value);
}
async function handle({client,chat,msg,roomId,senderId,text,isBotAccount}){
 if(text!=='삭제'&&text!=='!삭제')return false;
 const ref=reference(msg);
 if(!ref){console.warn('[REPLY DELETE] no reply reference',String(roomId));return true;}
 const type=Number(msg?.sender?.type);
 let authorized=isBotAccount||type===1||type===4;
 if(!authorized){try{authorized=await isRoomBotAdmin(roomId,senderId);}catch(e){console.error('[REPLY DELETE] admin check error',e);}}
 if(!authorized)return true;
 const send=typeof chat?.sendText==='function'?chat.sendText.bind(chat):client?.sendText?.bind(client);
 const fail=async reason=>{console.warn('[REPLY DELETE]',reason,String(roomId),ref.log);if(send)await send(roomId,'❌ '+reason);};
 const target=recent.get(String(roomId)+':'+ref.log);
 const botId=id(client?.userId);
 const observedAuthor=id(target?.msg?.sender?.id??target?.msg?.senderId);
 // Never delete a message unless the reply or the cached original proves it belongs to the bot.
 const isOwn=!!botId&&(ref.author===botId||observedAuthor===botId);
 if(isOwn){
  const del=typeof chat?.deleteMessage==='function'?chat.deleteMessage.bind(chat):client?.deleteMessage?.bind(client);
  if(!del)return fail('현재 KakaoForge에 deleteMessage 기능이 없습니다.'),true;
  try{
   const fetch=typeof chat?.fetchMessage==='function'?chat.fetchMessage.bind(chat):client?.fetchMessage?.bind(client);
   const original=target?.msg||(fetch?await fetch(roomId,ref.log):null);
   if(!original){await fail('원본 메시지를 조회할 수 없습니다.');return true;}
   const result=await del(roomId,original);
   if(result===false||result?.success===false||result?.ok===false||(typeof result?.status==='number'&&result.status!==0))throw Error('status='+String(result?.status));
   recent.delete(String(roomId)+':'+ref.log);
   console.log('[REPLY DELETE] bot message deleted',String(roomId),ref.log);
  }catch(error){console.error('[REPLY DELETE] deleteMessage failed',error);await fail('봇 메시지 삭제에 실패했습니다. Railway 로그를 확인해 주세요.');}
  return true;
 }
 if(!target){await fail('원본 메시지 기록이 없습니다. 봇 메시지라면 원본 작성자 정보가 포함된 답장이 필요합니다.');return true;}
 const blind=typeof chat?.openChatBlind==='function'?chat.openChatBlind.bind(chat):client?.openChatBlind?.bind(client);
 if(!blind){await fail('메시지 가리기 기능을 사용할 수 없습니다.');return true;}
 try{
  const result=await blind(roomId,target.msg,{report:false});
  if(result===false||result?.success===false||result?.ok===false||(typeof result?.status==='number'&&result.status!==0))throw Error('status='+String(result?.status));
  recent.delete(String(roomId)+':'+ref.log);
  console.log('[REPLY DELETE] original blinded',String(roomId),ref.log);
 }catch(error){console.error('[REPLY DELETE] blind failed',error);await fail('원본 메시지 가리기에 실패했습니다.');}
 return true;
}
module.exports={observe,handle};
