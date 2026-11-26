'use strict';
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {resolveTarget,mentions,reference}=require('../manage/targets');
const {format}=require('../core');
const MAX_BYTES=5*1024*1024;
function validImageUrl(value){
 if(typeof value!=='string'||value.length>4096||/[\r\n]/.test(value))return '';
 try{const u=new URL(value);const h=u.hostname.toLowerCase();return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(h==='kakaocdn.net'||h.endsWith('.kakaocdn.net')||h==='daumcdn.net'||h.endsWith('.daumcdn.net'))?u.href:'';}catch{return '';}
}
function imageType(buf){
 if(buf.length>8&&buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {ext:'png',mime:'image/png'};
 if(buf.length>3&&buf[0]===255&&buf[1]===216&&buf[2]===255)return {ext:'jpg',mime:'image/jpeg'};
 if(buf.length>12&&buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP')return {ext:'webp',mime:'image/webp'};
 if(buf.length>6&&['GIF87a','GIF89a'].includes(buf.toString('ascii',0,6)))return {ext:'gif',mime:'image/gif'};
 return null;
}
async function downloadImage(url,{fetcher=fetch}={}){
 const signal=AbortSignal.timeout(8000);let current=validImageUrl(url);if(!current)throw Error('unsupported URL');
 for(let n=0;n<3;n++){
  const res=await fetcher(current,{signal,redirect:'manual'});
  if([301,302,303,307,308].includes(res.status)){const next=res.headers.get('location');await res.body?.cancel();current=next?validImageUrl(new URL(next,current).href):'';if(!current)throw Error('unsupported redirect');continue;}
  if(!res.ok||!res.body)throw Error('image unavailable');
  if(Number(res.headers.get('content-length'))>MAX_BYTES){await res.body.cancel();throw Error('image too large');}
  const chunks=[];let size=0;
  for await(const chunk of res.body){size+=chunk.length;if(size>MAX_BYTES)throw Error('image too large');chunks.push(Buffer.from(chunk));}
  const data=Buffer.concat(chunks),type=imageType(data);
  if(!type)throw Error('unsupported image');
  return {data,...type};
 }
 throw Error('too many redirects');
}
function createProfilePhoto({lookup,fetchMessage,noticeTarget=()=>null,sendPhoto,download=downloadImage,now=Date.now,logger=console}={}){
 let active=0;const last=new Map();
 async function execute(e){
  if(e.msg?.room?.isOpenChat!==true)return format('SYSTEM','오픈채팅방에서만 사용할 수 있습니다.');
  const tags=mentions(e.msg),ref=reference(e.msg);
  const target=!e.args.length&&!tags.length&&!ref?{id:e.userId,name:e.msg?.sender?.name}:await resolveTarget({msg:e.msg,args:e.args,roomId:e.roomId,noticeTarget:l=>noticeTarget(e.roomId,l),fetchMessage});
  if(!target?.id)return format('SYSTEM','사용법 : -프사 / -프사 @대상 / -프사 아이디 / 답장');
  const key=e.roomId+':'+e.userId,at=now();
  if(last.has(key)&&at-last.get(key)<5000)return '프사 명령어는 5초 후 다시 사용해 주세요.';
  if(active>=2)return '사진 전송 중입니다. 잠시 후 다시 시도해 주세요.';
  last.delete(key);last.set(key,at);while(last.size>1024)last.delete(last.keys().next().value);
  active++;let dir;
  try{
   const profile=await lookup(e.roomId,target.id);
   const url=validImageUrl(profile?.imageUrl);
   if(!url)return '현재 채팅방에서 확인 가능한 프로필 사진이 없습니다.';
   const img=await download(url);
   if(!imageType(img.data)||img.data.length>MAX_BYTES)throw Error('invalid image');
   const type=imageType(img.data);
   dir=await fs.mkdtemp(path.join(os.tmpdir(),'duke-profile-'));
   const filename='profile.'+type.ext,file=path.join(dir,filename);
   await fs.writeFile(file,img.data,{flag:'wx',mode:0o600});
   const result=await sendPhoto(e.roomId,file,{filename,mime:type.mime,timeoutMs:12000});
   if(!result?.complete||(typeof result.complete.status==='number'&&result.complete.status!==0))throw Error('photo not confirmed');
   const name=[...String(profile.name||target.name||target.id).replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,' ').trim()].slice(0,80).join('')||target.id;
   return name+'님의 프사 전체보기\n'+url;
  }catch(err){logger.error('[DUKE] profile photo failed',err?.name||'Error');return '프로필 사진을 전송하지 못했습니다.';}
  finally{if(dir)await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});active--;}
 }
 return {register(core){core.register({name:'프사',description:'프로필 사진 전송 및 원본 링크 (본인 / 멘션 / 아이디 / 답장)',execute});}};
}
module.exports={createProfilePhoto,validImageUrl,imageType,downloadImage};
