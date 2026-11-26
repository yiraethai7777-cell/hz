'use strict';
const fs=require('node:fs'),path=require('node:path');
const {format}=require('../core');
const id=v=>typeof v==='string'&&/^[1-9]\d*$/.test(v)?v:'';
function createBotPower({dir,botId=()=>'',onPersist=()=>{},onChange=()=>{},audit=null}={}){
 const file=dir?path.join(dir,'bot-power.json'):null,off=new Set();
 if(file){fs.mkdirSync(dir,{recursive:true,mode:0o700});try{const rows=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(rows)||rows.some(r=>!id(r)))throw Error('invalid power settings');for(const r of rows)off.add(r);}catch(e){if(e.code!=='ENOENT')throw e;}}
 const enabled=r=>!!id(r)&&!off.has(r);
 const isBot=u=>!!id(u)&&u===id(botId());
 const canHandle=e=>enabled(e.roomId)||isBot(e.userId);
 function set(r,on){if(enabled(r)===on)return;const next=new Set(off);if(on)next.delete(r);else next.add(r);if(file){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify([...next]),{mode:0o600});fs.renameSync(tmp,file);onPersist('bot-power.json');}off.clear();for(const key of next)off.add(key);onChange(r,on);}
 function register(core){for(const [name,on] of [['봇켜기',true],['봇끄기',false]])core.register({name,section:'BOT',description:'현재 방 봇 '+(on?'활성화':'비활성화')+' (봇 계정 전용)',execute:e=>{
  if(!isBot(e.userId))return format('ADMIN','봇 계정만 사용할 수 있습니다.');
  if(!id(e.roomId)||e.msg?.room?.isOpenChat!==true)return format('ADMIN','오픈채팅방에서만 사용할 수 있습니다.');
  if(e.args.length)return format('ADMIN','사용법 : -'+name);
  const unchanged=enabled(e.roomId)===on;set(e.roomId,on);
  if(!unchanged)audit?.record({roomId:e.roomId,actorId:e.userId,actorName:e.msg?.sender?.name,targetName:'현재 채팅방',command:'-'+name,result:'봇 '+(on?'ON':'OFF')});
  return format('SYSTEM',unchanged?'이미 봇이 '+(on?'켜져':'꺼져')+' 있습니다.':'현재 채팅방의 봇을 '+(on?'켰습니다.':'껐습니다.'));
 }});}
 return {enabled,isBot,canHandle,register};
}
module.exports={createBotPower};
