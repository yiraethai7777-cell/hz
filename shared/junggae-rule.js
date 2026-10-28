'use strict';
const {roots,exact}=require('../manage/targets');
function matches(text,msg){
 const s=String(text||'').normalize('NFKC').trim();
 if(!s||s.length>4000||/^[!#]/.test(s)||/템\s*맡/.test(s))return false;
 const type=Number(msg?.sender?.type);
 // Unknown role is not evidence that the sender is a non-manager.
 if(type!==1&&type!==2)return false;
 const original=String(text||'');
 const lists=[msg?.mentions,msg?.message?.mentions,msg?.message?.mentionList,...roots(msg).map(v=>v.mentions)];
 const ats=[...original.matchAll(/@/g)].map(m=>m.index);
 const spans=[],users=new Set();
 for(const list of lists)if(Array.isArray(list))for(const v of list){
  const id=exact(v.userId??v.user_id??v.id??v.memberId);if(!id)continue;
  let found=false;
  const positions=Array.isArray(v.at)?v.at:[v.at];
  for(const ordinal of positions){
   const n=Number(ordinal),len=Number(v.len??v.length),start=ats[n-1];
   if(Number.isInteger(n)&&n>=1&&Number.isInteger(len)&&len>0&&start!==undefined&&start+len+1<=original.length){spans.push([start,start+len+1]);found=true;}
  }
  // Some adapters expose names instead of protocol at/len metadata.
  if(!found){
   const name=String(v.name??v.nickname??v.nickName??'').replace(/^@/,'');
   if(name){const token='@'+name;let start=original.indexOf(token);while(start!==-1){const end=start+token.length;if(end===original.length||/\s/.test(original[end])){spans.push([start,end]);found=true;}start=original.indexOf(token,start+token.length);}}
  }
  if(found)users.add(id);
 }
 if(users.size<2)return false;
 const chars=original.split('');for(const [start,end]of spans)for(let i=start;i<end;i++)chars[i]=' ';
 return /[\p{L}\p{N}]/u.test(chars.join(''));
}
module.exports={matches};
