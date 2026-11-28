'use strict';
const fs=require('node:fs'),path=require('node:path'),{format}=require('../core');
const id=v=>typeof v==='number'&&!Number.isSafeInteger(v)?'':/^[1-9]\d*$/.test(String(v??''))?String(v):'';
const MAX=50,ROOM_CAP=100,TTL=600000;
const hasLink=text=>typeof text==='string'&&/(?:https?:\/\/[^\s<>]+|\bwww\.[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\/[^\s<>]*)?|(?:^|[\s(])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|net|org|kr|io|gg|co|me|app|dev|xyz|info|biz|tv|th|site|link)(?=$|[\s/:?#),.!]))/iu.test(text);
function createChatHide({dir,onPersist=()=>{},allowedRooms=null,isEnabled=()=>true,canManage=()=>false,botId=()=>'',listAdmins=()=>[],getRole,hide,audit,logger=console,now=Date.now}={}){
 const file=dir?path.join(dir,'link-filter-settings.json'):null,enabled=new Set(),recent=new Map(),pending=new Set();
 if(file){fs.mkdirSync(dir,{recursive:true,mode:0o700});try{const data=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(data))throw Error('invalid link filter settings');for(const r of data)if(id(r))enabled.add(r);}catch(e){if(e.code!=='ENOENT')throw e;}}
 const permitted=r=>!!r&&isEnabled(r)&&(!allowedRooms||allowedRooms.has(r));
 function set(r,on){const next=new Set(enabled);if(on)next.add(r);else next.delete(r);if(file){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify([...next]),{mode:0o600});fs.renameSync(tmp,file);onPersist('link-filter-settings.json');}enabled.clear();for(const room of next)enabled.add(room);}
 function rows(r){const list=(recent.get(r)||[]).filter(x=>now()-x.at<TTL);recent.delete(r);recent.set(r,list);while(recent.size>ROOM_CAP)recent.delete(recent.keys().next().value);return list;}
 function remember(r,msg,e){
  const log=id(msg?.message?.logId??msg?.logId),user=id(e.userId),type=Number(msg?.message?.type??msg?.type);
  if(!log||!user||id(msg?.sender?.id)!==user||type===0||!Number.isInteger(type))return null;
  const list=rows(r),found=list.find(x=>x.log===log);
  if(found){found.msg=msg;return {item:found,fresh:false};}
  const item={log,user,msg,at:now(),hidden:false};list.push(item);
  list.sort((a,b)=>BigInt(a.log)<BigInt(b.log)?-1:BigInt(a.log)>BigInt(b.log)?1:0);
  if(list.length>MAX+5)list.splice(0,list.length-MAX-5);
  return {item,fresh:true};
 }
 async function apply(r,item){
  const key=r+':'+item.log;if(item.hidden||pending.has(key))return false;
  pending.add(key);
  try{const res=await hide(r,item.msg);if(res?.status!==0||res?.success===false||res?.ok===false)return false;item.hidden=true;return true;}
  catch(err){logger.warn?.('[DUKE HIDE]',err?.name||'Error');return false;}finally{pending.delete(key);}
 }
 function record(r,e,command,result,target){audit?.record({roomId:r,actorId:id(e.userId),actorName:e.msg?.sender?.name,targetId:target?.user,targetName:target?.msg?.sender?.name||'현재 채팅방',command,result});}
 async function observe(msg,e){
  const r=id(e.roomId);
  if(!permitted(r)||msg?.room?.isOpenChat!==true)return false;
  const entry=remember(r,msg,e);
  if(!entry||!enabled.has(r)||!hasLink(e.text))return false;
  const {item}=entry,bot=id(botId());
  if(!bot||item.user===bot||listAdmins(r).includes(item.user)||[1,4].includes(Number(msg.sender?.type)))return false;
  // A current membership lookup is required. Unknown roles are never hidden.
  let role;try{role=await getRole(r,item.user);}catch{return false;}
  if(role!==2||!permitted(r)||!enabled.has(r)||item.user===id(botId())||listAdmins(r).includes(item.user))return false;
  if(await apply(r,item)){record(r,{userId:bot,msg:{sender:{name:'듀크봇'}}},'-홍금','링크 가리기',item);return true;}
  return false;
 }
 function register(core){
  core.register({name:'가리기',section:'MANAGEMENT',description:'명령어 위의 채팅 가리기 (개수)',execute:async e=>{
   const r=id(e.roomId),anchor=id(e.msg?.message?.logId??e.msg?.logId);
   if(!permitted(r)||!canManage(e))return format('ADMIN','관리 권한이 없습니다.');
   if(e.args.length!==1||!/^[1-9]\d*$/.test(e.args[0])||Number(e.args[0])>MAX)return format('ADMIN','사용법 : -가리기 (1~'+MAX+'개)');
   if(!anchor)return format('ADMIN','명령어 위치를 확인할 수 없습니다.');
   const n=Number(e.args[0]),selected=rows(r).filter(x=>BigInt(x.log)<BigInt(anchor)).slice(-n).reverse();
   if(selected.length<n)return format('ADMIN','확인된 이전 채팅이 '+selected.length+'개뿐입니다. 개수를 줄여 주세요.');
   let ok=0,already=0;
   for(const item of selected){if(!permitted(r)||!canManage(e))break;if(item.hidden){already++;continue;}if(await apply(r,item))ok++;}
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
 return {register,observe,resetRoom:r=>recent.delete(r)};
}
module.exports={createChatHide,hasLink};
