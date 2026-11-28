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
function threadReference(msg){
 const raw=msg?.raw?.chatLog??msg?.raw?.chatlog??msg?.raw?.chat??msg?.raw;
 const thread=exact(raw?.threadId??raw?.tid??raw?.thread??msg?.raw?.threadId??msg?.message?.threadId??msg?.threadId);
 return thread?{logId:thread}:null;
}
function quotedReference(msg){
 if(Number(msg?.message?.type??msg?.type)!==26)return null;
 for(const v of roots(msg)){
  const source=v.reply??v.quote??v.replyTo??v;
  const userId=exact(source.src_userId??source.srcUserId??source.src_user_id??(source!==v?source.userId:undefined));
  const logId=exact(source.src_logId??source.srcLogId??source.src_log_id??(source!==v?source.logId:undefined));
  if(userId||logId)return {userId,logId};
 }
 return null;
}
function reference(msg){return threadReference(msg)||quotedReference(msg);}
function directMessageReference(msg){return quotedReference(msg)||threadReference(msg);}
function mentions(msg){
 const lists=[msg?.mentions,msg?.message?.mentions,msg?.message?.mentionList,...roots(msg).map(v=>v.mentions)];
 const found=new Map();
 for(const list of lists)if(Array.isArray(list))for(const v of list){
  const id=exact(v.userId??v.user_id??v.id??v.memberId);
  if(id)found.set(id,{id,name:String(v.name??v.nickname??v.nickName??'')});
 }
 return [...found.values()];
}

// Direct ID or one real mention; replies resolve the original root author,
// never an intermediate replier or the bot's notice author.
async function resolveTarget({msg,args,roomId,noticeTarget,fetchMessage,maxDepth=12}){
 const tagged=mentions(msg),first=reference(msg);
 if(tagged.length>1)return null;
 if(args.length&&/^[1-9]\d{3,}$/.test(args[0])&&args.length===1){
  if(tagged.length||first)return null;
  return {id:exact(args[0]),name:''};
 }
 if(tagged.length===1){if(first)return null;return tagged[0];}
 if(args.length||!first?.logId)return null;
 const seen=new Set();let log=first.logId;
 for(let depth=0;depth<maxDepth;depth++){
  if(seen.has(log))return null;seen.add(log);
  const mapped=noticeTarget(log);if(mapped)return mapped;
  if(typeof fetchMessage!=='function')return null;
  let item;try{item=await fetchMessage(roomId,log);}catch{return null;}
  if(!item||exact(item.room?.id??item.chatId)!==roomId||exact(item.message?.logId??item.logId)!==log)return null;
  const next=reference(item);
  if(next?.logId){log=next.logId;continue;}
  if(next?.userId||Number(item.message?.type??item.type)===26)return null;
  const uid=exact(item.sender?.id??item.senderId);
  return uid?{id:uid,name:String(item.sender?.name??'')}:null;
 }
 return null;
}
module.exports={resolveTarget,mentions,reference,directMessageReference};
