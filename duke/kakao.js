'use strict';
const {createCore}=require('./core');
const {performance}=require('node:perf_hooks');
const {createCounter}=require('./metrics');
const {createMembership}=require('./manage/membership');
const {createReplyModeration}=require('./manage/reply-moderation');
const {createManagementLog}=require('./manage/audit-log');
const {createWarnings}=require('./manage/warnings');
const {createProfilePhoto}=require('./utility/profile-photo');
const {createOpenProfileLink}=require('./utility/open-profile-link');
function id(value){if(typeof value==='number'&&!Number.isSafeInteger(value))return null;const s=String(value??'');return /^[1-9]\d*$/.test(s)?s:null;}
function normalize(msg,receivedAt=performance.now()){const raw=msg?.raw?.chatLog??msg?.raw??{};return {roomId:id(raw.chatRoomId??raw.chatId??msg?.raw?.chatId)??id(msg?.room?.id??msg?.chatId),userId:id(raw.userId??raw.authorId??raw.senderId??msg?.sender?.id??msg?.senderId),text:raw.message??raw.msg??raw.text??msg?.message?.text??msg?.text,receivedAt:Number.isFinite(msg?.receivedAt)?msg.receivedAt:receivedAt};}
async function startKakao({authPath,dataDir,website,roomList,database}){
 const rooms=roomList?new Set(roomList.split(',').map(x=>x.trim()).filter(x=>id(x))):null;
 if(rooms&&!rooms.size)throw Error('Invalid test rooms');
 const {createClient}=require('../dist');
 const client=createClient({authPath,autoConnect:false,autoReconnect:true,debug:false});
 let ready=false;
 const send=async(roomId,body)=>{const r=await client.chat.sendText(roomId,body);if(r?.status!=null&&r.status!==0)throw Error('send failed');return r;};
 const onPersist=key=>database?.mark(key);
 const audit=createManagementLog({dir:dataDir,onPersist});
 const moderation=createReplyModeration({dir:dataDir,audit,onPersist,allowedRooms:rooms,botId:()=>id(client.userId),send,kick:(r,u)=>client.openChatKick(r,u),unban:(r,u)=>client.openChatUnkick(r,u),fetchMessage:(r,l)=>client.fetchMessage(r,l),getName:(r,u)=>client.getUserProfileSnapshot(r,u)?.name||''});
 const warnings=createWarnings({dir:dataDir,onPersist,audit,canManage:moderation.canManage,noticeTarget:moderation.noticeTarget,botId:()=>id(client.userId),fetchMessage:(r,l)=>client.fetchMessage(r,l),getName:(r,u)=>client.getUserProfileSnapshot(r,u)?.name||''});
 const membership=createMembership({dir:dataDir,audit,onPersist,allowedRooms:rooms,botId:()=>id(client.userId),send,onLeaveNotice:moderation.recordLeave,lookupProfile:(roomId,userId)=>{const type=client.getUserOpenProfileType(roomId,userId);if([1,2,4].includes(type))return '';return client.getUserOpenProfileLink(roomId,userId);}});
 const core=createCore({allowedRooms:rooms,counter:createCounter({dir:dataDir,onPersist}),website,getStatus:()=>({...(database?.status()??{database:'미연결'}),kakaoConnected:ready,manage:'입퇴장 · 강퇴 · 관리로그 · 경고 지원',manageRooms:membership.activeCount()}),send});
 membership.register(core);
 moderation.register(core);
 warnings.register(core);
 createProfilePhoto({noticeTarget:moderation.noticeTarget,fetchMessage:(r,l)=>client.fetchMessage(r,l),sendPhoto:(r,f,opts)=>client.sendPhoto(r,f,opts),lookup:async(r,u)=>{const res=await client._carriage?.member(r,[u]);if(!res||res.status!==0)return null;const members=res.body?.members??res.body?.memberList??res.body?.memList;if(!Array.isArray(members))return null;const m=members.find(v=>id(v.userId??v.id??v.memberId??v.user_id)===u);if(!m)return null;client._cacheMembers(r,[m]);return {name:client.getUserProfileSnapshot(r,u)?.name,imageUrl:m.opi||m.originalProfileImageUrl||m.fpi||m.fullProfileImageUrl||m.pi||m.profileImageUrl||''};}}).register(core);
 createOpenProfileLink({noticeTarget:moderation.noticeTarget,fetchMessage:(r,l)=>client.fetchMessage(r,l),lookup:async(r,u)=>{
  const room=client._resolveChatId(r),res=await client._carriage?.member(room,[u]);
  if(!res||res.status!==0)return null;
  const list=res.body?.members??res.body?.memberList??res.body?.memList;
  const m=Array.isArray(list)?list.find(v=>id(v.userId??v.id??v.memberId??v.user_id)===u):null;
  if(!m)return null;
  client._cacheMembers(room,[m]);
  const name=client.getUserProfileSnapshot(room,u)?.name;
  const profileId=id(m.pli),type=Number(m.ptp??m.profileType);
  if(!profileId||[1,2,4].includes(type))return {name,url:''};
  // Look up the fresh room-specific profile ID, not an older cached ID or URL.
  const info=await client._carriage.infoLink([profileId]);
  if(!info||info.status!==0)return {name,url:''};
  const links=info.body?.ols;
  const current=Array.isArray(links)?links.find(v=>id(v.li)===profileId):null;
  return {name,url:current?.lu||''};
 }}).register(core);
 client.onJoin(event=>{if(ready)void membership.handle('join',event);});
 client.onLeave(event=>{if(ready)void membership.handle('leave',event);});
 client.on('error',()=>{ready=false;console.error('[DUKE] connection error');});
 client.on('disconnect',()=>{ready=false;});
 client.onReady(()=>{ready=true;console.log('[DUKE] ready');});
 client.on('message',(...args)=>{const receivedAt=performance.now();const msg=args.length===1?args[0]:args[1];const e=normalize(msg,receivedAt);if(ready&&/^[ku]$/i.test(String(e.text??'').trim())){void moderation.handle(msg,e).catch(err=>console.error('[DUKE] reply moderation failed',err?.name||'Error'));return;}if(/^-(벤|내풀|관리로그|프사|옾링|경고|경고삭제|경고내역|관리자추가|관리자삭제|입장알림|퇴장알림)(?:\s|$)/u.test(String(e.text??'')))e.msg=msg;void core.handle(e);});
 await client.connect();return {client,core};
}
module.exports={startKakao,normalize,id};
