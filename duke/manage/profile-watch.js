'use strict';
const fs=require('node:fs'),path=require('node:path');
const {format,fold}=require('../core'),{validLink}=require('../utility/open-profile-link');
const id=v=>typeof v==='number'&&!Number.isSafeInteger(v)?'':/^[1-9]\d*$/.test(String(v??''))?String(v):'';
const clean=v=>[...String(v??'').replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ').trim()].slice(0,80).join('');
function readMember(m){
 const user=id(m?.userId??m?.id??m?.memberId??m?.user_id);
 if(!user)return null;
 const rawType=m.ptp??m.profileType,profileType=rawType!=null&&String(rawType).trim()&&Number.isInteger(Number(rawType))?Number(rawType):null;
 const rawLink=m.pli??m.profileLinkId;
 const profileId=[1,2,4].includes(profileType)?'':rawLink!=null?id(rawLink):null;
 return {id:user,name:clean(m.nickName??m.nickname??m.name??m.profileName),profileType,profileId};
}
function createProfileWatch({dir,botId=()=>'',allowedRooms=null,ready=()=>true,listRooms,fetchRoster,lookupLinks=async()=>new Map(),send,audit,onPersist=()=>{},now=Date.now,logger=console,intervalMs=5000,roomIntervalMs=15000}={}){
 const file=dir?path.join(dir,'profile-watch-settings.json'):null,settings=new Map(),baseline=new Map(),due=new Map(),versions=new Map();
 let busy=false,timer=null,joined=null,roomsAt=0,cursor=0,generation=0;
 if(file){fs.mkdirSync(dir,{recursive:true,mode:0o700});try{const data=JSON.parse(fs.readFileSync(file,'utf8'));for(const [r,s] of Object.entries(data))if(id(r)&&(s?.nick===true||s?.profile===true))settings.set(r,{nick:s.nick===true,profile:s.profile===true});}catch(e){if(e.code!=='ENOENT')throw e;}}
 const get=r=>settings.get(r)||{nick:false,profile:false};
 function set(r,kind,on){
  const next=new Map(settings),s={...get(r),[kind]:on};
  if(s.nick||s.profile)next.set(r,s);else next.delete(r);
  if(file){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(Object.fromEntries(next)),{mode:0o600});fs.renameSync(tmp,file);onPersist('profile-watch-settings.json');}
  settings.clear();for(const [key,val] of next)settings.set(key,val);
  versions.set(r,(versions.get(r)||0)+1);baseline.delete(r);due.delete(r);joined=null;
 }
 function register(core){
  for(const [name,kind,label] of [['닉변감지','nick','닉네임 변경 감지'],['프로필감지','profile','프로필 변경 감지']])core.register({name,section:'MANAGEMENT',description:label+' (on/off)',execute:e=>{
   if(e.msg?.room?.isOpenChat!==true||!id(botId())||e.userId!==id(botId()))return format('ADMIN','봇 계정만 오픈채팅방에서 설정할 수 있습니다.');
   const value=e.args[0]?.toLowerCase(),state=get(e.roomId)[kind]?'ON':'OFF';
   if(e.args.length!==1||!['on','off'].includes(value))return format('ADMIN','사용법 : -'+name+' on/off\n현재 상태 : '+state);
   if(get(e.roomId)[kind]!== (value==='on'))set(e.roomId,kind,value==='on');
   audit?.record({roomId:e.roomId,actorId:e.userId,actorName:e.msg?.sender?.name,targetName:'현재 채팅방',command:'-'+name+' '+value,result:label+' '+value.toUpperCase()});
   return format('ADMIN',label+' : '+value.toUpperCase());
  }});
  core.register({name:'감지설정',section:'MANAGEMENT',description:'닉네임·프로필 감지 설정 확인',execute:e=>format('ADMIN','닉네임 변경 감지 : '+(get(e.roomId).nick?'ON':'OFF')+'\n프로필 변경 감지 : '+(get(e.roomId).profile?'ON':'OFF'))});
 }
 function reset(){generation++;baseline.clear();due.clear();joined=null;roomsAt=0;}
 async function tick(){
  if(busy||!ready()||!settings.size)return;busy=true;
  const gen=generation;
  try{
   const at=now();
   if(!joined||at-roomsAt>=60000){
    const list=await listRooms();if(gen!==generation||!ready())return;
    if(!Array.isArray(list))throw Error('invalid rooms');
    joined=new Set(list.map(id).filter(Boolean));roomsAt=at;
    for(const r of baseline.keys())if(!joined.has(r))baseline.delete(r);
   }
   const rooms=[...settings.keys()].filter(r=>joined.has(r)&&(!allowedRooms||allowedRooms.has(r)));
   if(!rooms.length)return;
   let room;
   for(let i=0;i<rooms.length;i++){const r=rooms[cursor++%rooms.length];if(at>=(due.get(r)||0)){room=r;break;}}
   if(!room)return;
   const ver=versions.get(room)||0,enabled=()=>gen===generation&&ready()&&ver===(versions.get(room)||0)&&settings.has(room);
   due.set(room,at+roomIntervalMs);
   try{
    const raw=await fetchRoster(room);
    if(!enabled())return;
    if(!Array.isArray(raw)||!raw.length)throw Error('invalid roster');
    const latest=new Map();
    for(const item of raw){const m=readMember(item);if(m&&m.id!==id(botId()))latest.set(m.id,m);}
    if(!latest.size){baseline.delete(room);return;}
    const prev=baseline.get(room),s=get(room),notices=[],profileChanges=[];
    if(prev)for(const [u,m] of latest){
     const old=prev.get(u);if(!old)continue;
     const name=m.name||old.name||'이름 확인 불가';
     if(s.nick&&old.name&&m.name&&old.name!==m.name)notices.push({title:'닉네임 변경',body:old.name+' → '+m.name});
     const types=old.profileType!==null&&m.profileType!==null&&old.profileType!==m.profileType;
     const links=old.profileId!==null&&m.profileId!==null&&old.profileId!==m.profileId;
     if(s.profile&&(types||links))profileChanges.push({old:{...old},current:{...m,name},types,links});
     // Missing fields are not evidence of a change.
     if(!m.name)m.name=old.name;
     for(const key of ['profileType','profileId'])if(m[key]===null)m[key]=old[key];
    }
    baseline.set(room,latest);
    // Resolve only profile IDs involved in changes; never use the current user's
    // link as a substitute for their old profile's URL.
    const selected=profileChanges.slice(0,20),ids=[...new Set(selected.flatMap(c=>[c.old.profileId,c.current.profileId]).filter(Boolean))];
    let urls=new Map();
    if(ids.length&&enabled())try{urls=await lookupLinks(ids);}catch{}
    const link=m=>m.profileId===null?'확인 불가':m.profileId===''?'없음':validLink(urls?.get?.(m.profileId))||'확인 불가';
    const type=m=>m.profileId?'오픈프로필':[1,2,4].includes(m.profileType)?'일반/기본 프로필 (유형 '+m.profileType+')':m.profileType===null?'확인 불가':'프로필 유형 '+m.profileType;
    for(const c of selected){
     const old=c.old,current=c.current;
     const title=c.links?'오픈프로필 변경':'프로필 유형 변경';
     notices.push({title,body:'전닉 : '+(old.name||'확인 불가')+'\n이전 오픈프로필 : '+link(old)+'\n\n현닉 : '+(current.name||'확인 불가')+'\n현재 오픈프로필 : '+link(current)+(c.types?'\n프로필 유형 : '+type(old)+' → '+type(current):'')});
    }
    if(!enabled()||!notices.length)return;
    const lines=notices.slice(0,20).map(n=>'['+n.title+']\n'+n.body);
    const omitted=Math.max(0,notices.length-20)+Math.max(0,profileChanges.length-selected.length);
    const body=lines.join('\n\n')+(omitted?'\n\n외 '+omitted+'건':'');
    await send(room,body);
   }catch(e){due.set(room,now()+60000);logger.error('[DUKE] profile watch room failed',e?.name||'Error');}
  }catch(e){joined=null;logger.error('[DUKE] profile watch failed',e?.name||'Error');}finally{busy=false;}
 }
 function start(){if(!timer){timer=setInterval(()=>void tick(),intervalMs);timer.unref?.();}}
 function stop(){if(timer)clearInterval(timer);timer=null;reset();}
 return {register,tick,start,stop,reset};
}
module.exports={createProfileWatch,readMember};
