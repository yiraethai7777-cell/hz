'use strict';
// KakaoForge reply metadata adapter: the NEXI skin logic remains unchanged.
const {reference}=require('../replies');
const stringId=x=>x==null?'':String(x);
function info(msg){const raw=msg?.raw?.chatLog??msg?.raw?.chatlog??msg?.raw?.chat??msg?.raw;return {room:stringId(msg?.room?.id??msg?.chatId??raw?.chatRoomId??raw?.chatId),log:stringId(msg?.message?.logId??msg?.logId??raw?.logId??raw?.id),author:stringId(msg?.sender?.id??msg?.senderId??raw?.userId??raw?.authorId)};}
module.exports={reference,info};
