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
const {createUserInfo}=require('./manage/user-info');
const {createActivity}=require('./manage/activity');
const {createChatRanking}=require('./utility/chat-ranking');
const {createProfileWatch}=require('./manage/profile-watch');
const {createDeleteWatch}=require('./manage/delete-watch');
const {createGameAccounts}=require('./game/accounts');
const {createBotPower}=require('./manage/bot-power');
function id(value){if(typeof value==='number'&&!Number.isSafeInteger(value))return null;const s=String(value??'');return /^[1-9]\d*$/.test(s)?s:null;}
function normalize(msg,receivedAt=performance.now()){const raw=msg?.raw?.chatLog??msg?.raw??{};return {roomId:id(raw.chatRoomId??raw.chatId??msg?.raw?.chatId)??id(msg?.room?.id??msg?.chatId),userId:id(raw.userId??raw.authorId??raw.senderId??msg?.sender?.id??msg?.senderId),text:raw.message??raw.msg??raw.text??msg?.message?.text??msg?.text,receivedAt:Number.isFinite(msg?.receivedAt)?msg.receivedAt:receivedAt};}
async function startKakao({authPath,dataDir,website,roomList,database}){
 const rooms=roomList?new Set(roomList.split(',').map(x=>x.trim()).filter(x=>id(x))):null;
 if(rooms&&!rooms.size)throw Error('Invalid test rooms');
 const {createClient}=require('../dist');
 const client=createClient({authPath,autoConnect:false,autoReconnect:true,debug:false});
 let ready=false;
 const send=async(roomId,body,opts)=>{const r=await client.chat.sendText(roomId,body,opts);if(r?.status!=null&&r.status!==0)throw Error('send failed');if(power.enabled(roomId))recordBotSend(roomId,r);return r;};
 const onPersist=key=>database?.mark(key);
 const audit=createManagementLog({dir:dataDir,onPersist});
 const power=createBotPower({dir:dataDir,onPersist,audit,botId:()=>id(client.userId),onChange:r=>{watcher.resetRoom(r);deletion.resetRoom(r);}});
 const activity=createActivity({dir:dataDir,onPersist,allowedRooms:rooms,botId:()=>id(client.userId)});
 function recordBotSend(roomId,result){try{const room=client._buildRoomPayload(roomId);activity.sent(room,result,client.getUserProfileSnapshot(roomId,client.userId)?.name||'듀크봇');}catch(err){console.error('[DUKE] bot chat count failed',err?.name||'Error');}}
 process.once('exit',()=>activity.close());
 const moderation=createReplyModeration({dir:dataDir,audit,onPersist,onAction:activity.moderation,allowedRooms:rooms,botId:()=>id(client.userId),send,kick:(r,u)=>client.openChatKick(r,u),unban:(r,u)=>client.openChatUnkick(r,u),fetchMessage:(r,l)=>client.fetchMessage(r,l),getName:(r,u)=>client.getUserProfileSnapshot(r,u)?.name||''});
 const deletion=createDeleteWatch({dir:dataDir,onPersist,allowedRooms:rooms,botId:()=>id(client.userId),canManage:moderation.canManage,isEnabled:power.enabled,send,fetchCurrent:(r,l)=>client.fetchMessage(r,l),edit:(r,l,t)=>client.editMessage(r,l,t,{type:1,extra:'{}'}),remove:(r,l)=>client.deleteMessage(r,l)});
 process.once('exit',()=>deletion.close());
 const warnings=createWarnings({dir:dataDir,onPersist,audit,canManage:moderation.canManage,noticeTarget:moderation.noticeTarget,botId:()=>id(client.userId),fetchMessage:(r,l)=>client.fetchMessage(r,l),getName:(r,u)=>client.getUserProfileSnapshot(r,u)?.name||''});
 const membership=createMembership({dir:dataDir,audit,onPersist,allowedRooms:rooms,isEnabled:power.enabled,botId:()=>id(client.userId),send,onLeaveNotice:moderation.recordLeave,lookupProfile:(roomId,userId,kind)=>{if(kind==='join')return lookupCurrentProfile(roomId,userId);const type=client.getUserOpenProfileType(roomId,userId);if([1,2,4].includes(type))return '';return client.getUserOpenProfileLink(roomId,userId);}});
 const watcher=createProfileWatch({dir:dataDir,onPersist,audit,allowedRooms:rooms,isEnabled:power.enabled,botId:()=>id(client.userId),ready:()=>ready&&client.connected!==false,send,
  listRooms:async()=>{await client.getChatRooms();return client.getKnownChatRooms().filter(r=>client._buildRoomPayload(r.id).isOpenChat===true).map(r=>r.id);},
  lookupLinks:async ids=>{const urls=new Map();for(let i=0;i<ids.length;i+=10){const batch=ids.slice(i,i+10),res=await client._carriage.infoLink(batch);if(res?.status!==0)continue;for(const item of res.body?.ols||[]){const key=id(item.li);if(batch.includes(key)&&typeof item.lu==='string')urls.set(key,item.lu);}}return urls;},
  fetchRoster:async r=>{const res=await client._carriage.chatOnRoom({chatId:r,token:0,opt:0});if(!res||res.status!=null&&Number(res.status)!==0||res.body?.status!=null&&Number(res.body.status)!==0)throw Error('roster unavailable');const list=res.body?.m??res.body?.members??res.body?.memberList??res.body?.memList;if(!Array.isArray(list)||!list.length)throw Error('invalid roster');client._cacheMembers(r,list);return list;}
 });
 process.once('exit',()=>watcher.stop());
 const core=createCore({allowedRooms:rooms,canHandle:power.canHandle,counter:createCounter({dir:dataDir,onPersist}),website,getStatus:()=>({...(database?.status()??{database:'미연결'}),kakaoConnected:ready,manage:'입퇴장 · 강퇴 · 관리로그 · 경고 · 프로필 감지 지원',manageRooms:membership.activeCount(),game:'게임 가입 · 지갑 · 송금 · 코인 순위 · 인벤토리 지원'}),send});
 createChatRanking({list:activity.list,getName:(r,u)=>client.getUserProfileSnapshot(r,u)?.name||''}).register(core);
 createGameAccounts({dir:dataDir,onPersist,botId:()=>id(client.userId),canHandle:power.canHandle,getName:(r,u)=>client.getUserProfileSnapshot(r,u)?.name||'',fetchMessage:(r,l)=>client.fetchMessage(r,l)}).register(core);
 power.register(core);
 deletion.register(core);
 watcher.register(core);
 membership.register(core);
 moderation.register(core);
 warnings.register(core);
 createProfilePhoto({noticeTarget:moderation.noticeTarget,fetchMessage:(r,l)=>client.fetchMessage(r,l),sendPhoto:async(r,f,opts)=>{const res=await client.sendPhoto(r,f,opts);if(res?.complete&&power.enabled(r))recordBotSend(r,res);return res;},lookup:async(r,u)=>{const res=await client._carriage?.member(r,[u]);if(!res||res.status!==0)return null;const members=res.body?.members??res.body?.memberList??res.body?.memList;if(!Array.isArray(members))return null;const m=members.find(v=>id(v.userId??v.id??v.memberId??v.user_id)===u);if(!m)return null;client._cacheMembers(r,[m]);return {name:client.getUserProfileSnapshot(r,u)?.name,imageUrl:m.opi||m.originalProfileImageUrl||m.fpi||m.fullProfileImageUrl||m.pi||m.profileImageUrl||''};}}).register(core);
 const lookupCurrentProfile=async(r,u)=>{
  const room=client._resolveChatId(r),res=await client._carriage?.member(room,[u]);
  if(!res||res.status!==0)return null;
  const list=res.body?.members??res.body?.memberList??res.body?.memList;
  const m=Array.isArray(list)?list.find(v=>id(v.userId??v.id??v.memberId??v.user_id)===u):null;
  if(!m)return null;
  client._cacheMembers(room,[m]);
  const profile={name:client.getUserProfileSnapshot(room,u)?.name,imageUrl:m.opi||m.originalProfileImageUrl||m.fpi||m.fullProfileImageUrl||m.pi||m.profileImageUrl||'',memberType:m.mt??m.ut??m.userType??m.memberType??m.linkMemberType,profileType:m.ptp??m.profileType,profileLinkId:id(m.pli),url:''};
  const profileId=id(m.pli),type=Number(m.ptp??m.profileType);
  if(!profileId||[1,2,4].includes(type))return profile;
  try{
   const info=await client._carriage.infoLink([profileId]);
   if(info?.status===0){const links=info.body?.ols;const current=Array.isArray(links)?links.find(v=>id(v.li)===profileId):null;profile.url=current?.lu||'';}
  }catch{}
  return profile;
 };
 createOpenProfileLink({noticeTarget:moderation.noticeTarget,fetchMessage:(r,l)=>client.fetchMessage(r,l),lookup:lookupCurrentProfile}).register(core);
 createUserInfo({canManage:moderation.canManage,noticeTarget:moderation.noticeTarget,fetchMessage:(r,l)=>client.fetchMessage(r,l),lookup:lookupCurrentProfile,role:moderation.role,getHistory:warnings.getHistory,getActivity:activity.get}).register(core);
 for(const method of ['SYNCREWR','SYNCMODMSG'])client.onPush(method,packet=>{if(ready)void deletion.onRewrite(packet).catch(err=>console.error('[DUKE] rewrite event failed',err?.name||'Error'));});
 client.onDelete(event=>{if(ready)void deletion.onDelete(event).catch(err=>console.error('[DUKE] delete event failed',err?.name||'Error'));});
 client.onJoin(event=>{if(ready&&power.enabled(id(event?.room?.id??event?.chatId))){activity.member('join',event);void membership.handle('join',event);}});
 client.onLeave(event=>{if(ready&&power.enabled(id(event?.room?.id??event?.chatId))){activity.member('leave',event);void membership.handle('leave',event);}});
 client.on('error',()=>{ready=false;watcher.reset();console.error('[DUKE] connection error');});
 client.on('disconnect',()=>{ready=false;watcher.reset();});
 client.onReady(()=>{ready=true;watcher.start();console.log('[DUKE] ready');});
 client.on('message',(...args)=>{const receivedAt=performance.now();const msg=args.length===1?args[0]:args[1];const e=normalize(msg,receivedAt);if(!ready||!power.canHandle(e))return;if(power.enabled(e.roomId)){activity.chat(msg,e);if(deletion.observe(msg,e)===true)return;}if(ready&&/^l$/i.test(String(e.text??'').trim())){void deletion.handle(msg,e).catch(err=>console.error('[DUKE] delete view failed',err?.name||'Error'));return;}if(ready&&/^[ku]$/i.test(String(e.text??'').trim())){void moderation.handle(msg,e).catch(err=>console.error('[DUKE] reply moderation failed',err?.name||'Error'));return;}if(/^-(벤|내풀|관리로그|프사|옾링|정보|채팅순위|채팅순위전체|내채팅|닉변감지|프로필감지|삭제감지|수정감지|게임가입|지갑|송금|코인순위|코인지급|코인회수|인벤|봇켜기|봇끄기|경고|경고삭제|경고내역|관리자추가|관리자삭제|입장알림|퇴장알림)(?:\s|$)/u.test(String(e.text??'')))e.msg=msg;void core.handle(e);});
 await client.connect();return {client,core};
}
module.exports={startKakao,normalize,id};
