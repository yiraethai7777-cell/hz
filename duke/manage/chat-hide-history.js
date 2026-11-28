'use strict';
// Fetch bounded history without emitting old messages or changing the live room cursor.
// An exact command anchor is required before any messages are eligible for moderation.
const id=v=>typeof v==='number'&&!Number.isSafeInteger(v)?'':/^[1-9]\d*$/.test(String(v??''))?String(v):'';
const failure=code=>Object.assign(Error(code),{code});
const compare=(a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0;
async function previousChats(client,roomId,anchorId,count,{excludedUsers=[]}={}){
 const room=id(roomId),anchor=id(anchorId);
 if(!room||!anchor||!Number.isInteger(count)||count<1||count>50)throw Error('invalid history request');
 if(!client?._carriage?.syncMsg)throw failure('HISTORY_UNAVAILABLE');
 let cur='0';
 const max=BigInt(anchor)<9223372036854775807n?(BigInt(anchor)+1n).toString():anchor;
 const excluded=new Set([client.userId,...excludedUsers].map(id).filter(Boolean));
 const selected=new Map();
 for(let page=0;page<30;page++){
  const res=await client._carriage.syncMsg({chatId:room,cur,max,cnt:100});
  if(!res||Number(res.status)!==0||res.body?.status!=null&&Number(res.body.status)!==0)throw failure('HISTORY_STATUS_'+String(res?.status??res?.body?.status??'missing').replace(/[^0-9-]/g,'').slice(0,12));
  const logs=res.body?.chatLogs??res.body?.logs??res.body?.messages;
  if(!Array.isArray(logs)||!logs.length)break;
  let last=cur,found=false;
  for(const log of logs){
   const logId=id(log?.logId??log?.msgId??log?.id),user=id(log?.authorId??log?.userId??log?.senderId);
   if(!logId)continue;
   const explicitRoom=log.chatId??log.chatRoomId??log.roomId;
   if(explicitRoom!=null&&id(explicitRoom)!==room)throw failure('HISTORY_ROOM_MISMATCH');
   if(compare(logId,last)>0)last=logId;
   if(logId===anchor){found=true;continue;}
   const type=Number(log?.type??log?.msgType);
   if(compare(logId,anchor)>=0||!user||excluded.has(user)||!Number.isInteger(type)||type<=0)continue;
   selected.set(logId,{log:logId,user,msg:{room:{id:room,isOpenChat:true},sender:{id:user,name:String(log.authorName??log.authorNickname??log.nickname??'')},message:{logId,type},raw:{chatId:room,chatLog:log}},hidden:false});
  }
  const rows=[...selected.values()].sort((a,b)=>compare(a.log,b.log)).slice(-count);
  selected.clear();for(const row of rows)selected.set(row.log,row);
  if(found)return rows.reverse();
  if(compare(last,cur)<=0||compare(last,anchor)>=0)break;
  cur=last;
 }
 throw failure('HISTORY_ANCHOR_NOT_FOUND');
}
module.exports={previousChats};
