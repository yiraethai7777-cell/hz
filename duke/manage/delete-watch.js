'use strict';
const fs=require('node:fs'),path=require('node:path');
const {format,fold}=require('../core'),{replyReference}=require('./reply-moderation');
const id=v=>typeof v==='number'&&!Number.isSafeInteger(v)?'':/^[1-9]\d*$/.test(String(v??''))?String(v):'';
const safe=v=>[...String(v??'').replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ').trim()].slice(0,80).join('');
const ttl=600000,cap=2000,end='삭제 메세지 확인 종료';
function createDeleteWatch({dir,allowedRooms=null,botId=()=>'',canManage=()=>false,send,edit,remove,now=Date.now,delay=(fn,ms)=>setTimeout(fn,ms),onPersist=()=>{},logger=console}={}){
 const file=dir?path.join(dir,'delete-watch-settings.json'):null;
 const enabled=new Set(),cache=new Map(),notices=new Map(),seen=new Map(),pending=new Set(),cooldown=new Map();
 if(file){fs.mkdirSync(dir,{recursive:true,mode:0o700});try{for(const r of JSON.parse(fs.readFileSync(file,'utf8')))if(id(r))enabled.add(r);}catch(e){if(e.code!=='ENOENT')throw e;}}
 const active=r=>enabled.has(r)&&(!allowedRooms||allowedRooms.has(r));
 function prune(){for(const m of [cache,notices,seen,cooldown]){for(const [k,v] of m)if(now()-v.at>=ttl)m.delete(k);while(m.size>cap)m.delete(m.keys().next().value);}}
 const timer=setInterval(prune,30000);timer.unref?.();
 function set(r,on){const next=new Set(enabled);if(on)next.add(r);else next.delete(r);
  if(file){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify([...next]),{mode:0o600});fs.renameSync(tmp,file);onPersist('delete-watch-settings.json');}
  enabled.clear();for(const k of next)enabled.add(k);
  if(!on)for(const m of [cache,notices,seen])for(const k of m.keys())if(k.startsWith(r+':'))m.delete(k);
 }
 function register(core){core.register({name:'삭제감지',section:'MANAGEMENT',description:'삭제 감지 설정 (on/off), 관리자 답장 l 조회',execute:e=>{
  if(e.msg?.room?.isOpenChat!==true||e.userId!==id(botId()))return format('ADMIN','봇 계정만 오픈채팅방에서 설정할 수 있습니다.');
  const v=e.args[0]?.toLowerCase();if(e.args.length!==1||!['on','off'].includes(v))return format('ADMIN','사용법 : -삭제감지 on/off\n현재 상태 : '+(active(e.roomId)?'ON':'OFF'));
  set(e.roomId,v==='on');return format('ADMIN','삭제 감지 : '+v.toUpperCase()+(v==='on'?'\n최근 10분간의 수신 메시지를 메모리에 보관하며, 관리자는 삭제 알림에 답장 l로 조회할 수 있습니다.':''));
 }});}
 function observe(msg,e){
  const r=id(e.roomId),u=id(e.userId),log=id(msg?.message?.logId??msg?.logId),type=Number(msg?.message?.type??msg?.type);
  if(!r||!u||u===id(botId())||!log||!active(r)||msg?.room?.isOpenChat!==true||![1,26].includes(type)||typeof e.text!=='string'||!e.text.trim())return;
  const key=r+':'+log;if(cache.has(key)||seen.has(key))return;
  cache.set(key,{at:now(),uid:u,name:safe(msg?.sender?.name),text:[...e.text].slice(0,1000).join(''),type});prune();
 }
 async function onDelete(event){
  const r=id(event?.room?.id??event?.chatId),log=id(event?.message?.logId??event?.logId);
  // Never attribute a delete to the active room if the push omitted room ID.
  const raw=event?.raw?.body??{},rawLog=raw.chatLog??raw.chatlog??{};
  const explicit=id(raw.chatId??raw.c??raw.roomId??raw.chatRoomId??rawLog.chatId??rawLog.chatRoomId??rawLog.c);
  if(!r||explicit!==r||!log||!active(r)||event?.room?.isOpenChat!==true)return;
  prune();const key=r+':'+log;if(seen.has(key))return;
  const item=cache.get(key),member=event.members?.[0],u=id(item?.uid??member?.id??event.member?.ids?.[0]);
  if(!u||u===id(botId()))return;
  const actor=id(event.actor?.id);if(actor&&actor!==u)return;
  const name=item?.name||safe(member?.name??event.member?.names?.[0])||'이름 확인 불가';
  seen.set(key,{at:now()});cache.delete(key);
  const summary='@'+name+'님이 메세지를 삭제하셨습니다.';
  const body=fold(summary,'[ 삭제 정보 ]\n닉네임 : '+name+'\n삭제 시각 : '+new Date(now()).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+'\n내용 확인 : 이 알림에 답장으로 l (관리자 전용, 10분 이내)');
  try{const res=await send(r,body,{mentions:[{userId:u,at:[1],len:name.length}]});const notice=id(res?.body?.logId??res?.logId);if(notice)notices.set(r+':'+notice,{at:now(),item});prune();}catch(e){logger.error('[DUKE] delete notice failed',e?.name||'Error');}
 }
 async function handle(msg,e){
  const r=id(e.roomId),u=id(e.userId),bot=id(botId());
  if(!r||!u||!bot||!active(r)||msg?.room?.isOpenChat!==true||String(e.text??'').trim().toLowerCase()!=='l')return false;
  const ref=replyReference(msg,bot),key=r+':'+ref;prune();const n=notices.get(key);
  if(!n)return false;
  if(!canManage({...e,msg})){await send(r,'관리 권한이 없습니다.');return true;}
  if(pending.has(r)||now()-(cooldown.get(r)?.at??-Infinity)<3000)return true;
  if(!n.item?.text){await send(r,'삭제된 원문을 확인할 수 없습니다.');return true;}
  pending.add(r);cooldown.set(r,{at:now()});
  try{
   const text=n.item.text.replace(/[\u0000-\u0006]/g,'');
   const res=await send(r,'[ 삭제 메세지 확인 ]\n'+text);
   const log=id(res?.body?.logId??res?.logId);
   if(!log){logger.error('[DUKE] delete view missing log ID; edit unavailable');pending.delete(r);return true;}
   delay(async()=>{try{
    const result=await edit(r,log,end);if(result?.status!==0)throw Error('edit unverified');
   }catch(e){logger.error('[DUKE] delete view edit failed',e?.name||'Error');if(remove)try{await remove(r,log);}catch{logger.error('[DUKE] delete view cleanup failed');}}
   finally{pending.delete(r);}},2000);
  }catch(e){pending.delete(r);logger.error('[DUKE] delete view send failed',e?.name||'Error');}
  return true;
 }
 return {register,observe,onDelete,handle,close(){clearInterval(timer);cache.clear();notices.clear();seen.clear();}};
}
module.exports={createDeleteWatch};
