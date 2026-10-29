'use strict';
const {Long}=require('bson');
const {isLosslessNumber}=require('lossless-json');

// Never turn an already rounded JS number into an apparently valid ID.
function id(value){
 if(typeof value==='number'&&!Number.isSafeInteger(value))return null;
 if(value!=null&&typeof value==='object'&&!Long.isLong(value)&&!isLosslessNumber(value))return null;
 const text=String(value??'');
 return /^[1-9]\d*$/.test(text)?text:null;
}
function original(msg){
 const raw=msg?.raw?.chatLog??msg?.raw??{};
 const rawId=id(raw.logId??raw.id??raw.msgId);
 const eventId=id(msg?.message?.logId??msg?.logId??msg?.message?.id??msg?.id);
 const rawRoom=id(raw.chatRoomId??raw.chatId??msg?.raw?.chatId);
 const eventRoom=id(msg?.room?.id??msg?.chatId);
 return {
  roomId:rawRoom??eventRoom,messageId:rawId??eventId,
  userId:id(raw.userId??raw.authorId??raw.senderId??msg?.sender?.id??msg?.senderId),
  userName:msg?.sender?.name,text:raw.message??raw.msg??raw.text??msg?.message?.text??msg?.text,
  // Only comparisons and field presence go to diagnostics, never identifiers or content.
  comparison:{rawId:!!rawId,eventId:!!eventId,idLogMatch:id(raw.id)&&id(raw.logId)?id(raw.id)===id(raw.logId):null,idMatch:rawId&&eventId?rawId===eventId:null,
   roomMatch:rawRoom&&eventRoom?rawRoom===eventRoom:null}
 };
}
function safeError(error){return /^[A-Z0-9_]{2,40}$/.test(error?.code||'')?error.code:'UNCLASSIFIED';}
module.exports={id,original,safeError};
