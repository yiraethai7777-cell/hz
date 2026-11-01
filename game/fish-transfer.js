'use strict';

const {FISH_TABLE}=require('./data');
const {mentionTarget,messageKey}=require('./coin');
const USAGE='사용법: !물고기전송 @멘션 (물고기 종류) (개수)\n또는 !물고기전송 @멘션 all\n예: !물고기전송 @친구 황금용어 2';
const NAMES=[...new Set(FISH_TABLE.map(x=>x.name))].sort((a,b)=>b.length-a.length);
const esc=s=>s.replace(/[^a-zA-Z0-9가-힣]/g,'\\$&');

function parse(text){
 const tail=String(text||'').trim().replace(/^#물고기전송(?:\s|$)/,'').trim();
 if(!tail.startsWith('@'))throw Error(USAGE);
 for(const name of NAMES){
  const match=new RegExp('(?:^|\\s)'+esc(name)+'\\s+(all|\\S+)$','i').exec(tail);
  if(!match)continue;
  const amount=match[1];
  if(amount.toLowerCase()==='all')return {name,all:true};
  if(!/^[1-9]\d*$/.test(amount)||!Number.isSafeInteger(Number(amount)))
   throw Error('전송 수량은 1 이상의 정수 또는 all로 입력해 주세요.');
  return {name,count:Number(amount),all:false};
 }
 if(/^@.+\s+all$/i.test(tail))return {all:true};
 throw Error(USAGE+'\n물고기 종류는 !물고기도감에서 확인해 주세요.');
}

function pick(inventory,request){
 const list=Array.isArray(inventory)?inventory:[];
 const matching=request.all&&!request.name?list:list.filter(x=>x&&x.name===request.name);
 if(!matching.length)throw Error(request.name
  ?'🐟 '+request.name+'을(를) 보유하지 않았습니다.':'🎒 전송할 물고기가 없습니다.');
 if(!request.all&&matching.length<request.count)
  throw Error('🐟 보유 수량이 부족합니다. ('+matching.length+'마리)');
 return request.all?matching.slice():matching.slice(0,request.count);
}

function move(d,fromId,toId,toName,request){
 const from=d.players?.[fromId];
 if(!from||!Array.isArray(from.inventory))throw Error('🎒 전송할 물고기가 없습니다.');
 const selected=pick(from.inventory,request);
 const removed=new Set(selected);
 const dest=d.players[toId]||(d.players[toId]={
  id:toId,name:toName||toId,points:0,level:1,xp:0,wins:0,lastFish:0,
  inventory:[],rods:['나무'],rod:'나무'
 });
 if(!Array.isArray(dest.inventory))dest.inventory=[];
 if(toName&&toName!=='멘션 사용자')dest.name=toName;
 from.inventory=from.inventory.filter(x=>!removed.has(x));
 dest.inventory.push(...selected);
 const byName=new Map();
 for(const fish of selected)byName.set(fish.name,(byName.get(fish.name)||0)+1);
 return {count:selected.length,details:[...byName].map(([n,k])=>n+' '+k+'마리'),
  senderRemaining:from.inventory.length,recipientTotal:dest.inventory.length};
}

async function handle({text,msg,roomId,userId,send}){
 if(!/^#물고기전송(?:\s|$)/.test(text))return false;
 try{
  const request=parse(text);
  const from=String(userId??msg?.sender?.id??'');
  if(!/^\d{4,}$/.test(from))throw Error('보낸 사람 ID를 확인할 수 없습니다.');
  const recipient=mentionTarget(msg);
  if(recipient.id===from)throw Error('자기 자신에게 물고기를 전송할 수 없습니다.');
  const messageId=messageKey(msg);
  if(!messageId)throw Error('메시지 고유번호를 확인할 수 없어 전송을 중단했습니다.');
  const runtime=require('../shared/runtime');
  const outcome=await runtime.transferFish({roomId:String(roomId),roomName:msg?.room?.name||'',
   fromId:from,toId:recipient.id,toName:recipient.name,request,messageId});
  await send(outcome);
 }catch(error){
  await send('❌ '+String(error?.message||'물고기 전송에 실패했습니다.'));
 }
 return true;
}

module.exports={handle,parse,pick,move,USAGE};
