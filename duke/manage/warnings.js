'use strict';
const fs=require('node:fs'),path=require('node:path');
const {format,fold}=require('../core'),{resolveTarget,mentions,reference}=require('./targets');
const LINE='━━━━━━━━━━━━━━',PAGE=10;
const valid=v=>typeof v==='string'&&/^[1-9]\d*$/.test(v);
const clean=(v,max=160)=>[...String(v??'').replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ').trim()].slice(0,max).join('');
const time=at=>new Date(at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false});
function createWarnings({dir,onPersist=()=>{},audit,canManage,noticeTarget=()=>null,botId=()=>'',fetchMessage,getName=()=>'',now=Date.now}={}){
 const folder=dir?path.join(dir,'warnings'):null,cache=new Map();
 if(folder)fs.mkdirSync(folder,{recursive:true,mode:0o700});
 function remember(r,s){cache.delete(r);cache.set(r,s);if(folder&&cache.size>128)cache.delete(cache.keys().next().value);}
 function load(r){if(!valid(r))throw Error('invalid room');if(cache.has(r)){const s=cache.get(r);remember(r,s);return s;}let s={users:{}};if(folder)try{s=JSON.parse(fs.readFileSync(path.join(folder,r+'.json'),'utf8'));if(!s.users||typeof s.users!=='object')throw Error('invalid warnings');}catch(e){if(e.code!=='ENOENT')throw e;}remember(r,s);return s;}
 function save(r,s){if(folder){const file=path.join(folder,r+'.json'),tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(s),{mode:0o600});fs.renameSync(tmp,file);onPersist('warnings/'+r+'.json');}remember(r,s);}
 function name(r,u,provided){return clean(provided||getName(r,u),80)||u;}
 function auditAction(e,t,command,result){audit?.record({roomId:e.roomId,actorId:e.userId,actorName:name(e.roomId,e.userId,e.msg?.sender?.name),targetId:t.id,targetName:t.name,command,result});}
 // Strip only the actual target. For multi-word nicknames, match the known
 // nickname, or require a pipe separating the mention from the reason.
 async function parse(e){
  const tags=mentions(e.msg),ref=reference(e.msg);let args=[...e.args],tail=[];
  if(tags.length>1||(tags.length&&ref))return null;
  if(tags.length===1){
   const raw=args.join(' '),nick=String(tags[0].name||getName(e.roomId,tags[0].id)||'').trim();
   if(raw.startsWith('@')&&raw.includes(' | '))tail=[raw.split(' | ').slice(1).join(' | ')];
   else if(nick&&(raw==='@'+nick||raw.startsWith('@'+nick+' ')))tail=[raw.slice(nick.length+1).trim()];
   else if(!nick&&args[0]?.startsWith('@'))tail=args.slice(1);
   else if(!raw)tail=[];
   else return null;
   args=[];
  }else if(ref){tail=args;args=[];}
  else if(/^[1-9]\d{3,}$/.test(args[0]||'')){tail=args.slice(1);args=args.slice(0,1);}
  else return null;
  const t=await resolveTarget({msg:e.msg,args,roomId:e.roomId,noticeTarget:l=>noticeTarget(e.roomId,l),fetchMessage});
  if(!t||!valid(t.id))return null;
  return {target:{id:t.id,name:name(e.roomId,t.id,t.name)},tail:tail.join(' ').trim()};
 }
 function usage(cmd){return format('ADMIN',cmd==='경고'?'사용법 : -경고 @대상 사유 / -경고 아이디 사유\n답장 : -경고 사유\n닉네임에 공백이 있을 경우 멘션 뒤에 | 로 사유 구분':cmd==='경고삭제'?'사용법 : -경고삭제 @대상 [경고번호]\n아이디 또는 답장도 가능 (번호 생략 시 최근 경고 1건 삭제)':'사용법 : -경고내역 @대상 [페이지]\n아이디 또는 답장도 가능');}
 async function execute(e,cmd){
  if(!canManage?.(e))return format('ADMIN','관리 권한이 없습니다.');
  const parsed=await parse(e);if(!parsed)return usage(cmd);
  const {target:t,tail}=parsed,r=e.roomId;
  if(cmd!=='경고내역'&&(t.id===String(botId())||t.id===e.userId))return format('ADMIN','본인 또는 봇은 대상으로 지정할 수 없습니다.');
  const state=load(r),prior=state.users[t.id]||{next:1,rows:[]},rows=prior.rows;
  if(cmd==='경고'){
   const reason=clean(tail,200);if(!reason||[...tail].length>200)return format('ADMIN','경고 사유를 1~200자로 입력해 주세요.');
   const row={number:prior.next,reason,actorId:e.userId,actorName:name(r,e.userId,e.msg?.sender?.name),at:now()};
   save(r,{users:{...state.users,[t.id]:{next:prior.next+1,rows:[...rows,row]}}});
   auditAction(e,t,'-경고','경고 #'+row.number+' 부여 · 누적 '+(rows.length+1)+'회 · '+reason);
   return format('WARNING',t.name+'님에게 경고를 부여하였습니다.\n사유 : '+reason+'\n누적 경고 : '+(rows.length+1)+'회');
  }
  if(tail&&!/^[1-9]\d{0,8}$/.test(tail))return usage(cmd);
  if(cmd==='경고삭제'){
   if(!rows.length)return format('WARNING',t.name+'님의 경고 내역이 없습니다.');
   const number=tail?Number(tail):rows.at(-1).number,row=rows.find(x=>x.number===number);
   if(!row)return format('WARNING','해당 경고 번호가 없습니다.');
   const remaining=rows.filter(x=>x.number!==number);
   save(r,{users:{...state.users,[t.id]:{next:prior.next,rows:remaining}}});
   auditAction(e,t,'-경고삭제','경고 #'+number+' 삭제 · 남은 '+remaining.length+'회 · '+row.reason);
   return format('WARNING',t.name+'님의 경고를 삭제하였습니다.\n삭제 사유 : '+row.reason+'\n남은 경고 : '+remaining.length+'회');
  }
  const pages=Math.max(1,Math.ceil(rows.length/PAGE)),page=tail?Number(tail):1;if(page>pages)return format('WARNING','존재하지 않는 페이지입니다. (1~'+pages+')');
  const details=rows.slice().reverse().slice((page-1)*PAGE,page*PAGE).map(row=>'경고 번호 : '+row.number+'\n사유 : '+row.reason+'\n부여 관리자 : '+row.actorName+'\n부여 시각 : '+time(row.at)).join('\n\n'+LINE+'\n\n');
  return fold(format('WARNING',t.name+'님의 경고 내역\n누적 경고 : '+rows.length+'회'),LINE+'\n[ 경고 상세 · '+page+'/'+pages+' 페이지 ]\n\n'+(details||'등록된 경고가 없습니다.')+'\n\n'+LINE+'\n아이디 : '+t.id+'\n시간 기준 : 한국 시간'+(pages>1?'\n다른 페이지 : -경고내역 '+t.id+' [페이지]':''));
 }
 function register(core){for(const [cmd,desc] of [['경고','사유와 함께 경고 부여'],['경고삭제','경고 번호 또는 최근 1건 삭제'],['경고내역','대상 경고 내역 확인']])core.register({name:cmd,section:'MANAGEMENT',description:desc+' (멘션 / 아이디 / 답장)',execute:e=>execute(e,cmd)});}
 return {register};
}
module.exports={createWarnings};
