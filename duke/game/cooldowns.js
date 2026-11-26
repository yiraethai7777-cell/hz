'use strict';
const fs=require('node:fs'),path=require('node:path'),{format}=require('../core'),{canConfigure}=require('../manage/owner-permission');
const DEFAULTS=Object.freeze({'퀴즈':30,'타자게임':0}),MAX_SECONDS=86400;
const validRoom=r=>typeof r==='string'&&/^[1-9]\d*$/.test(r);
const validGame=g=>Object.hasOwn(DEFAULTS,g);
const validSeconds=n=>Number.isSafeInteger(n)&&n>=0&&n<=MAX_SECONDS;
function createGameCooldowns({dir,botId=()=>'',onPersist=()=>{},audit=null}={}){
 const key='game-cooldowns.json',file=dir?path.join(dir,key):null,rooms=new Map();
 if(file){fs.mkdirSync(dir,{recursive:true,mode:0o700});try{
  const data=JSON.parse(fs.readFileSync(file,'utf8'));if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid cooldown settings');
  for(const [r,values] of Object.entries(data)){if(!validRoom(r)||!values||typeof values!=='object'||Array.isArray(values)||Object.entries(values).some(([g,n])=>!validGame(g)||!validSeconds(n)))throw Error('invalid cooldown value');rooms.set(r,values);}
 }catch(err){if(err.code!=='ENOENT')throw err;}}
 const get=(r,g)=>validGame(g)?(rooms.get(r)?.[g]??DEFAULTS[g]):0;
 function set(r,g,n){
  if(!validRoom(r)||!validGame(g)||!validSeconds(n))throw Error('invalid cooldown setting');
  const value={...rooms.get(r),[g]:n},next=new Map(rooms);next.set(r,value);
  if(file){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(Object.fromEntries(next)),{mode:0o600});fs.renameSync(tmp,file);}
  rooms.set(r,value);if(file)onPersist(key);
 }
 const show=n=>n===0?'없음 (0초)':n+'초';
 function register(core){core.register({name:'게임쿨타임',section:'OWNER',description:'방별 게임 쿨타임 설정 (퀴즈/타자게임, 초 단위, 0=해제)',execute:e=>{
  if(!canConfigure(e,botId))return format('ADMIN','봇 계정, 방장, 부방장만 사용할 수 있습니다.');
  const r=e.roomId,[g,raw]=e.args;
  if(!e.args.length)return format('ADMIN','게임 쿨타임 설정\n\n'+Object.keys(DEFAULTS).map(g=>g+' : '+show(get(r,g))).join('\n'));
  if(e.args.length!==2||!validGame(g)||!/^(?:0|[1-9]\d{0,4})(?:초)?$/.test(raw)||!validSeconds(Number(raw.replace(/초$/,''))))return format('ADMIN','사용법 : -게임쿨타임 (퀴즈/타자게임) (0~86400초)\n예시 : -게임쿨타임 퀴즈 60\n0초 : 쿨타임 해제');
  const n=Number(raw.replace(/초$/,''));set(r,g,n);
  audit?.record({roomId:r,actorId:e.userId,actorName:e.msg?.sender?.name,targetName:'현재 채팅방',command:'-게임쿨타임 '+g+' '+n,result:g+' '+show(n)});
  return format('ADMIN','게임 쿨타임이 설정되었습니다.\n\n게임 : '+g+'\n쿨타임 : '+show(n));
 }});}
 return {register,get};
}
// Keep the last successful prompt acknowledgement, even when the current
// duration is zero, so setting changes apply to the existing elapsed time.
function createCooldownTracker({clock,duration}){
 const last=new Map();
 return {remaining(r){const at=last.get(r);return at===undefined?0:Math.max(0,duration(r)-(clock()-at));},record(r){const at=clock();for(const [key,time] of last)if(at-time>=MAX_SECONDS*1000)last.delete(key);last.set(r,at);}};
}
module.exports={createGameCooldowns,createCooldownTracker,DEFAULTS,MAX_SECONDS};
