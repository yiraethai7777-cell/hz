'use strict';
const {canConfigure}=require('./owner-permission');
const fs=require('node:fs'),path=require('node:path'),LosslessJSON=require('lossless-json');
const {format,fold}=require('../core'),{replyReference}=require('./reply-moderation');
const id=v=>typeof v==='number'&&!Number.isSafeInteger(v)?'':/^[1-9]\d*$/.test(String(v??''))?String(v):'';
const safe=v=>[...String(v??'').replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ').trim()].slice(0,80).join('');
const ttl=600000,cap=2000;
function parseRewrite(packet){
 const b=packet?.body??{};
 if(packet?.method==='SYNCMODMSG'){
  const feed=b.chatLog??b.chatlog,changed=b.modifiedChatLog;
  if(!feed||!changed||Number(feed.type)!==0)return null;
  let info;try{info=typeof feed.message==='string'?LosslessJSON.parse(feed.message):feed.message;}catch{return null;}
  const room=id(b.chatId??feed.chatId??feed.chatRoomId),log=id(info?.logId),user=id(changed.authorId??changed.userId),rev=id(info?.targetRevision);
  if(Number(info?.feedType)!==25||!room||!log||!user||!rev||rev!==id(changed.revision)||id(changed.logId)!==log||!id(feed.logId)||BigInt(id(feed.logId))<=BigInt(log)||id(feed.authorId)!==user||![1,26].includes(Number(changed.type)))return null;
  if((feed.chatId!=null&&id(feed.chatId)!==room)||(changed.chatId!=null&&id(changed.chatId)!==room)||(changed.chatRoomId!=null&&id(changed.chatRoomId)!==room))return null;
  const raw=changed.message??changed.msg??changed.text;
  return {room,log,user,text:typeof raw==='string'&&raw.trim()?raw:null,revision:rev};
 }
 const l=b.chatLog??b.chatlog??b.rewrite??b;
 const room=id(b.chatId??b.chatRoomId??b.roomId??b.c??l.chatId??l.chatRoomId??l.roomId??l.c),log=id(l.logId??l.messageId??l.l??b.logId??b.messageId??b.l),user=id(l.authorId??l.userId??b.authorId??b.userId??b.actorId);
 const raw=l.message??l.msg??l.text??b.message??b.msg??b.text;
 const type=l.type??b.type;
 if(!room||!log)return null;
 return {room,log,user,text:typeof raw==='string'&&raw.trim()&&(type==null||[1,26].includes(Number(type)))?raw:null};
}
function createDeleteWatch({dir,allowedRooms=null,isEnabled=()=>true,botId=()=>'',canManage=()=>false,send,edit,remove,fetchCurrent=async()=>null,now=Date.now,delay=(fn,ms)=>setTimeout(fn,ms),onPersist=()=>{},logger=console}={}){
 const file=dir?path.join(dir,'delete-watch-settings.json'):null;
 const editFile=dir?path.join(dir,'edit-watch-settings.json'):null,editEnabled=new Set();
 const enabled=new Set(),cache=new Map(),notices=new Map(),seen=new Map(),pending=new Set(),cooldown=new Map();
 if(file){fs.mkdirSync(dir,{recursive:true,mode:0o700});try{for(const r of JSON.parse(fs.readFileSync(file,'utf8')))if(id(r))enabled.add(r);}catch(e){if(e.code!=='ENOENT')throw e;}}
 if(editFile){try{for(const r of JSON.parse(fs.readFileSync(editFile,'utf8')))if(id(r))editEnabled.add(r);}catch(e){if(e.code!=='ENOENT')throw e;}}
 const permitted=r=>isEnabled(r)&&(!allowedRooms||allowedRooms.has(r)),active=r=>enabled.has(r)&&permitted(r),editing=r=>editEnabled.has(r)&&permitted(r);
 function prune(){for(const m of [cache,notices,seen,cooldown]){for(const [k,v] of m)if(now()-v.at>=ttl)m.delete(k);while(m.size>cap)m.delete(m.keys().next().value);}}
 let lastDiagnostic=-Infinity;function diagnostic(reason,packet){if(now()-lastDiagnostic<1000)return;lastDiagnostic=now();const body=packet?.body??{};logger.log?.('[DUKE REWRITE]',JSON.stringify({reason,method:packet?.method,fields:Object.keys(body).slice(0,25),nestedFields:Object.keys(body.chatLog??body.chatlog??body.rewrite??{}).slice(0,25),modifiedFields:Object.keys(body.modifiedChatLog??{}).slice(0,25)}));}
 const timer=setInterval(prune,30000);timer.unref?.();
 function set(r,on,kind='delete'){const target=kind==='edit'?editEnabled:enabled,store=kind==='edit'?editFile:file;const next=new Set(target);if(on)next.add(r);else next.delete(r);
  if(store){const tmp=store+'.tmp';fs.writeFileSync(tmp,JSON.stringify([...next]),{mode:0o600});fs.renameSync(tmp,store);onPersist(kind==='edit'?'edit-watch-settings.json':'delete-watch-settings.json');}
  target.clear();for(const k of next)target.add(k);
  if(!on){for(const [k,n] of notices)if(k.startsWith(r+':')&&(n.kind||'delete')===kind)notices.delete(k);if(!active(r)&&!editing(r))for(const m of [cache,seen])for(const k of m.keys())if(k.startsWith(r+':'))m.delete(k);}
 }
 function register(core){for(const [name,kind,label,isOn] of [['삭제감지','delete','삭제',active],['수정감지','edit','수정',editing]])core.register({name,section:'OWNER',description:label+' 감지 설정 (on/off), 관리자 답장 l 조회',execute:e=>{
  if(!canConfigure(e,botId))return format('ADMIN','방장과 봇 계정만 오픈채팅방에서 설정할 수 있습니다.');
  const v=e.args[0]?.toLowerCase();if(e.args.length!==1||!['on','off'].includes(v))return format('ADMIN','사용법 : -'+name+' on/off\n현재 상태 : '+(isOn(e.roomId)?'ON':'OFF'));
  set(e.roomId,v==='on',kind);return format('ADMIN',label+' 감지 : '+v.toUpperCase()+(v==='on'?'\n최근 10분간 수신 메시지를 메모리에 보관합니다. 관리자는 '+label+' 알림에 답장 l로 조회할 수 있습니다.':''));
 }});}
 function observe(msg,e){
  const r=id(e.roomId),u=id(e.userId),log=id(msg?.message?.logId??msg?.logId),type=Number(msg?.message?.type??msg?.type);
  if(!r||!u||u===id(botId())||!log||(!active(r)&&!editing(r))||msg?.room?.isOpenChat!==true||![1,26].includes(type)||typeof e.text!=='string'||!e.text.trim())return;
  prune();const key=r+':'+log,old=cache.get(key);if(seen.has(key))return true;
  if(old){if(old.uid===u&&old.text!==[...e.text].slice(0,1000).join(''))void onRewrite({method:'SYNCREWR',body:{chatId:r,logId:log,authorId:u,msg:e.text,type}}).catch(err=>logger.error('[DUKE] rewrite observation failed',err?.name||'Error'));return true;}
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
  try{const res=await send(r,body,{mentions:[{userId:u,at:[1],len:name.length}]});const notice=id(res?.body?.logId??res?.logId);if(notice&&active(r))notices.set(r+':'+notice,{at:now(),item});prune();}catch(e){logger.error('[DUKE] delete notice failed',e?.name||'Error');}
 }
 async function onRewrite(packet){
  if(!['SYNCREWR','SYNCMODMSG'].includes(packet?.method))return false;
  const e=parseRewrite(packet);if(!e){diagnostic('missing room or log ID',packet);return false;}if(!editing(e.room)&&!active(e.room)){diagnostic('room disabled',packet);return false;}
  prune();const key=e.room+':'+e.log,old=cache.get(key);
  if(!old||old.uid===id(botId())||(e.user&&e.user!==old.uid)||seen.has(key)){diagnostic(!old?'original not cached':'author mismatch or deleted',packet);return false;}
  let value=e.text;
  if(value===null)try{const msg=await fetchCurrent(e.room,e.log);if(id(msg?.room?.id??msg?.chatId)===e.room&&id(msg?.message?.logId??msg?.logId)===e.log&&id(msg?.sender?.id??msg?.senderId)===old.uid&&[1,26].includes(Number(msg?.message?.type??msg?.type)))value=msg?.message?.text??msg?.text;}catch{}
  if(typeof value!=='string'||!value.trim()||cache.get(key)!==old||seen.has(key)){diagnostic('updated text unavailable or stale',packet);return false;}
  const after=[...value].slice(0,1000).join('');if(after===old.text){diagnostic('unchanged text',packet);return false;}
  if(e.revision&&old.revision&&BigInt(e.revision)<=BigInt(old.revision))return false;
  cache.set(key,{...old,text:after,at:now(),revision:e.revision??old.revision});diagnostic('change detected',packet);
  if(!editing(e.room))return true;
  const name=old.name||'이름 확인 불가',summary='@'+name+'님이 메세지를 수정하셨습니다.';
  const body=fold(summary,'[ 수정 정보 ]\n닉네임 : '+name+'\n수정 시각 : '+new Date(now()).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+'\n내용 확인 : 이 알림에 답장으로 l (관리자 전용, 10분 이내)');
  try{const res=await send(e.room,body,{mentions:[{userId:old.uid,at:[1],len:name.length}]});const notice=id(res?.body?.logId??res?.logId);if(notice&&editing(e.room))notices.set(e.room+':'+notice,{at:now(),kind:'edit',item:old,after});prune();}catch(err){logger.error('[DUKE] edit notice failed',err?.name||'Error');}
  return true;
 }
 async function handle(msg,e){
  const r=id(e.roomId),u=id(e.userId),bot=id(botId());
  if(!r||!u||!bot||(!active(r)&&!editing(r))||msg?.room?.isOpenChat!==true||String(e.text??'').trim().toLowerCase()!=='l')return false;
  const ref=replyReference(msg,bot),key=r+':'+ref;prune();const n=notices.get(key);
  if(!n||!(n.kind==='edit'?editing(r):active(r)))return false;
  if(!canManage({...e,msg})){await send(r,'관리 권한이 없습니다.');return true;}
  if(pending.has(r)||now()-(cooldown.get(r)?.at??-Infinity)<3000)return true;
  if(!n.item?.text){await send(r,n.kind==='edit'?'수정 전 원문을 확인할 수 없습니다.':'삭제된 원문을 확인할 수 없습니다.');return true;}
  pending.add(r);cooldown.set(r,{at:now()});
  try{
   const text=n.item.text.replace(/[\u0000-\u0006]/g,'');
   const isEdit=n.kind==='edit',end=isEdit?'수정 메세지 확인 종료':'삭제 메세지 확인 종료';
   const res=await send(r,isEdit?'[ 메세지 수정 확인 ]\n\n수정 전 : '+text+'\n수정 후 : '+n.after.replace(/[\u0000-\u0006]/g,''):'[ 삭제 메세지 확인 ]\n'+text);
   const log=id(res?.body?.logId??res?.logId);
   if(!log){logger.error('[DUKE] delete view missing log ID; edit unavailable');pending.delete(r);return true;}
   delay(async()=>{try{
    const result=await edit(r,log,end);if(result?.status!==0)throw Error('edit unverified');
   }catch(e){logger.error('[DUKE] delete view edit failed',e?.name||'Error');if(remove)try{await remove(r,log);}catch{logger.error('[DUKE] delete view cleanup failed');}}
   finally{pending.delete(r);}},10000);
  }catch(e){pending.delete(r);logger.error('[DUKE] delete view send failed',e?.name||'Error');}
  return true;
 }
 function resetRoom(r){for(const map of [cache,notices,seen,cooldown])for(const key of map.keys())if(key===r||key.startsWith(r+':'))map.delete(key);}
 return {register,observe,onDelete,onRewrite,handle,resetRoom,close(){clearInterval(timer);cache.clear();notices.clear();seen.clear();}};
}
module.exports={createDeleteWatch};
