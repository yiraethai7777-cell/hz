'use strict';
const lossless=require('lossless-json');
const id=v=>typeof v==='number'&&!Number.isSafeInteger(v)?'':/^[1-9]\d*$/.test(String(v??''))?String(v):'';
function createHideConfirmation({request,timeoutMs=8000,logger=console}){
 const pending=new Map();
 function observe(event){
  if(event?.type!=='hide'||event.hidden===false||event.room?.isOpenChat!==true)return false;
  const body=event.raw?.body??{},raw=body.chatLog??body.chatlog??body;
  const room=id(body.chatId??body.c??body.roomId??body.chatRoomId??raw.chatId??raw.chatRoomId??raw.c);
  const log=id(event.message?.logId??event.logId);
  if(!room||room!==id(event.room.id)||!log)return false;
  const method=String(event.raw?.method??'').toUpperCase();
  if(event.hidden!==true&&!['BLIND','BLINDMSG','HIDEMSG','HIDE'].includes(method))return false;
  const slot=pending.get(room+':'+log);
  if(!slot)return false;
  slot.finish(true);return true;
 }
 function observePush(packet){
  const method=String(packet?.method??'').toUpperCase();
  if(!['BLIND','BLINDMSG','HIDEMSG','HIDE','SYNCREWR','SYNCMODMSG'].includes(method))return false;
  const body=packet?.body??{},raw=body.chatLog??body.chatlog??body.modifiedChatLog??body;
  const room=id(body.chatId??body.c??body.roomId??body.chatRoomId??raw.chatId??raw.chatRoomId??raw.c);
  if(!room)return false;
  let info=raw.message??raw.msg??raw.text;
  if(typeof info==='string'){try{info=lossless.parse(info);}catch{info=null;}}
  const records=Array.isArray(info?.chatLogInfos)?info.chatLogInfos:[];
  const explicit=info?.hidden??body.hidden??raw.hidden;
  if(explicit===false)return false;
  const ids=[info?.logId,...records.map(x=>x?.logId??x?.l),body.targetLogId,body.logId,raw.targetLogId].map(id).filter(Boolean);
  const matched=[...new Set(ids)].filter(log=>pending.has(room+':'+log));
  if(explicit!==true&&!['BLINDMSG','HIDEMSG','HIDE'].includes(method))return false;
  if(packet.status!=null&&Number(packet.status)!==0||body.status!=null&&Number(body.status)!==0)return false;
  // Observe genuine manual-hide notifications too, without logging IDs or text.
  logger.info?.('[DUKE HIDE PUSH]',JSON.stringify({method,explicit:explicit===true,hasTarget:ids.length>0,hasRecords:records.length>0,matched:matched.length>0}));
  if(!matched.length)return false;
  for(const log of matched)pending.get(room+':'+log)?.finish(true);
  return true;
 }
 async function hide(room,msg){
  const r=id(room),l=id(msg?.message?.logId??msg?.logId);
  if(!r||!l||id(msg?.room?.id)!==r||pending.has(r+':'+l))return {status:-1,verified:false};
  const key=r+':'+l;
  let timer,finish,finished=false;
  const confirmation=new Promise(resolve=>{finish=value=>{if(finished)return;finished=true;clearTimeout(timer);pending.delete(key);resolve(value);};pending.set(key,{finish});});
  try{
   const result=await request(r,msg);
   if(result?.status!==0||result?.body?.status!=null&&Number(result.body.status)!==0||result?.success===false||result?.ok===false){finish(false);logger.warn?.('[DUKE HIDE RESULT]',JSON.stringify({ack:false,status:Number.isFinite(Number(result?.status))?Number(result.status):null,bodyStatus:result?.body?.status!=null&&Number.isFinite(Number(result.body.status))?Number(result.body.status):null}));return {status:-1,verified:false};}
   // Keep the listener active during the request; allow a full confirmation window after ACK.
   if(!finished)timer=setTimeout(()=>finish(false),timeoutMs);
   const verified=await confirmation;
   logger.info?.('[DUKE HIDE RESULT]',JSON.stringify({ack:true,verified}));
   return {status:0,verified};
  }catch(error){finish(false);logger.warn?.('[DUKE HIDE RESULT]',JSON.stringify({ack:false,error:String(error?.name||'Error'),status:String(error?.message||'').match(/^BLIND failed: status=(-?\d+)$/)?.[1]??null}));throw error;}
 }
 function reset(){for(const slot of pending.values())slot.finish(false);}
 return {observe,observePush,hide,reset};
}
module.exports={createHideConfirmation};
