'use strict';
// Supplement legacy join-template placeholders without changing leave templates.
function format(template,{name,uid,roomName,profileLink,client,roomId,base}={}){
 const id=String(uid??'').trim(),display=String(name??'알 수 없음').replace(/[\u0002-\u0004]/g,'').trim();
 let marker='';
 if(id&&/^\d+$/.test(id)){
  try{
   if(typeof client?.chat?.mention==='function')marker=client.chat.mention(id,display,roomId);
   else if(typeof client?.mention==='function')marker=client.mention(id,display,roomId);
  }catch(_){}
  if(typeof marker!=='string'||!marker.startsWith('\u0002')||!marker.includes('\u0003')||!marker.endsWith('\u0004'))
   marker='\u0002'+id+'\u0003'+display+'\u0004';
 }
 const raw=String(template??'');
 // Hide unverified URLs rather than inserting arbitrary profile data.
 const url=typeof profileLink==='string'&&/^https:\/\/open\.kakao\.com\/o\/[a-zA-Z0-9]+(?:\/)?$/.test(profileLink.trim())
  ?profileLink.trim():'확인 불가';
 const replaced=raw.replace(/\((멘션|아이디|옾링)\)/g,(_,key)=>({
  멘션:marker||'@'+display,아이디:id||'확인 불가',옾링:url
 })[key]);
 return typeof base==='function'?base(replaced,{name,uid,roomName}):replaced;
}
module.exports={format};
