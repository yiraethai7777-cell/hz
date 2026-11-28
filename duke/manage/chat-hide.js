'use strict';
const fs=require('node:fs'),path=require('node:path'),{format}=require('../core');
const id=v=>typeof v==='number'&&!Number.isSafeInteger(v)?'':/^[1-9]\d*$/.test(String(v??''))?String(v):'';
const {directMessageReference,mentions}=require('./targets');
const MAX=50,ROOM_CAP=100;
const hasLink=text=>typeof text==='string'&&/(?:https?:\/\/[^\s<>]+|\bwww\.[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s<>]*)?|(?:^|[\s(])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|kr|io|gg|co|me|app|dev|xyz|info|biz|tv|th|site|link)(?=$|[\s/:?#),.!]))/iu.test(text);
function createChatHide({dir,onPersist=()=>{},allowedRooms=null,isEnabled=()=>true,canManage=()=>false,botId=()=>'',otherBotIds=[],listAdmins=()=>[],getRole,hide,loadHistory,fetchMessage,audit,logger=console,now=Date.now}={}){
 const file=dir?path.join(dir,'link-filter-settings.json'):null,enabled=new Set(),recent=new Map(),pending=new Set();
 if(file){fs.mkdirSync(dir,{recursive:true,mode:0o700});try{const data=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(data))throw Error('invalid link filter settings');for(const r of data)if(id(r))enabled.add(r);}catch(e){if(e.code!=='ENOENT')throw e;}}
 const permitFile=dir?path.join(dir,'link-filter-exemptions.json'):null,exemptions=new Map();
 if(permitFile)try{
  const data=JSON.parse(fs.readFileSync(permitFile,'utf8'));
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid link exemptions');
  for(const [r,users] of Object.entries(data)){if(!id(r)||!Array.isArray(users)||users.some(u=>!id(u)))throw Error('invalid link exemptions');exemptions.set(r,new Set(users.map(id)));}
 }catch(e){if(e.code!=='ENOENT')throw e;}
 const exempt=(r,u)=>exemptions.get(r)?.has(u)===true;
 function setExempt(r,u,on){
  const next=new Map(exemptions),users=new Set(next.get(r)||[]);
  if(on)users.add(u);else users.delete(u);
  if(users.size)next.set(r,users);else next.delete(r);
  if(permitFile){const tmp=permitFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(Object.fromEntries([...next].map(([room,ids])=>[room,[...ids]]))),{mode:0o600});fs.renameSync(tmp,permitFile);onPersist('link-filter-exemptions.json');}
  exemptions.clear();for(const [room,ids] of next)exemptions.set(room,ids);
 }
 // Bound concurrent moderation operations across rooms and commands.
 const HIDE_CONCURRENCY=2,MAX_WAITING=50,waiting=[];
 let running=0,generation=0;
 function pump(){
  while(running<HIDE_CONCURRENCY&&waiting.length){
   const job=waiting.shift();running++;
   Promise.resolve().then(job.run).then(job.resolve,()=>job.resolve(false)).finally(()=>{running--;pump();});
  }
 }
 function schedule(run){
  if(waiting.length>=MAX_WAITING)return Promise.resolve(false);
  return new Promise(resolve=>{waiting.push({run,resolve});pump();});
 }
 const journal=dir?path.join(dir,'hide-index'):null;
 if(journal)fs.mkdirSync(journal,{recursive:true,mode:0o700});
 function persist(r,list){
  if(!journal)return;
  try{const file=path.join(journal,r+'.json'),tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(list.map(({log,user,at,hidden,verifiedHidden})=>({log,user,at,hidden,verifiedHidden}))),{mode:0o600});fs.renameSync(tmp,file);onPersist('hide-index/'+r+'.json');}
  catch(err){logger.warn?.('[DUKE HIDE INDEX]',err?.code||err?.name||'Error');}
 }
 const excluded=()=>new Set([botId(),...otherBotIds].map(id).filter(Boolean));
 const permitted=r=>!!r&&isEnabled(r)&&(!allowedRooms||allowedRooms.has(r));
 function set(r,on){const next=new Set(enabled);if(on)next.add(r);else next.delete(r);if(file){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify([...next]),{mode:0o600});fs.renameSync(tmp,file);onPersist('link-filter-settings.json');}enabled.clear();for(const room of next)enabled.add(room);}
 function rows(r){let list=recent.get(r);if(!list){list=[];if(journal)try{const data=JSON.parse(fs.readFileSync(path.join(journal,r+'.json'),'utf8'));if(Array.isArray(data))list=data.filter(x=>id(x?.log)&&id(x?.user)).slice(-MAX-5).map(x=>({log:id(x.log),user:id(x.user),at:Number(x.at)||0,hidden:x.hidden===true&&x.verifiedHidden===true,verifiedHidden:x.verifiedHidden===true,msg:{room:{id:r,isOpenChat:true}},restored:true}));}catch(err){if(err.code!=='ENOENT')logger.warn?.('[DUKE HIDE INDEX]',err?.code||err?.name||'Error');}}
  recent.delete(r);recent.set(r,list);while(recent.size>ROOM_CAP)recent.delete(recent.keys().next().value);return list;}
 function remember(r,msg,e){
  const log=id(msg?.message?.logId??msg?.logId),user=id(e.userId),type=Number(msg?.message?.type??msg?.type);
  if(!log||!user||id(msg?.sender?.id)!==user||type===0||!Number.isInteger(type))return null;
  const list=rows(r),found=list.find(x=>x.log===log);
  if(found){found.msg=msg;found.restored=false;return {item:found,fresh:false};}
  const item={log,user,msg,at:now(),hidden:false};list.push(item);
  list.sort((a,b)=>BigInt(a.log)<BigInt(b.log)?-1:BigInt(a.log)>BigInt(b.log)?1:0);
  if(list.length>MAX+5)list.splice(0,list.length-MAX-5);
  persist(r,list);
  return {item,fresh:true};
 }
 async function apply(r,item,authorized=()=>permitted(r)){
  const key=r+':'+item.log;if(item.hidden||pending.has(key))return false;
  pending.add(key);const started=generation;
  const allowed=()=>started===generation&&permitted(r)&&authorized();
  try{return await schedule(async()=>{if(!allowed())return false;let msg=item.msg;if(item.restored){if(typeof fetchMessage!=='function')return false;msg=await fetchMessage(r,item.log);if(id(msg?.room?.id)!==r||id(msg?.message?.logId??msg?.logId)!==item.log||id(msg?.sender?.id)!==item.user||msg?.room?.isOpenChat!==true)return false;}if(!allowed())return false;const res=await hide(r,msg);if(res?.status!==0||res?.verified===false||res?.body?.status!=null&&Number(res.body.status)!==0||res?.success===false||res?.ok===false)return false;item.hidden=true;item.verifiedHidden=res.verified===true;const stored=rows(r).find(x=>x.log===item.log);if(stored){stored.hidden=true;stored.verifiedHidden=item.verifiedHidden;persist(r,rows(r));}return true;});}
  catch(err){logger.warn?.('[DUKE HIDE]',err?.name||'Error');return false;}finally{pending.delete(key);}
 }
 function record(r,e,command,result,target){audit?.record({roomId:r,actorId:id(e.userId),actorName:e.msg?.sender?.name,targetId:target?.user,targetName:target?.msg?.sender?.name||'현재 채팅방',command,result});}
 async function observe(msg,e){
  const r=id(e.roomId);
  if(!permitted(r)||msg?.room?.isOpenChat!==true)return false;
  if(excluded().has(id(e.userId)))return false;
  const entry=remember(r,msg,e);
  if(!entry||!enabled.has(r)||!hasLink(e.text))return false;
  const {item}=entry,bot=id(botId());
  if(!bot||item.user===bot||exempt(r,item.user)||listAdmins(r).includes(item.user)||[1,4].includes(Number(msg.sender?.type)))return false;
  // A current membership lookup is required. Unknown roles are never hidden.
  let role;try{role=await getRole(r,item.user);}catch{return false;}
  if(role!==2||!permitted(r)||!enabled.has(r)||item.user===id(botId())||exempt(r,item.user)||listAdmins(r).includes(item.user))return false;
  if(await apply(r,item,()=>enabled.has(r)&&!excluded().has(item.user)&&!exempt(r,item.user)&&!listAdmins(r).includes(item.user))){record(r,{userId:bot,msg:{sender:{name:'듀크봇'}}},'-홍금','링크 가리기',item);return true;}
  return false;
 }
 async function hideReply(r,e,anchor){
  const ref=directMessageReference(e.msg),log=id(ref?.logId),author=id(ref?.userId);
  if(!log||!anchor||BigInt(log)>=BigInt(anchor))return format('ADMIN','원본 메시지를 확인할 수 없습니다. 가릴 메시지에 답장해 주세요.');
  const known=rows(r).find(x=>x.log===log);
  if(known&&author&&known.user!==author)return format('ADMIN','원본 메시지를 확인할 수 없습니다.');
  let item=known;
  if(!item||item.restored){
   if(typeof fetchMessage!=='function')return format('ADMIN','원본 메시지를 불러오지 못했습니다.');
   let msg;try{msg=await fetchMessage(r,log);}catch{return format('ADMIN','원본 메시지를 불러오지 못했습니다.');}
   const user=id(msg?.sender?.id??msg?.senderId),type=Number(msg?.message?.type??msg?.type);
   if(id(msg?.room?.id)!==r||msg?.room?.isOpenChat!==true||id(msg?.message?.logId??msg?.logId)!==log||!user||(author&&user!==author)||(known&&user!==known.user)||!Number.isInteger(type)||type<=0)return format('ADMIN','원본 메시지를 확인할 수 없습니다.');
   item={log,user,msg,hidden:known?.hidden===true};
  }
  if(!permitted(r)||!canManage(e))return format('ADMIN','관리 권한이 없습니다.');
  if(item.hidden)return format('ADMIN','이미 가려진 메시지입니다.');
  const ok=await apply(r,item,()=>canManage(e));
  const result=ok?'원본 메시지를 가렸습니다.':'원본 메시지 가리기를 확인하지 못했습니다.';
  record(r,e,'-가리기 (답장)',result,item);
  return format('ADMIN',result);
 }
 async function exemptionTarget(r,e){
  const tags=mentions(e.msg),ref=directMessageReference(e.msg);
  if(tags.length===1&&!ref)return tags[0].id;
  if(tags.length||e.args.length>1)return '';
  if(e.args.length===1)return ref?'':id(e.args[0]);
  const l=id(ref?.logId),author=id(ref?.userId),anchor=id(e.msg?.message?.logId??e.msg?.logId);
  if(!l||!anchor||BigInt(l)>=BigInt(anchor))return '';
  const known=rows(r).find(x=>x.log===l);
  if(known)return author&&known.user!==author?'':known.user;
  if(typeof fetchMessage!=='function')return '';
  let m;try{m=await fetchMessage(r,l);}catch{return '';}
  const u=id(m?.sender?.id??m?.senderId);
  return id(m?.room?.id)===r&&m?.room?.isOpenChat===true&&id(m?.message?.logId??m?.logId)===l&&u&&(!author||author===u)?u:'';
 }
 function register(core){
  for(const [name,on] of [['홍보가능',true],['홍보불가',false]])core.register({name,section:'MANAGEMENT',description:'링크 자동 가리기 예외 '+(on?'등록':'해제')+' (멘션 / 아이디 / 답장)',execute:async e=>{
   const r=id(e.roomId);
   if(!permitted(r)||!canManage(e))return format('ADMIN','관리 권한이 없습니다.');
   const u=await exemptionTarget(r,e);
   if(!u)return format('ADMIN','사용법 : -'+name+' (멘션 / 아이디 / 답장)');
   if(!permitted(r)||!canManage(e))return format('ADMIN','관리 권한이 없습니다.');
   setExempt(r,u,on);
   const result=on?'홍보 허용 완료':'홍보 허용 해제';
   record(r,e,'-'+name,result,{user:u});
   return format('ADMIN',result+'\\n아이디 : '+u);
  }});
  core.register({name:'가리기',section:'MANAGEMENT',description:'이전 채팅 가리기 (개수, 봇 제외) / 원본 메시지 가리기 (답장)',execute:async e=>{
   const r=id(e.roomId),anchor=id(e.msg?.message?.logId??e.msg?.logId);
   if(!permitted(r)||!canManage(e))return format('ADMIN','관리 권한이 없습니다.');
   if(!e.args.length&&directMessageReference(e.msg))return hideReply(r,e,anchor);
   if(e.args.length!==1||!/^[1-9]\d*$/.test(e.args[0])||Number(e.args[0])>MAX)return format('ADMIN','사용법 : -가리기 (1~'+MAX+'개) / 원본 메시지에 답장으로 -가리기');
   if(!anchor)return format('ADMIN','명령어 위치를 확인할 수 없습니다.');
   const n=Number(e.args[0]),bots=excluded();
   const live=rows(r).filter(x=>!bots.has(x.user)&&BigInt(x.log)<BigInt(anchor)).slice(-n).reverse();
   let selected=live;
   // Prefer actual live observations when sufficient. History is a fallback
   // only when the bot has not seen enough messages (e.g. after reconnect).
   if(live.length<n&&loadHistory){
    try{selected=await loadHistory(r,anchor,n,{excludedUsers:[...bots]});}
    catch(err){logger.warn?.('[DUKE HIDE HISTORY]',err?.code||err?.name||'Error');return format('ADMIN','확인된 이전 채팅이 '+live.length+'개뿐입니다. 채팅 기록을 불러오지 못했습니다.');}
   }
   if(!Array.isArray(selected)||selected.length>n||selected.some(x=>!id(x.user)||bots.has(id(x.user))||!id(x.log)||BigInt(x.log)>=BigInt(anchor)||id(x.msg?.room?.id)!==r)||new Set(selected.map(x=>x.log)).size!==selected.length)return format('ADMIN','이전 채팅 기록을 확인하지 못했습니다.');
   const known=new Map(rows(r).map(x=>[x.log,x]));
   selected=selected.map(x=>known.get(x.log)||x);
   if(selected.length<n)return format('ADMIN','확인된 이전 채팅이 '+selected.length+'개뿐입니다. 개수를 줄여 주세요.');
   let ok=0,already=0;
   // Dispatch only the existing selected targets, two at a time. Each job
   // rechecks authorization at dispatch, including after a history fetch.
   for(let i=0;i<selected.length;i+=HIDE_CONCURRENCY){
    if(!permitted(r)||!canManage(e))break;
    const results=await Promise.all(selected.slice(i,i+HIDE_CONCURRENCY).map(async item=>{
     if(item.hidden)return 'already';
     return await apply(r,item,()=>canManage(e))?'ok':'unconfirmed';
    }));
    ok+=results.filter(x=>x==='ok').length;
    already+=results.filter(x=>x==='already').length;
   }
   const result='가리기 : '+ok+'개 / 이미 가림 : '+already+'개 / 미확인 : '+(n-ok-already)+'개';
   record(r,e,'-가리기 '+n,result);return format('ADMIN',result);
  }});
  core.register({name:'홍금',section:'MANAGEMENT',description:'일반 사용자 링크 자동 가리기 (on/off)',execute:e=>{
   const r=id(e.roomId);if(!permitted(r)||!canManage(e))return format('ADMIN','관리 권한이 없습니다.');
   const v=e.args[0]?.toLowerCase();
   if(e.args.length>1||(v&&!['on','off'].includes(v)))return format('ADMIN','사용법 : -홍금 on/off');
   const on=v?v==='on':!enabled.has(r);set(r,on);record(r,e,'-홍금','홍보 금지 '+(on?'ON':'OFF'));return format('ADMIN','홍보 금지 : '+(on?'ON':'OFF'));
  }});
 }
 return {register,observe,resetRoom:r=>recent.delete(r),reset:()=>{generation++;recent.clear();}};
}
module.exports={createChatHide,hasLink};
