'use strict';
const fs=require('node:fs'),path=require('node:path'),{format,fold}=require('../core'),{canConfigure}=require('../manage/owner-permission'),{resolveTarget,mentions,reference}=require('../manage/targets'),{validLink}=require('./open-profile-link');
const MAX_LINKS=100,PAGE=10,MAX_CACHE=256;
const id=v=>typeof v==='string'&&/^[1-9]\d*$/.test(v);
const clean=v=>[...String(v??'').replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/gu,' ').trim()].slice(0,80).join('');
const canonical=v=>validLink(v).replace(/\/$/,'');
const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function createProfileHistory({dir,botId=()=>'',isEnabled=()=>true,allowedRooms=null,onPersist=()=>{},getName=()=>'',fetchMessage,noticeTarget=()=>null,now=Date.now,logger=console}={}){
 const root=dir?path.join(dir,'profile-history'):null,cache=new Map();
 if(root)fs.mkdirSync(root,{recursive:true,mode:0o700});
 function touch(key,data){cache.delete(key);cache.set(key,data);while(cache.size>MAX_CACHE)cache.delete(cache.keys().next().value);return data;}
 function load(key){
  if(cache.has(key))return touch(key,cache.get(key));
  let data={name:'',links:[]};
  if(root)try{data=JSON.parse(fs.readFileSync(path.join(root,key+'.json'),'utf8'));if(typeof data?.name!=='string'||!Array.isArray(data.links)||data.links.length>MAX_LINKS||data.links.some(x=>!x||!canonical(x.url)||!Number.isSafeInteger(x.at)||x.at<0||x.at>8640000000000000))throw Error('invalid profile history');}catch(e){if(e.code!=='ENOENT')throw e;}
  return touch(key,data);
 }
 function observe(r,u,name,urls){
  if(!id(r)||!id(u)||u===String(botId())||!isEnabled(r)||(allowedRooms&&!allowedRooms.has(r)))return false;
  const verified=[...new Set((Array.isArray(urls)?urls:[urls]).map(canonical).filter(Boolean))];if(!verified.length)return false;
  try{
   const key=r+'-'+u,data=load(key),known=new Set(data.links.map(x=>canonical(x.url))),at=now(),added=verified.filter(url=>!known.has(url)).map(url=>({url,at}));
   if(!added.length)return false;
   const next={name:clean(name)||data.name,links:[...data.links,...added].slice(-MAX_LINKS)};
   if(root){const file=path.join(root,key+'.json'),tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(next),{mode:0o600});fs.renameSync(tmp,file);}
   touch(key,next);if(root)onPersist('profile-history/'+key+'.json');return true;
  }catch(e){logger.error('[DUKE] profile history save failed',e?.name||'Error');return false;}
 }
 async function execute(e){
  if(!canConfigure(e,botId)||!isEnabled(e.roomId)||(allowedRooms&&!allowedRooms.has(e.roomId)))return format('ADMIN','봇 계정, 방장, 부방장만 사용할 수 있습니다.');
  const usage='사용법 : -프로필로그 @대상 / -프로필로그 아이디 / 답장으로 -프로필로그\n다음 페이지 : -프로필로그 아이디 페이지';
  let args=e.args,page=1;
  if(args.length===2&&/^[1-9]\d{3,}$/.test(args[0])&&/^[1-9]\d?$/.test(args[1])){page=Number(args[1]);args=[args[0]];}
  const self=!args.length&&!mentions(e.msg).length&&!reference(e.msg);
  const t=self?{id:e.userId,name:e.msg?.sender?.name}:await resolveTarget({msg:e.msg,args,roomId:e.roomId,noticeTarget:l=>noticeTarget(e.roomId,l),fetchMessage});
  if(!t||!id(t.id))return usage;
  if(!isEnabled(e.roomId))return null;
  const data=load(e.roomId+'-'+t.id),name=clean(getName(e.roomId,t.id)||t.name||data.name)||'사용자',total=data.links.length;
  if(!total)return format('PROFILE',name+'님의 저장된 오픈프로필 기록이 없습니다.\n기능 추가 이후 확인된 링크만 조회됩니다.');
  const pages=Math.ceil(total/PAGE);if(page>pages)return '페이지는 1~'+pages+'까지 조회할 수 있습니다.';
  const rows=data.links.slice().reverse().slice((page-1)*PAGE,page*PAGE);
  const detail='[ 오픈프로필 기록 ]\n\n'+rows.map((v,i)=>String((page-1)*PAGE+i+1)+'. '+date.format(v.at)+' KST\n'+v.url).join('\n\n')+'\n\n페이지 : '+page+' / '+pages+(page<pages?'\n다음 : -프로필로그 '+t.id+' '+(page+1):'')+'\n※ 같은 방에서 확인된 링크 · 최초 기록 시각';
  return fold(format('PROFILE',name+'님의 프로필 로그\n저장된 링크 : '+total+'개'),detail);
 }
 return {observe,register(core){core.register({name:'프로필로그',section:'OWNER',description:'이 방의 오픈프로필 링크 기록 조회 (멘션 / 아이디 / 답장)',execute});}};
}
module.exports={createProfileHistory};
