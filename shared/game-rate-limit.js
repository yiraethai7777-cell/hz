'use strict';
// Per-user/per-room game command throttle. Hot path uses only memory: no timers
// or database reads. State naturally resets on a process restart.
const {COMMANDS}=require('../game/command-aliases');
const WINDOW_MS=60*1000, ALLOWED=5, BLOCK_MS=5*60*1000;
const ADMIN_OR_GENERAL=new Set([
 '정보','핑','게임on','게임off','게임상태','게임정보','게임초기화',
 '코인지급','코인초기화','치트','회수','초기화','초기화확인',
 '랭킹공개','랭킹비공개','퀴즈작동','퀴즈중지',
 '낚시작동','낚시중지'
]);
const NOTICE='⚠️ 게임 명령어 사용 제한\n'+
 '최근 1분 동안 게임 명령어를 5회 사용하셨습니다.\n'+
 '⏳ 5분 동안 게임 명령어를 사용할 수 없습니다.\n'+
 '5분 후 자동으로 해제됩니다.';

function isGameCommand(text){
 const head=String(text??'').trim().split(/\s+/,1)[0];
 if(head==='!타자게임')return true;
 if(!head.startsWith('!'))return false;
 const name=head.slice(1);
 return COMMANDS.has(name)&&!ADMIN_OR_GENERAL.has(name);
}
function createLimiter({now=Date.now,windowMs=WINDOW_MS,allowed=ALLOWED,blockMs=BLOCK_MS}={}){
 const states=new Map();
 let lastSweep=0;
 function sweep(time){
  // At most one O(active-user-count) sweep per minute. No intervals or DB.
  if(time-lastSweep<windowMs)return;
  lastSweep=time;
  for(const [key,state] of states){
   if(state.blockedUntil>time)continue;
   if(!state.hits.length||state.hits.at(-1).at<=time-windowMs)states.delete(key);
  }
 }
 function check(roomId,userId,messageId){
  const time=now();
  sweep(time);
  const key=JSON.stringify([String(roomId),String(userId)]);
  let state=states.get(key);
  if(!state){state={hits:[],blockedUntil:0};states.set(key,state);}
  if(state.blockedUntil>0){
   if(time<state.blockedUntil)return {allowed:false,notify:false,blocked:true,retryAfterMs:state.blockedUntil-time};
   // An expired block resets the rolling counter.
   state.blockedUntil=0;
   state.hits=[];
  }
  const cutoff=time-windowMs;
  while(state.hits.length&&state.hits[0].at<=cutoff)state.hits.shift();
  const logId=messageId==null?'':String(messageId);
  if(logId&&state.hits.some(h=>h.id===logId)){
   return {allowed:false,notify:false,duplicate:true};
  }
  if(state.hits.length>=allowed){
   state.blockedUntil=time+blockMs;
   state.hits=[];
   return {allowed:false,notify:true,blocked:true,retryAfterMs:blockMs};
  }
  state.hits.push({at:time,id:logId});
  return {allowed:true,remaining:allowed-state.hits.length};
 }
 return {check,activeUsers:()=>states.size};
}
const limiter=createLimiter();
module.exports={WINDOW_MS,ALLOWED,BLOCK_MS,NOTICE,isGameCommand,createLimiter,check:limiter.check};
