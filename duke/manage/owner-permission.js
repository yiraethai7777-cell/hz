'use strict';
function id(v){if(typeof v==='number'&&!Number.isSafeInteger(v))return '';const s=String(v??'');return /^[1-9]\d*$/.test(s)?s:'';}
// Same SDK sender.type mapping as existing moderation (1=room owner, 4=cohost).
function canConfigure(e,botId){
 const actor=id(e?.userId),bot=id(botId());
 if(!actor||!bot||!id(e?.roomId)||e?.msg?.room?.isOpenChat!==true)return false;
 if(actor===bot)return true;
 const sender=id(e.msg.sender?.id);
 if(sender&&sender!==actor)return false;
 return Number(e.msg.sender?.type)===1;
}
module.exports={canConfigure};
