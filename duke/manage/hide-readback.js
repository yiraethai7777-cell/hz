'use strict';
const id=v=>typeof v==='number'&&!Number.isSafeInteger(v)?'':/^[1-9]\d*$/.test(String(v??''))?String(v):'';
function inspectHideReadback(response,room,log,author,originalType){
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
 const messageType=Number(raw.type??raw.msgType);
 const previous=Number(originalType);
 // node-kakao DELETED_MESSAGE_OFFSET (0x4000). Live REWRITE readbacks
 // confirmed 1 -> 16385 for messages actually hidden by the bot.
 const covered=Number.isSafeInteger(messageType)&&messageType>=16384&&messageType<32768&&
   Number.isSafeInteger(previous)&&previous>0&&previous<16384&&messageType===previous+16384&&
   !!u&&recordAuthor===u&&(recordRoom===r||responseRoom===r);
 const state=(flags.includes(true)||covered)&&flags.includes(false)?'ambiguous':flags.includes(true)||covered?'hidden':flags.includes(false)?'visible':'unknown';
 return {state,messageType:Number.isSafeInteger(Number(raw.type??raw.msgType))?Number(raw.type??raw.msgType):null,hasAuthor:!!recordAuthor,hasRoom:!!(recordRoom||responseRoom),hasMessage:typeof(raw.message??raw.msg??raw.text)==='string',hasAttachment:raw.attachment!=null||raw.attachments!=null||raw.extra!=null,hasHiddenFlag:flags.length>0,coveredType:covered};
}
module.exports={inspectHideReadback};
