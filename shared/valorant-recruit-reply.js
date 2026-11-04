'use strict';
// Only use a fetched, room-verified Kakao reply source to locate a recruiting owner.
// Never infer a target from unverified quoted text or an arbitrary message ID.
const {reference}=require('./reply-delete');
const {info}=require('./reply-delete');
const {exact}=require('../manage/targets');
function clean(v){return String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();}
function commandFrom(text){
 const s=clean(text);
 if(s.startsWith('!듀오모집 '))return 'duo';
 if(/^!파티모집\s+(2|3|5)(?:\s|$)/.test(s))return 'party';
 if(s.startsWith('✅ 듀오 모집 등록'))return 'duo';
 if(/^✅ .+님의 (2|3|5)인 파티/.test(s))return 'party';
 return '';
}
function botOwner(text){
 const m=/모집자 ID:\s*([1-9]\d{3,})/.exec(String(text||''));
 return m?m[1]:'';
}
async function resolve({msg,client,roomId,botId}){
 const ref=reference(msg);
 if(!ref?.log||typeof client?.fetchMessage!=='function')return null;
 let original;
 try{original=await client.fetchMessage(roomId,ref.log);}
 catch(error){console.warn('[RECRUIT REPLY FETCH]',String(error?.code||'FETCH_FAILED'));return null;}
 const meta=info(original);
 if(meta.room!==String(roomId)||meta.log!==String(ref.log)||!meta.author)return null;
 if(ref.author&&ref.author!==meta.author)return null;
 const body=String(original?.message?.text??original?.text??'');
 const kind=commandFrom(body);
 if(!kind)return null;
 const isBot=meta.author===String(botId??client.userId??'');
 const owner=isBot?botOwner(body):exact(meta.author);
 if(!owner)return null;
 return {kind,owner,sourceLog:meta.log};
}
function marker(chat,roomId,id,name){
 const display=clean(name).slice(0,35)||id;
 if(typeof chat?.mention==='function'){
  try{
   const token=chat.mention(String(id),display,roomId);
   if(typeof token==='string'&&token.startsWith('\u0002')&&token.includes('\u0003')&&token.endsWith('\u0004'))return token;
  }catch(e){console.warn('[RECRUIT MENTION]',String(e?.code||'MENTION_FAILED'));}
 }
 return '\u0002'+id+'\u0003'+display.replace(/[\u0002-\u0004]/g,'')+'\u0004';
}
async function alertOwner({chat,roomId,send,ownerId,ownerName,applicantName,kind}){
 const target=marker(chat,roomId,ownerId,ownerName);
 const noun=kind==='party'?'파티 참가':'듀오 신청';
 await send(target+'님, '+clean(applicantName).slice(0,35)+'님이 '+noun+'을 했습니다.');
}
module.exports={resolve,alertOwner,commandFrom,marker};
