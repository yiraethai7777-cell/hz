'use strict';
const id=v=>typeof v==='number'&&!Number.isSafeInteger(v)?'':/^[1-9]\d*$/.test(String(v??''))?String(v):'';
function createHideConfirmation({request,timeoutMs=3500}){
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
 async function hide(room,msg){
  const r=id(room),l=id(msg?.message?.logId??msg?.logId);
  if(!r||!l||id(msg?.room?.id)!==r||pending.has(r+':'+l))return {status:-1,verified:false};
  const key=r+':'+l;
  let timer,finish,finished=false;
  const confirmation=new Promise(resolve=>{finish=value=>{if(finished)return;finished=true;clearTimeout(timer);pending.delete(key);resolve(value);};pending.set(key,{finish});timer=setTimeout(()=>finish(false),timeoutMs);});
  try{
   const result=await request(r,msg);
   if(result?.status!==0||result?.body?.status!=null&&Number(result.body.status)!==0||result?.success===false||result?.ok===false){finish(false);return {status:-1,verified:false};}
   return {status:0,verified:await confirmation};
  }catch(error){finish(false);throw error;}
 }
 function reset(){for(const slot of pending.values())slot.finish(false);}
 return {observe,hide,reset};
}
module.exports={createHideConfirmation};
