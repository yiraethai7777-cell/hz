'use strict';
// Bounded, staff-initiated mention reminder. Never a bulk ping/spam facility.
const {mentions}=require('./targets');
// Accept any positive safe integer; keep one active send loop per room.
const COOLDOWN_MS=60*1000;
const INTERVAL_MS=250;
const lastRun=new Map();
const running=new Set();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function parse({text,msg,issuerId,botId}){
 const raw=String(text||'').trim();
 const m=/^!멘션\s+(.+?)\s+([0-9]+)$/.exec(raw);
 if(!m)return {error:'사용법: !멘션 @대상 (횟수)\n예: !멘션 @홍길동 10'};
 const tagged=mentions(msg);
 if(tagged.length!==1)return {error:'❌ 카카오톡 멘션으로 정확히 1명을 선택해 주세요.'};
 const target=tagged[0];
 const id=String(target.id||'');
 if(!/^[1-9]\d{3,24}$/.test(id))return {error:'❌ 멘션 대상의 사용자 ID를 확인하지 못했습니다.'};
 if(id===String(botId)||id===String(issuerId))return {error:'❌ 봇 또는 명령 실행자 본인은 멘션 대상이 될 수 없습니다.'};
 if(!m[1].includes('@'))return {error:'사용법: !멘션 @대상 (횟수)'};
 const count=Number(m[2]);
 if(!Number.isSafeInteger(count)||count<1)return {error:'❌ 횟수는 1 이상의 정수로 입력해 주세요.'};
 return {target,count};
}
function token(chat,roomId,target){
 const name=String(target.name||target.id).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,35);
 let mention;
 try{
  if(typeof chat?.mention==='function')mention=chat.mention(String(target.id),name,roomId);
 }catch(e){console.warn('[MENTION REPEAT TOKEN]',String(e?.message||e));}
 if(typeof mention!=='string'||!mention.startsWith('\u0002')||!mention.includes('\u0003')||!mention.endsWith('\u0004'))
  mention='\u0002'+target.id+'\u0003'+name.replace(/[\u0002-\u0004]/g,'')+'\u0004';
 return mention;
}
async function handle({text,msg,roomId,userId,botId,isBotAccount=false,chat,send,waitFn=wait,now=Date.now}){
 const parsed=parse({text,msg,issuerId:userId,botId});
 if(parsed.error){await send(parsed.error);return true;}
 const room=String(roomId),current=now();
 if(running.has(room)){await send('⏳ 이 방에서는 멘션 알림을 전송 중입니다.');return true;}
 const remain=COOLDOWN_MS-(current-(lastRun.get(room)||0));
 if(remain>0&&!isBotAccount){await send('⏳ 다시 사용하려면 '+Math.ceil(remain/1000)+'초 기다려 주세요.');return true;}
 running.add(room);lastRun.set(room,current);
 try{
  const mention=token(chat,roomId,parsed.target);
  for(let i=0;i<parsed.count;i++){
   if(i>0)await waitFn(INTERVAL_MS);
   if(!await require('../shared/bot-power').enabled(room))return true;
   await send(mention);
  }
  return true;
 }catch(e){
  console.error('[MENTION REPEAT FAILED]',String(e?.code||e?.message||e));
  await send('❌ 멘션 전송이 중단되었습니다.').catch(()=>{});
  return true;
 }finally{
  running.delete(room);
  if(lastRun.size>5000)lastRun.delete(lastRun.keys().next().value);
 }
}
module.exports={handle,parse,token,COOLDOWN_MS};
