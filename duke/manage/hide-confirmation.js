'use strict';
const lossless=require('lossless-json');
const id=v=>typeof v==='number'&&!Number.isSafeInteger(v)?'':/^[1-9]\d*$/.test(String(v??''))?String(v):'';
function createHideConfirmation({request,readback,timeoutMs=8000,logger=console}){
 const pending=new Map();
 let manualAt=0,manualBusy=false,generation=0;
 async function checkReadback(room,log,author,source,originalType){
  if(typeof readback!=='function')return {state:'unavailable'};
  try{const result=await readback(room,log,author,originalType);logger.info?.('[DUKE HIDE READBACK]',JSON.stringify({source,...result}));return result;}
  catch(error){logger.warn?.('[DUKE HIDE READBACK]',JSON.stringify({source,state:'unavailable',error:String(error?.name||'Error')}));return {state:'unavailable'};}
 }
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
  // node-kakao identifies the server's OpenLink rewrite feed as feedType 13.
  // Require a system feed and exact target; ordinary user JSON cannot confirm hiding.
  const rewriteFeed=method==='SYNCREWR'&&raw.type!=null&&Number(raw.type)===0&&Number(info?.feedType)===13&&!!id(info?.logId);
  if((method==='SYNCREWR'||method==='SYNCMODMSG')&&raw.type!=null&&Number(raw.type)!==0)return false;
  const explicit=rewriteFeed?true:(info?.hidden??body.hidden??raw.hidden);
  if(explicit===false)return false;
  const ids=[info?.logId,...records.map(x=>x?.logId??x?.l),body.targetLogId,raw.targetLogId,...(!['SYNCREWR','SYNCMODMSG'].includes(method)?[body.logId]:[])].map(id).filter(Boolean);
  const matched=[...new Set(ids)].filter(log=>pending.has(room+':'+log));
  if(explicit!==true&&!['BLINDMSG','HIDEMSG','HIDE'].includes(method))return false;
  if(packet.status!=null&&Number(packet.status)!==0||body.status!=null&&Number(body.status)!==0)return false;
  // Observe genuine manual-hide notifications too, without logging IDs or text.
  logger.info?.('[DUKE HIDE PUSH]',JSON.stringify({method,explicit:explicit===true,hasTarget:ids.length>0,hasRecords:records.length>0,matched:matched.length>0}));
  if(!matched.length){
   // Compare a real manual-hide sample, rate-limited globally. Do not fetch
   // arbitrary text or a feed ID: require an explicit single target.
   const targets=[...new Set([info?.logId,...records.map(x=>x?.logId??x?.l),body.targetLogId,raw.targetLogId].map(id).filter(Boolean))];
   if(explicit===true&&targets.length===1&&typeof readback==='function'&&!manualBusy&&Date.now()-manualAt>=30000){
    manualAt=Date.now();manualBusy=true;
    void checkReadback(room,targets[0],undefined,'manual-event').finally(()=>{manualBusy=false;});
   }
   return false;
  }
  for(const log of matched)pending.get(room+':'+log)?.finish(true);
  return true;
 }
 async function hide(room,msg){
  const r=id(room),l=id(msg?.message?.logId??msg?.logId);
  if(!r||!l||id(msg?.room?.id)!==r||pending.has(r+':'+l))return {status:-1,verified:false};
  const key=r+':'+l,startedGeneration=generation;
  let timer,finish,finished=false;
  const confirmation=new Promise(resolve=>{finish=value=>{if(finished)return;finished=true;clearTimeout(timer);pending.delete(key);resolve(value);};pending.set(key,{finish});});
  try{
   const result=await request(r,msg);
   if(result?.status!==0||result?.body?.status!=null&&Number(result.body.status)!==0||result?.success===false||result?.ok===false){finish(false);logger.warn?.('[DUKE HIDE RESULT]',JSON.stringify({ack:false,status:Number.isFinite(Number(result?.status))?Number(result.status):null,bodyStatus:result?.body?.status!=null&&Number.isFinite(Number(result.body.status))?Number(result.body.status):null}));return {status:-1,verified:false};}
   // Keep the listener active during the request; allow a full confirmation window after ACK.
   // Try the confirmed server state immediately instead of waiting eight seconds for every message.
   const originalType=Number(msg?.message?.type??msg?.type);
   if(!finished&&generation===startedGeneration&&typeof readback==='function'){
    const state=await checkReadback(r,l,id(msg?.sender?.id??msg?.senderId),'automatic',originalType);
    if(generation===startedGeneration&&state?.state==='hidden')finish(true);
   }
   if(!finished)timer=setTimeout(()=>finish(false),timeoutMs);
   let verified=await confirmation;
   if(!verified&&generation===startedGeneration&&typeof readback==='function'){
    const state=await checkReadback(r,l,id(msg?.sender?.id??msg?.senderId),'automatic',originalType);
    verified=generation===startedGeneration&&state?.state==='hidden';
   }
   logger.info?.('[DUKE HIDE RESULT]',JSON.stringify({ack:true,verified}));
   return {status:0,verified};
  }catch(error){finish(false);logger.warn?.('[DUKE HIDE RESULT]',JSON.stringify({ack:false,error:String(error?.name||'Error'),status:String(error?.message||'').match(/^BLIND failed: status=(-?\d+)$/)?.[1]??null}));throw error;}
 }
 function reset(){generation++;for(const slot of pending.values())slot.finish(false);}
 return {observe,observePush,hide,reset};
}
module.exports={createHideConfirmation};
