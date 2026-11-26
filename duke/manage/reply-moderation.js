'use strict';
const fs=require('node:fs'),path=require('node:path'),LosslessJSON=require('lossless-json');
const {format,fold}=require('../core');
function id(v){if(typeof v==='number'&&!Number.isSafeInteger(v))return '';const s=String(v??'');return /^[1-9]\d*$/.test(s)?s:'';}
function replyReference(msg,bot){
 const raw=msg?.raw?.chatLog??msg?.raw?.chatlog??msg?.raw;
 const thread=id(raw?.threadId??raw?.tid??raw?.thread??msg?.raw?.threadId??msg?.message?.threadId??msg?.threadId);
 if(thread)return thread;
 if(Number(msg?.message?.type??msg?.type??raw?.type)!==26)return '';
 for(let root of [...(Array.isArray(msg?.attachmentsRaw)?msg.attachmentsRaw:[]),msg?.message?.attachment,raw?.attachment,raw?.extra]){
  if(typeof root==='string'){try{root=LosslessJSON.parse(root);}catch{continue;}}
  for(const v of Array.isArray(root)?root:[root])if(v&&typeof v==='object'&&id(v.src_userId??v.srcUserId)===bot){const log=id(v.src_logId??v.srcLogId);if(log)return log;}
 }
 return '';
}
function createReplyModeration({dir,allowedRooms=null,botId=()=>'',send,kick,unban,now=Date.now,logger=console}={}){
 const file=dir?path.join(dir,'reply-moderation.json'):null;
 let state={admins:{},notices:{}};
 if(file){fs.mkdirSync(dir,{recursive:true,mode:0o700});try{const v=JSON.parse(fs.readFileSync(file,'utf8'));if(!v.admins||!v.notices)throw Error('invalid moderation state');state=v;}catch(e){if(e.code!=='ENOENT')throw e;}}
 const locked=new Set();
 function save(){if(file){const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(state),{mode:0o600});fs.renameSync(tmp,file);}}
 function index({roomId,userId,name,result,kind}){
  const bot=id(botId()),r=id(roomId),u=id(userId);if(!bot||!r||!u||u===bot)return false;
  let indexed=false;for(const res of Array.isArray(result)?result:[result]){
   const log=id(res?.body?.logId??res?.logId);if(!log)continue;
   const key=r+':'+log;state.notices[key]={bot,roomId:r,userId:u,name:String(name),kind,used:false,at:now()};indexed=true;
  }
  if(indexed){const keys=Object.keys(state.notices);for(const k of keys){const n=state.notices[k];if(n.kind==='leave'&&(n.used||now()-n.at>7*86400000))delete state.notices[k];}const leaves=Object.keys(state.notices).filter(k=>state.notices[k].kind==='leave');for(const k of leaves.slice(0,Math.max(0,leaves.length-5000)))delete state.notices[k];save();}return indexed;
 }
 function register(core){
  for(const [name,add] of [['관리자추가',true],['관리자삭제',false]])core.register({name,section:'MANAGEMENT',description:'방별 추가 관리자 '+(add?'등록':'삭제')+' (사용자 ID)',execute:e=>{
   if(e.userId!==id(botId()))return format('ADMIN','봇 계정만 설정할 수 있습니다.');
   const target=id(e.args[0]);if(e.args.length!==1||!target||target===id(botId()))return format('ADMIN','사용법 : -'+name+' (사용자 ID)');
   const list=new Set(state.admins[e.roomId]||[]);if(add)list.add(target);else list.delete(target);state.admins[e.roomId]=[...list];save();return format('ADMIN','관리자 '+(add?'추가':'삭제')+' 완료\n아이디 : '+target);
  }});
 }
 async function handle(msg,e){
  const r=id(e.roomId),actor=id(e.userId),bot=id(botId()),cmd=String(e.text??'').trim().toLowerCase();
  if(!r||!actor||!bot||!['k','u'].includes(cmd)||msg?.room?.isOpenChat!==true||(allowedRooms&&!allowedRooms.has(r)))return false;
  const log=replyReference(msg,bot),n=log?state.notices[r+':'+log]:null;
  if(!n||n.bot!==bot||n.roomId!==r||n.kind!==(cmd==='k'?'leave':'ban')||n.used)return false;
  if(n.kind==='leave'&&now()-n.at>7*86400000)return false;
  if(actor!==bot&&![1,4].includes(Number(msg?.sender?.type))&&!(state.admins[r]||[]).includes(actor)){await send(r,format('ADMIN','관리 권한이 없습니다.'));return true;}
  if(n.userId===actor||n.userId===bot)return false;
  const targetKey=r+':'+n.userId;
  if(locked.has(targetKey))return true;
  locked.add(targetKey);
  try{
   if(n.used)return true;
   const res=await (cmd==='k'?kick:unban)(r,n.userId);
   if(cmd==='k'?(res?.status!==0||res?.success===false||res?.ok===false):(res?.success!==true||res?.verified!==true))throw Error('API unverified');
   n.used=true;save();
   if(cmd==='k'){
    const summary=n.name+'님을 강퇴하였습니다.';
    const body=fold(summary,'━━━━━━━━━━━━━━\n[ 벤 해제 방법 ]\n\n이 메시지에 답장으로 u 입력 시 벤이 해제됩니다.\n(방장·부방장·추가 관리자)\n\n아이디 : '+n.userId+'\n━━━━━━━━━━━━━━');
    const result=await send(r,body);
    if(!index({roomId:r,userId:n.userId,name:n.name,result,kind:'ban'}))logger.error('[DUKE] missing ban notice log ID');
   }else{await send(r,n.name+'님의 벤을 해제하였습니다.');delete state.notices[r+':'+log];save();}
   return true;
  }catch(err){logger.error('[DUKE] moderation action failed',cmd,err?.name||'Error');await send(r,format('ADMIN',n.used?'처리 완료 후 알림 기록에 문제가 발생했습니다.':(cmd==='k'?'강퇴':'벤 해제')+' 요청 실패 또는 결과 미확인'));return true;}finally{locked.delete(targetKey);}
 }
 return {register,handle,recordLeave:data=>index({...data,kind:'leave'})};
}
module.exports={createReplyModeration,replyReference};
