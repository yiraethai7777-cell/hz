'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomInt}=require('node:crypto'),{performance}=require('node:perf_hooks');
const {format}=require('../core'),{BANK,CATEGORIES,normalizeAnswer}=require('./quiz-bank');
const LINE='━━━━━━━━━━━━━━',TIMEOUT=60000,CAP=128;
const id=v=>typeof v==='number'&&!Number.isSafeInteger(v)?'':/^[1-9]\d*$/.test(String(v??''))?String(v):'';
const clean=v=>[...String(v??'').replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ').trim()].slice(0,80).join('');
const logId=v=>id(v?.message?.logId??v?.logId??v?.raw?.chatLog?.logId??v?.raw?.logId);
function sentLog(v){return id(v?.body?.logId??v?.body?.chatLog?.logId??v?.body?.chatlog?.logId??v?.logId??v?.chatLog?.logId);}
function createQuiz({dir,send,botId=()=>'',getName=()=>'',rewardQuiz=()=>({status:'unregistered'}),onPersist=()=>{},canHandle=()=>true,isEnabled=()=>true,now=Date.now,clock=()=>performance.now(),pick=randomInt,delay=setTimeout,clear=clearTimeout,logger=console}={}){
 if(typeof send!=='function')throw Error('quiz send required');
 const folder=dir?path.join(dir,'quiz-history'):null,history=new Map(),active=new Map(),timing=new Map();
 if(folder)fs.mkdirSync(folder,{recursive:true,mode:0o700});
 function load(r){
  if(history.has(r)){const v=history.get(r);history.delete(r);history.set(r,v);return v;}
  let ids=[];if(folder)try{const data=JSON.parse(fs.readFileSync(path.join(folder,r+'.json'),'utf8'));if(data.version!==1||!Array.isArray(data.used)||data.used.some(i=>!Number.isInteger(i)||i<0||i>=1600)||new Set(data.used).size!==data.used.length)throw Error('invalid quiz history');ids=data.used;}catch(e){if(e.code!=='ENOENT')throw e;}
  const used=new Set(ids),counts=Array(8).fill(0);for(const i of used)counts[Math.floor(i/200)]++;
  const v={used,counts};history.set(r,v);while(history.size>CAP)history.delete(history.keys().next().value);return v;
 }
 function next(r){
  const h=load(r);if(h.used.size===1600)return null;
  const min=Math.min(...h.counts),cats=h.counts.flatMap((count,i)=>count===min&&count<200?[i]:[]);
  const ci=cats[pick(cats.length)],available=BANK[ci].filter(q=>!h.used.has(q.id)),q=available[pick(available.length)];
  // Save the reserved question before attempting send. A failed or uncertain send
  // consumes this question rather than risking repeat after process restart.
  if(folder){const file=path.join(folder,r+'.json'),tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify({version:1,used:[...h.used,q.id]}),{mode:0o600});fs.renameSync(tmp,file);onPersist('quiz-history/'+r+'.json');}
  h.used.add(q.id);h.counts[ci]++;return q;
 }
 function eligible(e){return !!(id(e?.roomId)&&id(e?.userId)&&e.msg?.room?.isOpenChat===true&&canHandle(e)&&isEnabled(e.roomId));}
 function cancel(r){const st=active.get(r);if(st?.timer)clear(st.timer);active.delete(r);}
 function reset(){for(const r of active.keys())cancel(r);}
 function logTiming(kind,receiveAt,at,ackAt){
  const prev=timing.get(kind)??-Infinity;if(now()-prev<30000)return;timing.set(kind,now());
  logger.log?.('[DUKE QUIZ TIMING]',JSON.stringify({kind,recognitionMs:Math.max(0,Math.round((at-receiveAt)*1000)/1000),sendAckMs:Math.max(0,Math.round(ackAt-at)),totalMs:Math.max(0,Math.round(ackAt-receiveAt))}));
 }
 function announce(r,st,e){
  if(active.get(r)!==st||!eligible(e))return false;
  cancel(r); // Synchronous first-answer claim BEFORE any network await.
  const at=clock(),name=clean(e.msg?.sender?.name||getName(r,e.userId))||'이름 미확인';
  let result;
  try{result=rewardQuiz(r,e.userId,st.q.id,logId(e.msg),name);}catch(err){logger.error('[DUKE] quiz reward failed',err?.name||'Error');result={status:'failed'};}
  const body=name+'님 정답을 맞췄습니다!\n'+(result?.status==='paid'?'+1000코인':result?.status==='unregistered'?'게임 가입 후 코인 보상을 받을 수 있습니다.':result?.status==='duplicate'?'이미 지급된 퀴즈 보상입니다.':'코인 보상 지급에 실패했습니다.');
  const sendAt=clock();
  void Promise.resolve().then(()=>send(r,body)).then(()=>logTiming('answer',e.receivedAt??at,sendAt,clock())).catch(err=>logger.error('[DUKE] quiz answer send failed',err?.name||'Error'));
  return true;
 }
 function answer(e){
  const r=e?.roomId,st=active.get(r);
  if(!st||!eligible(e)||Number(e.msg?.message?.type??e.msg?.type)!==1||typeof e.text!=='string'||e.text.length>512||!st.q.answerKeys.has(normalizeAnswer(e.text)))return false;
  const log=logId(e.msg);if(!log)return false;
  if(Number.isFinite(e.receivedAt)&&e.receivedAt<st.startedAt)return false;
  if(st.phase==='pending'){
   // The question can arrive just before its WRITE acknowledgment. Keep only
   // early matching candidates, then validate against the server question log ID.
   if(st.candidates.length<16&&!st.candidates.some(x=>x.log===log))st.candidates.push({e,log});
   return true;
  }
  if(now()>=st.expiresAt)return false;
  if(st.log&&BigInt(log)<=BigInt(st.log))return false;
  if(!st.log&&Number.isFinite(e.receivedAt)&&e.receivedAt<st.ackAt)return false;
  return announce(r,st,e);
 }
 async function start(e){
  const r=e.roomId;if(!eligible(e))return '활성화된 오픈채팅방에서만 퀴즈를 사용할 수 있습니다.';
  if(e.args.length)return '사용법 : -퀴즈';
  if(!logId(e.msg))return '퀴즈 요청을 확인할 수 없습니다.';
  if(active.has(r))return '이미 진행 중인 퀴즈가 있습니다.';
  if(active.size>=CAP)return '퀴즈가 많이 진행 중입니다. 잠시 후 다시 시도해 주세요.';
  const receiveAt=e.receivedAt??clock(),q=next(r);if(!q)return '이 채팅방의 퀴즈 1,600문제를 모두 출제했습니다. 중복 방지를 위해 출제를 종료합니다.';
  const st={q,phase:'pending',startedAt:clock(),candidates:[],timer:null,log:'',expiresAt:Infinity,ackAt:Infinity};
  active.set(r,st);
  try{
   const result=await send(r,format('QUIZ',q.question+'\n\n분야 : '+q.category+'\n난이도 : '+q.difficulty+'\n'+LINE));
   if(active.get(r)!==st)return null;
   st.log=sentLog(result);st.ackAt=clock();st.phase='open';st.expiresAt=now()+TIMEOUT;
   logTiming('question',receiveAt,st.startedAt,st.ackAt);
   if(st.log){const candidate=st.candidates.find(x=>BigInt(x.log)>BigInt(st.log));if(candidate&&announce(r,st,candidate.e))return null;}
   st.candidates=[];
   st.timer=delay(()=>{if(active.get(r)!==st)return;cancel(r);if(isEnabled(r))void Promise.resolve().then(()=>send(r,'시간 초과! 정답 : '+q.answers[0])).catch(err=>logger.error('[DUKE] quiz timeout send failed',err?.name||'Error'));},TIMEOUT);
   st.timer?.unref?.();
  }catch(err){if(active.get(r)===st)cancel(r);logger.error('[DUKE] quiz question send failed',err?.name||'Error');}
  return null;
 }
 function register(core){core.register({name:'퀴즈',section:'GAME',description:'랜덤 퀴즈 출제 (정답만 채팅, 60초, 가입자 정답 보상 1,000코인)',execute:start});}
 return {register,start,answer,has:r=>active.has(r),cancel,reset};
}
module.exports={createQuiz,TIMEOUT};
