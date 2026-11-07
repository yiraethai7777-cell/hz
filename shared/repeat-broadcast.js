'use strict';

// Bounded owner-only repeat sender. It never floods without a per-command limit.
// Staggered sends avoid overwhelming KakaoTalk and keep the chat usable.
const MAX_MESSAGES=5;
const MIN_INTERVAL_MS=1500;
const MAX_BODY_LENGTH=200;
const ROOM_COOLDOWN_MS=60000;
const jobs=new Map();
const cooldowns=new Map();

function createRepeatSender({maxMessages=MAX_MESSAGES,intervalMs=MIN_INTERVAL_MS,
  maxBodyLength=MAX_BODY_LENGTH,cooldownMs=ROOM_COOLDOWN_MS,now=()=>Date.now(),
  schedule=setTimeout,cancel=clearTimeout}={}) {
 const running=new Map(),used=new Map();

 function finish(job) {
  if (running.get(job.room)===job) running.delete(job.room);
  if (job.timer!==null) cancel(job.timer);
  job.timer=null;
  if (job.wake) {const wake=job.wake;job.wake=null;wake();}
 }
 function stop(room) {
  const job=running.get(String(room));
  if (!job) return false;
  job.stopped=true;
  finish(job);
  return true;
 }
 async function repeat(job) {
  try {
   while (!job.stopped && job.sent<maxMessages) {
    // Only one in-flight send at a time. Stopping does not interrupt a send
    // already accepted by the KakaoTalk API.
    try {await job.send(job.body);}
    catch(error) {
     console.warn('[NEXI REPEAT SEND FAILED]',String(error?.message||error));
     if (!job.stopped) {
      try {await job.send('❌ 반복 메시지 전송이 중단되었습니다.');}
      catch (_) {}
     }
     break;
    }
    job.sent++;
    if (job.sent>=maxMessages || job.stopped)break;
    await new Promise(resolve=>{
     job.wake=resolve;
     job.timer=schedule(()=>{job.timer=null;job.wake=null;resolve();},intervalMs);
    });
   }
  } finally {finish(job);}
 }

 async function handle({text,roomId,isBotAccount=false,send}) {
  if (!/^!도배(?:시작|중지)(?=\s|$)/.test(text)) return false;
  if (!isBotAccount) return true; // Permission is restricted to bot's own account.
  const room=String(roomId);
  if (text==='!도배중지') {
   await send(stop(room)?'⏹️ 반복 전송을 중단했습니다.':'ℹ️ 실행 중인 반복 전송이 없습니다.');
   return true;
  }
  const matched=/^!도배시작\s+([\s\S]+)$/.exec(text);
  if (!matched || !matched[1].trim()) {
   await send('사용법: !도배시작 (내용) · 최대 5회, 1.5초 간격\n중지: !도배중지');
   return true;
  }
  const body=matched[1].trim();
  if (body.length>maxBodyLength) {
   await send('❌ 반복 전송 내용은 '+maxBodyLength+'자 이하로 입력해 주세요.');
   return true;
  }
  // Never allow generated messages to invoke another bot command.
  if (/^[!#]/.test(body)) {
   await send('❌ 봇 명령어를 반복 실행하는 내용은 사용할 수 없습니다.');
   return true;
  }
  if (running.has(room)) {
   await send('ℹ️ 이 방에서 이미 반복 전송 중입니다. !도배중지로 중단할 수 있습니다.');
   return true;
  }
  const wait=cooldownMs-(now()-(used.get(room)??-Infinity));
  if (wait>0) {
   await send('⏳ 반복 전송은 '+Math.ceil(wait/1000)+'초 후 다시 사용할 수 있습니다.');
   return true;
  }
  // Limit one active room globally and prevent concurrent streams.
  if (running.size>=1) {
   await send('⏳ 다른 채팅방에서 반복 전송이 진행 중입니다.');
   return true;
  }
  const job={room,body,send,stopped:false,sent:0,timer:null,wake:null};
  running.set(room,job);
  used.set(room,now());
  void repeat(job);
  return true;
 }
 return {handle,stop,isRunning:room=>running.has(String(room))};
}
const defaultSender=createRepeatSender();
module.exports={handle:args=>defaultSender.handle(args),createRepeatSender,
  MAX_MESSAGES,MIN_INTERVAL_MS,MAX_BODY_LENGTH,ROOM_COOLDOWN_MS};
