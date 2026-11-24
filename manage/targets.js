'use strict';
const JSONExact=require('lossless-json');
function exact(v){
 if(typeof v==='number')return Number.isSafeInteger(v)&&v>=1000?String(v):'';
 if(typeof v==='bigint')return v>=1000n?String(v):'';
 if(typeof v==='string')return /^\d{4,}$/.test(v)?v:'';
 if(v&&typeof v==='object')return exact(typeof v.value==='string'?v.value:v.toString());
 return '';
}
function roots(msg){
 const raw=msg?.raw?.chatLog??msg?.raw?.chatlog??msg?.raw?.chat??msg?.raw;
 return [...(msg?.attachmentsRaw||[]),msg?.message?.attachment,raw?.attachment,raw?.extra].flatMap(v=>{
  if(typeof v==='string'){try{v=JSONExact.parse(v)}catch{return [];}}
  return Array.isArray(v)?v:v&&typeof v==='object'?[v]:[];
 });
}
function reference(msg){
 const raw=msg?.raw?.chatLog??msg?.raw?.chatlog??msg?.raw?.chat??msg?.raw;
 const thread=exact(raw?.threadId??raw?.tid??raw?.thread??msg?.raw?.threadId??msg?.message?.threadId??msg?.threadId);
 if(thread)return {logId:thread};
 if(Number(msg?.message?.type??msg?.type)!==26)return null;
 for(const v of roots(msg)){
  const source=v.reply??v.quote??v.replyTo??v;
  const userId=exact(source.src_userId??source.srcUserId??source.src_user_id??(source!==v?source.userId:undefined));
  const logId=exact(source.src_logId??source.srcLogId??source.src_log_id??(source!==v?source.logId:undefined));
  if(userId||logId)return {userId,logId};
 }
 return null;
}
function mentions(msg){
 const lists=[msg?.mentions,msg?.message?.mentions,msg?.message?.mentionList,...roots(msg).map(v=>v.mentions)];
 const found=new Map();
 for(const list of lists)if(Array.isArray(list))for(const v of list){
  const id=exact(v.userId??v.user_id??v.id??v.memberId);
  if(id)found.set(id,{id,name:String(v.name??v.nickname??v.nickName??'')});
 }
 return [...found.values()];
}
async function resolve({msg,text,roomId,client,db}){
 const arg=String(text||'').trim().replace(/^#\S+\s*/, '').split(/\s+/)[0];
 let target=exact(arg)?{id:exact(arg),name:''}:null;
 const tagged=mentions(msg);
 if(!target&&tagged.length>1)return null;
 if(!target&&tagged.length===1)target=tagged[0];
 if(!target){
  const ref=reference(msg);if(!ref)return null;
  if(ref.logId&&client?.userId!=null){
   const notice=await db.query('SELECT target_id,target_name FROM gl_leave_replies WHERE room_id=$1 AND log_id=$2 AND bot_id=$3',[String(roomId),ref.logId,String(client.userId)]);
   if(notice.rows[0])target={id:exact(notice.rows[0].target_id),name:notice.rows[0].target_name};
  }
  if(!target&&ref.userId)target={id:ref.userId,name:''};
  if(!target&&ref.logId&&typeof client?.fetchMessage==='function'){
   const original=await client.fetchMessage(roomId,ref.logId);
   if(String(original?.room?.id)!==String(roomId)||exact(original.message?.logId??original.logId)!==ref.logId)return null;
   const id=exact(original.sender?.id);if(id)target={id,name:original.sender?.name||''};
  }
 }
 if(!target?.id)return null;
 if(typeof client?._resolveMemberType==='function'){
  let type=client._resolveMemberType(roomId,target.id);
  if(!type&&typeof client._ensureMemberType==='function'){await client._ensureMemberType(roomId,target.id);type=client._resolveMemberType(roomId,target.id);}
  target.type=Number(type)||0;
 }
 if(!target.name){
  const named=await db.query('SELECT name FROM hz_members WHERE room_id=$1 AND user_id=$2 LIMIT 1',[String(roomId),target.id]);
  target.name=named.rows[0]?.name||target.id;
 }
 return target;
}

// Resolve an !내풀 reply to the original author, not the latest replier.
// A destructive command must never fall back to a middle reply's src_userId.
async function resolveRoot({msg,roomId,client,db,maxDepth=12}){
 const first=reference(msg);
 if(!first?.logId)return null;
 const room=String(roomId),bot=exact(client?.userId);
 const noticeTarget=async log=>{
  if(!bot||typeof db?.query!=='function')return null;
  const result=await db.query(
   'SELECT target_id,target_name FROM gl_leave_replies WHERE room_id=$1 AND log_id=$2 AND bot_id=$3',
   [room,log,bot]);
  const r=result.rows?.[0],id=exact(r?.target_id);
  return id?{id,name:String(r.target_name||id)}:null;
 };
 // Reply directly to a registered bot leave notice: the DB identifies its
 // original subject even when the chat message has fallen out of history.
 const directNotice=await noticeTarget(first.logId);
 if(directNotice)return directNotice;
 if(typeof client?.fetchMessage!=='function')return null;
 const seen=new Set();
 let log=first.logId;
 for(let depth=0;depth<maxDepth;depth++){
  if(seen.has(log))return null;
  seen.add(log);
  let item;
  try{item=await client.fetchMessage(roomId,log);}
  catch{return null;}
  if(!item)return null;
  const actualRoom=exact(item.room?.id??item.roomId??item.chatId);
  const actualLog=exact(item.message?.logId??item.logId??item.raw?.chatLog?.logId??item.raw?.chatlog?.logId);
  if((actualRoom&&actualRoom!==room)||actualLog!==log)return null;
  const next=reference(item);
  if(next?.logId){
   if(seen.has(next.logId))return null;
   log=next.logId;continue;
  }
  // The source is another reply but its quoted log ID is missing.
  // In that case, the original author is unverifiable: refuse the kick.
  if(next?.userId||[Number(item.message?.type),Number(item.type),
    Number(item.raw?.chatLog?.type),Number(item.raw?.chatlog?.type)].includes(26))
   return null;
  const mapped=await noticeTarget(log);
  if(mapped)return mapped;
  const id=exact(item.sender?.id??item.senderId??item.userId);
  return id?{id,name:String(item.sender?.name??item.sender?.nickname??id)}:null;
 }
 return null; // Excessive or malformed reply chains must never kick anyone.
}
module.exports={exact,roots,reference,mentions,resolve,resolveRoot};
