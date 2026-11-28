'use strict';
const id=v=>typeof v==='number'&&!Number.isSafeInteger(v)?'':/^[1-9]\d*$/.test(String(v??''))?String(v):'';
function inspectHideReadback(response,room,log,author){
 const r=id(room),l=id(log),u=id(author),body=response?.body;
 if(!r||!l||response?.status!==0||!body||body.status!=null&&Number(body.status)!==0)return {state:'unavailable'};
 const responseRoom=id(body.chatId??body.chatRoomId??body.roomId??body.c);
 if(responseRoom&&responseRoom!==r)return {state:'mismatch'};
 const source=body.chatLogs??body.chatLog??body.logs??body.msgs??body.messages;
 const entries=Array.isArray(source)?source:source&&typeof source==='object'?[source]:[];
 const records=entries.map(x=>x?.chatLog??x).filter(x=>x&&id(x.logId??x.msgId??x.id)===l);
 if(records.length!==1)return {state:records.length?'ambiguous':'missing'};
 const raw=records[0],recordRoom=id(raw.chatId??raw.chatRoomId??raw.roomId??raw.c);
 const recordAuthor=id(raw.authorId??raw.userId??raw.senderId);
 if(recordRoom&&recordRoom!==r||u&&recordAuthor&&recordAuthor!==u)return {state:'mismatch'};
 // Only server-owned metadata, never JSON supplied in the message or attachment.
 const flags=[raw.hidden,raw.isHidden,raw.isBlinded].filter(v=>typeof v==='boolean');
 const state=flags.includes(true)&&flags.includes(false)?'ambiguous':flags.includes(true)?'hidden':flags.includes(false)?'visible':'unknown';
 return {state,messageType:Number.isSafeInteger(Number(raw.type??raw.msgType))?Number(raw.type??raw.msgType):null,hasAuthor:!!recordAuthor,hasRoom:!!(recordRoom||responseRoom),hasMessage:typeof(raw.message??raw.msg??raw.text)==='string',hasAttachment:raw.attachment!=null||raw.attachments!=null||raw.extra!=null,hasHiddenFlag:flags.length>0};
}
module.exports={inspectHideReadback};
