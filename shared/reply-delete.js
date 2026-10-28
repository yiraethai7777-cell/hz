'use strict';
const {isRoomBotAdmin}=require('./room-bot-admin');
const recent=new Map();
function id(v){if(typeof v==='bigint')return v>0n?String(v):'';if(typeof v==='number')return Number.isSafeInteger(v)&&v>0?String(v):'';return typeof v==='string'&&/^[1-9]\\d*$/.test(v)?v:'';}
function parse(v){if(typeof v!=='string')return v;try{return require('lossless-json').parse(v);}catch{return null;}}
function sourceId(msg){
 const raw=msg?.raw?.chatLog??msg?.raw?.chatlog??msg?.raw?.chat??msg?.raw;
 const roots=[...(msg?.attachmentsRaw||[]),msg?.message?.attachment,raw?.attachment,raw?.extra];
 if(Number(msg?.message?.type??msg?.type)===26){
  for(let root of roots){root=parse(root);for(const v of Array.isArray(root)?root:[root]){
   const log=id(v?.src_logId??v?.srcLogId);if(log)return log;
  }}
 }
 return id(raw?.threadId??raw?.tid??msg?.message?.threadId??msg?.threadId);
}
function observe(msg){
 const room=id(msg?.room?.id),log=id(msg?.message?.logId??msg?.logId??msg?.raw?.chatLog?.logId);
 if(!room||!log)return;
 const key=room+':'+log;
 recent.set(key,{msg,at:Date.now()});
 if(recent.size>3000){const oldest=recent.keys().next().value;recent.delete(oldest);}
}
async function handle({client,chat,msg,roomId,senderId,text,isBotAccount}){
 if(text!=='삭제'&&text!=='!삭제')return false;
 const source=sourceId(msg);
 if(!source){console.warn('[REPLY DELETE] reply source not found',{roomId:String(roomId),type:msg?.message?.type??msg?.type});return true;}
 const type=Number(msg?.sender?.type);
 let authorized=isBotAccount||type===1||type===4;
 if(!authorized){try{authorized=await isRoomBotAdmin(roomId,senderId);}catch(e){console.error('[REPLY DELETE] admin lookup failed',e);}}
 if(!authorized)return true;
 const send=typeof chat?.sendText==='function'?chat.sendText.bind(chat):client?.sendText?.bind(client);
 const target=recent.get(String(roomId)+':'+source);
 if(!target){console.warn('[REPLY DELETE] original not cached',{roomId:String(roomId),source});if(send)await send(roomId,'❌ 원본 메시지 기록이 없습니다. 봇이 보낸 메시지 또는 재시작 전 메시지는 현재 가릴 수 없습니다.');return true;}
 const blind=typeof chat?.openChatBlind==='function'?chat.openChatBlind.bind(chat):client?.openChatBlind?.bind(client);
 if(!blind){if(send)await send(roomId,'❌ 메시지 가리기 기능을 사용할 수 없습니다.');return true;}
 try{
  const result=await blind(roomId,target.msg,{report:false});
  if(result===false||result?.success===false||result?.ok===false||(typeof result?.status==='number'&&result.status!==0))throw Error('status='+String(result?.status));
  recent.delete(String(roomId)+':'+source);
  console.log('[REPLY DELETE] blind success',String(roomId),source);
 }catch(error){console.error('[REPLY DELETE] blind failed',error);if(send)await send(roomId,'❌ 원본 메시지 가리기에 실패했습니다.');}
 return true;
}
module.exports={observe,handle};
