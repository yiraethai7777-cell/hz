'use strict';
const fs=require('node:fs'),path=require('node:path');
const id=v=>typeof v==='number'&&!Number.isSafeInteger(v)?'':/^[1-9]\d*$/.test(String(v??''))?String(v):'';
const empty=()=>({lastJoin:null,rejoins:0,chats:0,kicks:0,releases:0,presence:null});
function createActivity({dir,onPersist=()=>{},allowedRooms=null,botId=()=>'',now=Date.now,logger=console,intervalMs=2000}={}){
 const folder=dir?path.join(dir,'activity'):null,rooms=new Map(),dirty=new Set(),seen=new Map();
 if(folder)fs.mkdirSync(folder,{recursive:true,mode:0o700});
 function getRoom(r){
  if(rooms.has(r)){const s=rooms.get(r);rooms.delete(r);rooms.set(r,s);return s;}
  let s={users:{}};if(folder)try{s=JSON.parse(fs.readFileSync(path.join(folder,r+'.json'),'utf8'));if(!s.users||typeof s.users!=='object')throw Error('invalid activity');}catch(e){if(e.code!=='ENOENT')throw e;}
  rooms.set(r,s);return s;
 }
 function permitted(r,u){return !!(id(r)&&id(u)&&u!==id(botId())&&(!allowedRooms||allowedRooms.has(r)));}
 function update(r,u,fn){
  if(!permitted(r,u))return;
  try{const s=getRoom(r),row=s.users[u]||empty();if(fn(row)===false)return;s.users[u]=row;if(folder)dirty.add(r);}catch(e){logger.error('[DUKE] activity update failed',e?.name||'Error');}
 }
 function duplicate(key){if(!key)return false;if(seen.has(key))return true;seen.set(key,true);if(seen.size>10000)seen.delete(seen.keys().next().value);return false;}
 function chat(msg,e){
  const r=id(e.roomId),u=id(e.userId),type=Number(msg?.message?.type??msg?.type);
  if(msg?.room?.isOpenChat!==true||!Number.isFinite(type)||type<=0||!permitted(r,u))return;
  const log=id(msg?.message?.logId??msg?.logId);if(!log||duplicate(r+':chat:'+log))return;
  update(r,u,row=>{row.chats++;});
 }
 function member(kind,event){
  const r=id(event?.room?.id??event?.chatId);
  if(event?.room?.isOpenChat!==true||!r)return;
  const list=Array.isArray(event.members)&&event.members.length?event.members:(event.member?.ids||[]).map(id=>({id}));
  const log=id(event.message?.message?.logId??event.message?.logId??event.raw?.chatLog?.logId??event.raw?.logId),at=now();
  for(const u of new Set(list.map(x=>id(x?.id)))){
   if(!permitted(r,u)||duplicate(log?r+':'+kind+':'+log+':'+u:''))continue;
   update(r,u,row=>{
    if(kind==='join'){if(row.presence==='in')return false;if(row.presence==='out')row.rejoins++;row.lastJoin=at;row.presence='in';}
    else if(kind==='leave'){if(row.presence==='out')return false;row.presence='out';}
   });
  }
 }
 function moderation(r,u,kind){if(!['kick','release'].includes(kind))return;update(r,u,row=>{if(kind==='kick')row.kicks++;else row.releases++;});}
 function flush(){
  if(!folder)return;
  for(const r of dirty){try{const file=path.join(folder,r+'.json'),tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(rooms.get(r)),{mode:0o600});fs.renameSync(tmp,file);onPersist('activity/'+r+'.json');dirty.delete(r);}catch(e){logger.error('[DUKE] activity flush failed',e?.name||'Error');}}
  while(rooms.size>128){const r=[...rooms.keys()].find(k=>!dirty.has(k));if(!r)break;rooms.delete(r);}
 }
 const timer=folder?setInterval(flush,intervalMs):null;timer?.unref();
 return {chat,member,moderation,get:(r,u)=>({...empty(),...getRoom(r).users[u]}),flush,close(){if(timer)clearInterval(timer);flush();}};
}
module.exports={createActivity};
