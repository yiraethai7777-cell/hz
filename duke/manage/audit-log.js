'use strict';
const fs=require('node:fs'),path=require('node:path');
const {format,fold}=require('../core');
const LIMIT=15,LINE='━━━━━━━━━━━━━━';
const validId=v=>typeof v==='string'&&/^[1-9]\d*$/.test(v);
const clean=v=>[...String(v??'').replace(/[\r\n\t\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ').trim()].slice(0,80).join('');
function createManagementLog({dir,now=Date.now,logger=console}={}){
 const folder=dir?path.join(dir,'management-logs'):null,cache=new Map();
 if(folder)fs.mkdirSync(folder,{recursive:true,mode:0o700});
 function remember(room,rows){cache.delete(room);cache.set(room,rows);if(folder&&cache.size>256)cache.delete(cache.keys().next().value);}
 function load(room){
  if(!validId(room))throw Error('invalid room');
  if(cache.has(room)){const rows=cache.get(room);remember(room,rows);return rows;}
  let rows=[];if(folder){try{rows=JSON.parse(fs.readFileSync(path.join(folder,room+'.json'),'utf8'));if(!Array.isArray(rows))throw Error('invalid audit log');}catch(e){if(e.code!=='ENOENT')throw e;}}
  rows=rows.slice(0,LIMIT);remember(room,rows);return rows;
 }
 function record({roomId,actorId,actorName,targetId,targetName,command,result}){
  if(!validId(roomId)||!validId(actorId)||(targetId&&!validId(targetId)))return false;
  try{
   const row={at:now(),actorId,actorName:clean(actorName)||actorId,targetId:targetId||null,targetName:clean(targetName)||targetId||'현재 채팅방',command:clean(command),result:clean(result)};
   const rows=[row,...load(roomId)].slice(0,LIMIT);
   if(folder){const file=path.join(folder,roomId+'.json'),tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(rows),{mode:0o600});fs.renameSync(tmp,file);}
   remember(roomId,rows);return true;
  }catch(e){logger.error('[DUKE] management log write failed',e?.name||'Error');return false;}
 }
 function render(room){
  try{
   const rows=load(room);
   const summary=format('LOG','관리 명령어 사용 기록\n최근 기록 : '+rows.length+'건 (최대 15건)');
   const label=(name,id)=>name===id||!id?name:name+' ('+id+')';
   const details=rows.map((r,i)=>String(i+1)+'. '+r.command+'\n실행자 : '+label(r.actorName,r.actorId)+'\n대상 : '+label(r.targetName,r.targetId)+'\n결과 : '+r.result+'\n시간 : '+new Date(r.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})).join('\n\n'+LINE+'\n\n');
   return fold(summary,LINE+'\n[ 최근 관리 기록 · 최신순 ]\n\n'+(details||'아직 기록된 관리 명령어가 없습니다.')+'\n\n'+LINE+'\n시간 기준 : 한국 시간');
  }catch(e){logger.error('[DUKE] management log read failed',e?.name||'Error');return format('LOG','관리 기록을 불러오지 못했습니다.');}
 }
 return {record,render};
}
module.exports={createManagementLog};
