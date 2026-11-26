'use strict';
const {randomInt}=require('node:crypto'),{performance}=require('node:perf_hooks'),{format}=require('../core'),{sentences,LEVELS}=require('./typing-bank');
const {createCooldownTracker}=require('./cooldowns');
const TIMEOUT=120000,MAX_ACTIVE=128,NBSP='\u00a0';
// Korean two-set keyboard estimation: each jamo is one key, compound vowels
// and final consonant clusters require two; shifted double consonants one.
const complexVowels=new Set([9,10,11,14,15,16,19]),complexFinals=new Set([3,5,6,9,10,11,12,13,14,15,18]);
function countKeys(text){let n=0;for(const c of String(text).normalize('NFC')){const v=c.codePointAt(0)-0xac00;if(v>=0&&v<11172){const vowel=Math.floor(v/28)%21,final=v%28;n+=2+(complexVowels.has(vowel)?1:0)+(final?(complexFinals.has(final)?2:1):0);}else n++;}return n;}
const id=v=>typeof v==='number'&&!Number.isSafeInteger(v)?'':/^[1-9]\d*$/.test(String(v??''))?String(v):'';
const logId=m=>id(m?.message?.logId??m?.logId??m?.raw?.chatLog?.logId);
const sentLog=v=>id(v?.body?.logId??v?.body?.chatLog?.logId??v?.body?.chatlog?.logId??v?.logId??v?.chatLog?.logId);
const clean=v=>[...String(v??'').replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu,' ').trim()].slice(0,80).join('');
const protect=s=>s.replace(/ /g,NBSP);
// Only the final full stop is optional. Do not fold special spaces or internal punctuation.
const withoutPeriod=s=>s.endsWith('.')?s.slice(0,-1):s;
const BANK=Object.freeze(Object.fromEntries(LEVELS.map(level=>[level,sentences[level].map(text=>Object.freeze({text,short:withoutPeriod(text),shown:protect(text),keys:countKeys(text),shortKeys:countKeys(withoutPeriod(text))}))])));
function createTyping({send,canHandle=()=>true,isEnabled=()=>true,getCooldown=()=>0,getName=()=>'',clock=()=>performance.now(),pick=randomInt,delay=setTimeout,clear=clearTimeout,logger=console}={}){
 if(typeof send!=='function')throw Error('typing send required');
 const active=new Map(),last=new Map(),cooldowns=createCooldownTracker({clock,duration:getCooldown});
 const eligible=e=>!!(id(e?.roomId)&&id(e?.userId)&&e.msg?.room?.isOpenChat===true&&canHandle(e)&&isEnabled(e.roomId));
 function cancel(r){const s=active.get(r);if(s?.timer)clear(s.timer);active.delete(r);}
 function reset(){for(const r of active.keys())cancel(r);}
 function choose(r,level){const list=BANK[level],key=r+':'+level,prev=last.get(key);let i=pick(list.length-(prev===undefined?0:1));if(prev!==undefined&&i>=prev)i++;last.delete(key);last.set(key,i);while(last.size>384)last.delete(last.keys().next().value);return list[i];}
 function finish(r,s,e,at){
  if(active.get(r)!==s||!eligible(e)||!Number.isFinite(at)||at<=s.startAt||at-s.startAt>=TIMEOUT)return false;
  const log=logId(e.msg);if(!log||(s.log&&BigInt(log)<=BigInt(s.log)))return false;
  cancel(r);
  const elapsed=at-s.startAt,keys=e.text.normalize('NFC')===s.item.text?s.item.keys:s.item.shortKeys,speed=Math.round(keys*60000/elapsed),name=clean(e.msg?.sender?.name||getName(r,e.userId))||'이름 미확인';
  const body=format('TYPING',name+'님 타자 성공!\n\n타수 : '+speed.toLocaleString('ko-KR')+'타/분\n정확도 : 100%\n소요 시간 : '+(elapsed/1000).toFixed(3)+'초\n난이도 : '+s.level);
  const handledAt=clock();void Promise.resolve().then(()=>send(r,body)).then(()=>logger.log?.('[DUKE TYPING TIMING]',JSON.stringify({recognitionMs:Math.max(0,Math.round((handledAt-at)*1000)/1000),elapsedMs:Math.round(elapsed)}))).catch(err=>logger.error('[DUKE] typing result send failed',err?.name||'Error'));
  return true;
 }
 function answer(e){
  const r=e?.roomId,s=active.get(r);if(!s||!eligible(e)||Number(e.msg?.message?.type??e.msg?.type)!==1||typeof e.text!=='string'||e.text.length>512)return false;
  const at=Number.isFinite(e.receivedAt)?e.receivedAt:clock(),log=logId(e.msg);if(!log||at<s.createdAt)return false;
  // Do NOT apply NFKC, trim or whitespace folding: copied NBSP is different
  // from an ordinary keyboard space. NFC only composes Korean jamo.
  const text=e.text.normalize('NFC');
  if(text!==s.item.text&&text!==s.item.short){
   if(text.includes(NBSP)&&withoutPeriod(text.replace(/\u00a0/g,' '))===s.item.short)return true;
   return false;
  }
  if(s.phase==='pending'){if(s.candidates.length<16&&!s.candidates.some(v=>v.log===log))s.candidates.push({e,at,log});return true;}
  return finish(r,s,e,at);
 }
 async function start(e){
  const r=e.roomId;if(!eligible(e))return '활성화된 오픈채팅방에서만 타자게임을 사용할 수 있습니다.';
  if(!logId(e.msg))return '타자게임 요청을 확인할 수 없습니다.';
  if(e.args.length>1||(e.args.length===1&&!LEVELS.includes(e.args[0])))return '사용법 : -타자게임 [쉬움/보통/어려움]';
  if(active.has(r))return '이미 진행 중인 타자게임이 있습니다.';
  const remaining=cooldowns.remaining(r);if(remaining>0)return '타자게임은 '+Math.ceil(remaining/1000)+'초 후 다시 사용할 수 있습니다.';
  if(active.size>=MAX_ACTIVE)return '진행 중인 게임이 많습니다. 잠시 후 다시 시도해 주세요.';
  const level=e.args[0]||LEVELS[pick(LEVELS.length)],item=choose(r,level),s={level,item,createdAt:clock(),startAt:Infinity,phase:'pending',candidates:[],log:'',timer:null};
  active.set(r,s);
  try{
   const res=await send(r,format('TYPING',item.shown+'\n\n난이도 : '+level+'\n문장을 직접 입력하세요. (끝 마침표 생략 가능)'));
   if(active.get(r)!==s)return null;
   s.log=sentLog(res);s.startAt=clock();s.phase='open';cooldowns.record(r);
   // Do not score a message received before acknowledged prompt delivery.
   // Very early input can be tried again; avoids zero/negative elapsed times.
   s.candidates=[];
   s.timer=delay(()=>{if(active.get(r)!==s)return;cancel(r);if(isEnabled(r))void Promise.resolve().then(()=>send(r,'타자게임 시간이 초과되었습니다.')).catch(err=>logger.error('[DUKE] typing timeout failed',err?.name||'Error'));},TIMEOUT);s.timer?.unref?.();
  }catch(err){if(active.get(r)===s)cancel(r);logger.error('[DUKE] typing question failed',err?.name||'Error');}
  return null;
 }
 function register(core){core.register({name:'타자게임',section:'GAME',description:'타자 속도 측정 (쉬움/보통/어려움, 생략 시 랜덤)',execute:start});}
 return {register,start,answer,has:r=>active.has(r),cancel,reset};
}
module.exports={createTyping,countKeys,protect,BANK,TIMEOUT};
