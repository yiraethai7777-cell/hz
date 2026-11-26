'use strict';
const fs=require('node:fs'),path=require('node:path'),{format}=require('../core');
const stamp=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
const id=v=>typeof v==='string'&&/^[1-9]\d*$/.test(v);
const clean=v=>[...String(v??'').replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu,' ').trim()].slice(0,80).join('')||'사용자';
function createAttendance({dir,now=Date.now,onPersist=()=>{},getName=()=>''}={}){
 const root=dir?path.join(dir,'attendance'):null,cache=new Map();
 if(root)fs.mkdirSync(root,{recursive:true,mode:0o700});
 function load(key){
  if(cache.has(key)){const v=cache.get(key);cache.delete(key);cache.set(key,v);return v;}
  let data={days:{}};
  if(root)try{data=JSON.parse(fs.readFileSync(path.join(root,key+'.json'),'utf8'));if(!data?.days||typeof data.days!=='object'||Array.isArray(data.days))throw Error('invalid attendance data');}catch(e){if(e.code!=='ENOENT')throw e;}
  cache.set(key,data);while(cache.size>128)cache.delete(cache.keys().next().value);return data;
 }
 function save(key,data){if(root){const f=path.join(root,key+'.json'),tmp=f+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data),{mode:0o600});fs.renameSync(tmp,f);}cache.set(key,data);if(root)onPersist('attendance/'+key+'.json');}
 function execute(e){
  const r=e.roomId,u=e.userId;if(!id(r)||!id(u)||e.msg?.room?.isOpenChat!==true)return format('ATTENDANCE','오픈채팅방에서만 출석할 수 있습니다.');
  if(e.args.length)return '사용법 : -출석 / -ㅊㅅ / ㅊㅅ';
  const at=now(),s=stamp.format(at),day=s.slice(0,10),key=r+'-'+day.slice(0,7),data=load(key),rows=data.days[day]??{};
  const name=clean(e.msg?.sender?.name||getName(r,u)),prev=rows[u];
  if(prev)return name+'님은 이미 출석하셨습니다. ('+prev.rank+'등 · '+stamp.format(prev.at).slice(11)+')';
  const rank=Object.keys(rows).length+1;
  save(key,{...data,days:{...data.days,[day]:{...rows,[u]:{rank,at,name}}}});
  return format('ATTENDANCE',name+'님 출석 완료!\n\n출석 순위 : '+rank+'등\n출석 시간 : '+s.slice(11)+' (KST)\n날짜 : '+day);
 }
 return {register(core){core.register({name:'출석',description:'하루 1회 출석 (-출석 / -ㅊㅅ / ㅊㅅ)',execute});}};
}
module.exports={createAttendance};
