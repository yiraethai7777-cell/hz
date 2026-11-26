'use strict';
const fs=require('node:fs'),path=require('node:path');
const {format,fold}=require('../core');
const LINE='━━━━━━━━━━━━━━';
function id(v){if(typeof v==='number'&&!Number.isSafeInteger(v))return null;const s=String(v??'');return /^[1-9]\d*$/.test(s)?s:null;}
function clean(v,fallback){const s=String(v??'').replace(/[\r\n\t\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ').trim();return [...s].slice(0,80).join('')||fallback;}
function createMembership({dir,allowedRooms=null,botId=()=>null,send,now=Date.now,logger=console}={}){
 if(typeof send!=='function')throw TypeError('send required');
 const file=dir?path.join(dir,'membership-settings.json'):null,settings=new Map(),seen=new Map();
 if(file){fs.mkdirSync(dir,{recursive:true,mode:0o700});try{const data=JSON.parse(fs.readFileSync(file,'utf8'));for(const [r,s] of Object.entries(data)){if(id(r)&&typeof s?.join==='boolean'&&typeof s?.leave==='boolean'&&(s.join||s.leave))settings.set(r,{join:s.join,leave:s.leave});}}catch(e){if(e.code!=='ENOENT')throw e;}}
 const get=r=>settings.get(r)||{join:false,leave:false};
 function set(r,k,enabled){const next=new Map(settings),s={...get(r),[k]:enabled};if(s.join||s.leave)next.set(r,s);else next.delete(r);if(file){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(Object.fromEntries(next)),{mode:0o600});fs.renameSync(tmp,file);}settings.clear();for(const [key,value] of next)settings.set(key,value);}
 function authorized(e){const b=botId();return !!b&&e.userId===b;}
 const onoff=v=>v?'ON':'OFF';
 function register(core){
  for(const [name,kind,label] of [['입장알림','join','입장'],['퇴장알림','leave','퇴장']]){
   core.register({name,section:'MANAGEMENT',description:label+' 알림 설정 (on/off)',execute:e=>{
    if(!authorized(e))return format('ADMIN','봇 계정만 설정할 수 있습니다.');
    const value=e.args[0]?.toLowerCase();
    if(e.args.length!==1||!['on','off'].includes(value))return format('ADMIN','사용법 : -'+name+' on/off\n현재 상태 : '+onoff(get(e.roomId)[kind]));
    set(e.roomId,kind,value==='on');return format('ADMIN',label+' 알림 : '+onoff(get(e.roomId)[kind]));
   }});
  }
  core.register({name:'입퇴장설정',section:'MANAGEMENT',description:'현재 방 입퇴장 알림 상태',execute:e=>{const s=get(e.roomId);return format('ADMIN','입장 알림 : '+onoff(s.join)+'\n퇴장 알림 : '+onoff(s.leave));}});
 }
 async function handle(kind,event){
  if(kind!=='join'&&kind!=='leave')return 0;
  const roomId=id(event?.room?.id??event?.chatId);
  if(!roomId||event?.room?.isOpenChat!==true||(allowedRooms&&!allowedRooms.has(roomId))||!get(roomId)[kind])return 0;
  const members=Array.isArray(event.members)&&event.members.length?event.members:(event.member?.ids||[]).map((id,i)=>({id,name:event.member.names?.[i]}));
  const logId=id(event.message?.message?.logId??event.message?.logId??event.raw?.chatLog?.logId??event.raw?.logId);
  const at=now(),local=new Set(),label=kind==='join'?'입장':'퇴장';
  for(const [key,t] of seen){if(at-t<60000)break;seen.delete(key);}
  let sent=0;
  for(const member of members){
   const uid=id(member?.id);if(!uid||uid===botId()||local.has(uid))continue;local.add(uid);
   const key=logId?roomId+':'+kind+':'+logId+':'+uid:null;
   if(key&&seen.has(key))continue;
   if(key){seen.set(key,at);while(seen.size>2048)seen.delete(seen.keys().next().value);}
   const name=clean(member?.name,'알 수 없는 사용자');
   const summary=format('MEMBER',name+'님이 '+label+'하셨습니다.');
   const detail=LINE+'\n[ '+label+' 정보 ]\n\n닉네임 : '+name+'\n채팅방 : '+clean(event.room?.name,'현재 채팅방')+'\n'+label+' 시각 : '+new Date(at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' (한국 시간)\n\n'+LINE+'\nDUKE SYSTEM';
   try{await send(roomId,fold(summary,detail));sent++;}catch(e){if(key)seen.delete(key);logger.error('[DUKE] membership notice failed',kind,e?.name||'Error');}
  }
  return sent;
 }
 return {register,handle,activeCount:()=>settings.size};
}
module.exports={createMembership};
