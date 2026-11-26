'use strict';
const fs=require('node:fs'),path=require('node:path'),{format}=require('../core'),{canConfigure}=require('./owner-permission');
const id=v=>typeof v==='string'&&/^[1-9]\d*$/.test(v);
function createRoomModes({dir,botId=()=>'',onPersist=()=>{},onManage=()=>{},onGame=()=>{},audit=null}={}){
 const file=dir?path.join(dir,'room-modes.json'):null,states=new Map();
 if(file){fs.mkdirSync(dir,{recursive:true,mode:0o700});try{const data=JSON.parse(fs.readFileSync(file,'utf8'));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid room modes');for(const [r,s] of Object.entries(data)){if(!id(r)||typeof s?.manage!=='boolean'||typeof s?.game!=='boolean')throw Error('invalid room mode');states.set(r,s);}}catch(e){if(e.code!=='ENOENT')throw e;}}
 // Preserve existing command availability and individual watcher settings until explicitly changed.
 const get=r=>states.get(r)??{manage:true,game:true};
 const manage=r=>id(r)&&get(r).manage,game=r=>id(r)&&get(r).game;
 function save(r,kind,on){const next=new Map(states);next.set(r,{...get(r),[kind]:on});if(file){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(Object.fromEntries(next)),{mode:0o600});fs.renameSync(tmp,file);onPersist('room-modes.json');}states.set(r,next.get(r));}
 function allow(e,cmd){
  if(cmd.name==='관리'||cmd.name==='게임'||cmd.section==='BOT')return true;
  if(cmd.section==='GAME')return game(e.roomId);
  if(cmd.section==='MANAGEMENT'||cmd.section==='OWNER')return manage(e.roomId);
  return true;
 }
 function register(core){for(const [name,kind] of [['관리','manage'],['게임','game']])core.register({name,section:'OWNER',description:name+' 시스템 일괄 설정 (on/off)',execute:e=>{
  if(!canConfigure(e,botId))return format('ADMIN','봇 계정, 방장, 부방장만 사용할 수 있습니다.');
  const r=e.roomId,v=e.args[0]?.toLowerCase();
  if(e.args.length!==1||!['on','off'].includes(v))return format('ADMIN','사용법 : -'+name+' on/off\n현재 상태 : '+(get(r)[kind]?'ON':'OFF'));
  const on=v==='on';
  if(kind==='manage'){
   // Fail closed during a multi-file configuration change. Repeating ON
   // repairs any partial watcher configuration after a storage failure.
   if(manage(r))save(r,kind,false);
   onManage(r,on);
   if(on)save(r,kind,true);
   else if(!states.has(r))save(r,kind,false);
  }else{save(r,kind,on);onGame(r,on);}
  audit?.record({roomId:r,actorId:e.userId,actorName:e.msg?.sender?.name,targetName:'현재 채팅방',command:'-'+name+' '+v,result:name+' '+v.toUpperCase()});
  return format('SYSTEM',name+' 시스템 : '+v.toUpperCase()+(kind==='manage'?'\n입장·퇴장 알림, 닉네임·프로필 감지,\n삭제·수정 감지 '+(on?'전체 활성화':'전체 비활성화'):''));
 }});}
 return {register,manage,game,allow,get,count:(kind,rooms)=>[...rooms].filter(r=>get(r)[kind]).length};
}
module.exports={createRoomModes};
