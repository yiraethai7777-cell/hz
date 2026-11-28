'use strict';
const {createCore}=require('./core');
const {performance}=require('node:perf_hooks');
const {createCounter}=require('./metrics');
const {createMembership}=require('./manage/membership');
const {createReplyModeration}=require('./manage/reply-moderation');
const {registerBulkKick}=require('./manage/bulk-kick');
const {createManagementLog}=require('./manage/audit-log');
const {createWarnings}=require('./manage/warnings');
const {createProfilePhoto}=require('./utility/profile-photo');
const {createUserId}=require('./utility/user-id');
const {createOpenProfileLink}=require('./utility/open-profile-link');
const {createProfileHistory}=require('./utility/profile-history');
const {createUserInfo}=require('./manage/user-info');
const {createActivity}=require('./manage/activity');
const {createChatRanking}=require('./utility/chat-ranking');
const {createProfileWatch}=require('./manage/profile-watch');
const {createDeleteWatch}=require('./manage/delete-watch');
const {createGameAccounts}=require('./game/accounts');
const {createQuiz}=require('./game/quiz');
const {createTyping}=require('./game/typing');
const {createAttendance}=require('./utility/attendance');
const {createGameCooldowns}=require('./game/cooldowns');
const {registerValorant}=require('./valorant/register');
const {createChatHide}=require('./manage/chat-hide');
const {createHideConfirmation}=require('./manage/hide-confirmation');
const {previousChats}=require('./manage/chat-hide-history');
const {createBotPower}=require('./manage/bot-power');
const {createRoomModes}=require('./manage/room-modes');
const {registerVoiceRoom}=require('./manage/voice-room');
const {createDukeVoiceAdapter}=require('../shared/vox30-runtime');
const voiceEvents=require('../shared/voice-room-auto-detect');
const voiceInvites=require('../shared/voice-room-join-info');
function id(value){if(typeof value==='number'&&!Number.isSafeInteger(value))return null;const s=String(value??'');return /^[1-9]\d*$/.test(s)?s:null;}
function normalize(msg,receivedAt=performance.now()){const raw=msg?.raw?.chatLog??msg?.raw??{};return {roomId:id(raw.chatRoomId??raw.chatId??msg?.raw?.chatId)??id(msg?.room?.id??msg?.chatId),userId:id(raw.userId??raw.authorId??raw.senderId??msg?.sender?.id??msg?.senderId),text:raw.message??raw.msg??raw.text??msg?.message?.text??msg?.text,receivedAt:Number.isFinite(msg?.receivedAt)?msg.receivedAt:receivedAt};}
async function startKakao({authPath,dataDir,website,roomList,database}){
 const rooms=roomList?new Set(roomList.split(',').map(x=>x.trim()).filter(x=>id(x))):null;
 if(rooms&&!rooms.size)throw Error('Invalid test rooms');
 const {createClient}=require('../dist');
 const client=createClient({authPath,autoConnect:false,autoReconnect:true,debug:false});
 let ready=false;
 let voiceAdapter;
 const send=async(roomId,body,opts)=>{const r=await client.chat.sendText(roomId,body,opts);if(r?.status!=null&&r.status!==0)throw Error('send failed');if(power.enabled(roomId))recordBotSend(roomId,r);return r;};
 const onPersist=key=>database?.mark(key);
 const audit=createManagementLog({dir:dataDir,onPersist});
 const power=createBotPower({dir:dataDir,onPersist,audit,botId:()=>id(client.userId),onChange:r=>{chatHide.resetRoom(r);watcher.resetRoom(r);deletion.resetRoom(r);quiz.cancel(r);typing.cancel(r);}});
 const modes=createRoomModes({dir:dataDir,onPersist,audit,botId:()=>id(client.userId),onManage:(r,on)=>{chatHide.resetRoom(r);membership.setAll(r,on);watcher.setAll(r,on);deletion.setAll(r,on);},onGame:(r,on)=>{if(!on){quiz.cancel(r);typing.cancel(r);}}});
 const manageEnabled=r=>power.enabled(r)&&modes.manage(r),gameEnabled=r=>power.enabled(r)&&modes.game(r);
 const activity=createActivity({dir:dataDir,onPersist,allowedRooms:rooms,botId:()=>id(client.userId)});
 function recordBotSend(roomId,result){try{const room=client._buildRoomPayload(roomId);activity.sent(room,result,client.getUserProfileSnapshot(roomId,client.userId)?.name||'듀크봇');}catch(err){console.error('[DUKE] bot chat count failed',err?.name||'Error');}}
 process.once('exit',()=>activity.close());
 const moderation=createReplyModeration({dir:dataDir,audit,onPersist,isEnabled:r=>modes.manage(r),onAction:activity.moderation,allowedRooms:rooms,botId:()=>id(client.userId),send,kick:(r,u)=>client.openChatKick(r,u),unban:(r,u)=>client.openChatUnkick(r,u),fetchMessage:(r,l)=>client.fetchMessage(r,l),getName:(r,u)=>client.getUserProfileSnapshot(r,u)?.name||''});
 const {inspectHideReadback}=require('./manage/hide-readback');
 const hideConfirmation=createHideConfirmation({request:(r,msg)=>client.openChatBlind(r,msg,{report:false}),readback:async(r,l,u)=>{
  if(!ready||!manageEnabled(r)||(rooms&&!rooms.has(r))||!client._carriage)return {state:'unavailable'};
  const response=await client._carriage.getMsgs([r],[l]);
  return inspectHideReadback(response,r,l,u);
 }});
 client.onHide(event=>hideConfirmation.observe(event));
 const chatHide=createChatHide({dir:dataDir,onPersist,allowedRooms:rooms,isEnabled:manageEnabled,canManage:moderation.canManage,botId:()=>id(client.userId),listAdmins:moderation.listAdmins,otherBotIds:String(process.env.DUKE_HIDE_BOT_IDS||'').split(/[,;\s]+/u),audit,hide:hideConfirmation.hide,loadHistory:(r,anchor,n,options)=>previousChats(client,r,anchor,n,options),fetchMessage:(r,l)=>client.fetchMessage(r,l),getRole:async(r,u)=>{
  const res=await client._carriage?.member(r,[u]);if(res?.status!==0||res.body?.status!=null&&Number(res.body.status)!==0)return null;
  const list=res.body?.members??res.body?.memberList??res.body?.memList;if(!Array.isArray(list))return null;
  const member=list.find(m=>id(m.userId??m.id??m.memberId??m.user_id)===u);if(!member)return null;
  const raw=member.mt??member.ut??member.userType??member.memberType??member.linkMemberType;return raw==null||String(raw).trim()===''?null:Number(raw);
 }});
 const deletion=createDeleteWatch({dir:dataDir,onPersist,allowedRooms:rooms,botId:()=>id(client.userId),canManage:moderation.canManage,isEnabled:manageEnabled,send,fetchCurrent:(r,l)=>client.fetchMessage(r,l),edit:(r,l,t)=>client.editMessage(r,l,t,{type:1,extra:'{}'}),remove:(r,l)=>client.deleteMessage(r,l)});
 process.once('exit',()=>deletion.close());
 const warnings=createWarnings({dir:dataDir,onPersist,audit,canManage:moderation.canManage,noticeTarget:moderation.noticeTarget,botId:()=>id(client.userId),fetchMessage:(r,l)=>client.fetchMessage(r,l),getName:(r,u)=>client.getUserProfileSnapshot(r,u)?.name||''});
 const profileHistory=createProfileHistory({dir:dataDir,onPersist,allowedRooms:rooms,isEnabled:manageEnabled,botId:()=>id(client.userId),getName:(r,u)=>client.getUserProfileSnapshot(r,u)?.name||'',noticeTarget:moderation.noticeTarget,fetchMessage:(r,l)=>client.fetchMessage(r,l)});
 const membership=createMembership({onProfileObserved:profileHistory.observe,dir:dataDir,audit,onPersist,allowedRooms:rooms,isEnabled:manageEnabled,botId:()=>id(client.userId),send,onLeaveNotice:moderation.recordLeave,lookupProfile:lookupMembershipProfile});
 const watcher=createProfileWatch({onProfileObserved:profileHistory.observe,dir:dataDir,onPersist,audit,allowedRooms:rooms,isEnabled:manageEnabled,botId:()=>id(client.userId),ready:()=>ready&&client.connected!==false,send,
  listRooms:async()=>{await client.getChatRooms();return client.getKnownChatRooms().filter(r=>client._buildRoomPayload(r.id).isOpenChat===true).map(r=>r.id);},
  lookupLinks:async ids=>{const urls=new Map();for(let i=0;i<ids.length;i+=10){const batch=ids.slice(i,i+10),res=await client._carriage.infoLink(batch);if(res?.status!==0)continue;for(const item of res.body?.ols||[]){const key=id(item.li);if(batch.includes(key)&&typeof item.lu==='string')urls.set(key,item.lu);}}return urls;},
  fetchRoster:async r=>{const res=await client._carriage.chatOnRoom({chatId:r,token:0,opt:0});if(!res||res.status!=null&&Number(res.status)!==0||res.body?.status!=null&&Number(res.body.status)!==0)throw Error('roster unavailable');const list=res.body?.m??res.body?.members??res.body?.memberList??res.body?.memList;if(!Array.isArray(list)||!list.length)throw Error('invalid roster');client._cacheMembers(r,list);return list;}
 });
 process.once('exit',()=>watcher.stop());
 const counter=createCounter({dir:dataDir,onPersist,deferMs:1000});
 process.once('exit',()=>{try{counter.flush();}catch(err){console.error('[DUKE] counter exit flush failed',err?.name||'Error');}});
 const accounts=createGameAccounts({dir:dataDir,onPersist,botId:()=>id(client.userId),canHandle:e=>power.canHandle(e)&&(modes.game(e.roomId)||power.isBot(e.userId)),getName:(r,u)=>client.getUserProfileSnapshot(r,u)?.name||'',fetchMessage:(r,l)=>client.fetchMessage(r,l)});
 const gameCooldowns=createGameCooldowns({dir:dataDir,onPersist,audit,botId:()=>id(client.userId)});
 const quiz=createQuiz({getCooldown:r=>gameCooldowns.get(r,'퀴즈')*1000,rewardQuiz:accounts.rewardQuiz,dir:dataDir,onPersist,send,botId:()=>id(client.userId),getName:(r,u)=>client.getUserProfileSnapshot(r,u)?.name||'',canHandle:e=>power.canHandle(e)&&(!rooms||rooms.has(e.roomId)),isEnabled:gameEnabled});
 const typing=createTyping({getCooldown:r=>gameCooldowns.get(r,'타자게임')*1000,send,getName:(r,u)=>client.getUserProfileSnapshot(r,u)?.name||'',canHandle:e=>power.canHandle(e)&&(!rooms||rooms.has(e.roomId)),isEnabled:gameEnabled});
 const core=createCore({allowedRooms:rooms,canHandle:power.canHandle,canExecute:modes.allow,counter,website,getStatus:()=>({...(database?.status()??{database:'미연결'}),kakaoConnected:ready,manage:'입퇴장 · 강퇴 · 관리로그 · 경고 · 프로필 감지 지원',manageRooms:modes.count('manage',client.getKnownChatRooms().filter(r=>power.enabled(r.id)&&client._buildRoomPayload(r.id).isOpenChat===true).map(r=>r.id)),gameRooms:modes.count('game',client.getKnownChatRooms().filter(r=>power.enabled(r.id)&&client._buildRoomPayload(r.id).isOpenChat===true).map(r=>r.id)),game:'게임 가입 · 지갑 · 송금 · 코인 순위 · 인벤토리 · 퀴즈 · 타자게임 지원'}),send});
 createChatRanking({list:activity.list,getName:(r,u)=>client.getUserProfileSnapshot(r,u)?.name||''}).register(core);
 createAttendance({dir:dataDir,onPersist,getName:(r,u)=>client.getUserProfileSnapshot(r,u)?.name||''}).register(core);
 accounts.register(core);
 quiz.register(core);
 typing.register(core);
 power.register(core);
 modes.register(core);
 gameCooldowns.register(core);
 registerValorant(core,{dir:dataDir,onPersist});
 deletion.register(core);
 watcher.register(core);
 membership.register(core);
 moderation.register(core);
 chatHide.register(core);
 registerBulkKick(core,{client,listAdmins:moderation.listAdmins,audit,kick:(r,u)=>client.openChatKick(r,u)});
 voiceEvents.install(client,{isManaged:()=>false,isBotEnabled:()=>false,send:()=>{}});
 voiceInvites.install(client);
 registerVoiceRoom(core,{
  canManage:moderation.canManage,
  getAdapter:()=>voiceAdapter,
  watchOpen:r=>voiceEvents.watchOpen(client,r),
  watchEnd:(r,callId)=>voiceEvents.watchEnd(client,r,callId),
  fetchMessage:(r,l)=>client.fetchMessage(r,l),
  inspectInvitation:async r=>voiceInvites.resolve(r) ? undefined : (await voiceInvites.inspectServerVoiceMeta(client,r)).invitation,
 });
 warnings.register(core);
 createProfilePhoto({botId:()=>id(client.userId),noticeTarget:moderation.noticeTarget,fetchMessage:(r,l)=>client.fetchMessage(r,l),sendPhoto:async(r,f,opts)=>{const res=await client.sendPhoto(r,f,opts);if(res?.complete&&power.enabled(r))recordBotSend(r,res);return res;},lookup:async(r,u)=>{const res=await client._carriage?.member(r,[u]);if(!res||res.status!==0)return null;const members=res.body?.members??res.body?.memberList??res.body?.memList;if(!Array.isArray(members))return null;const m=members.find(v=>id(v.userId??v.id??v.memberId??v.user_id)===u);if(!m)return null;client._cacheMembers(r,[m]);return {name:client.getUserProfileSnapshot(r,u)?.name,imageUrl:m.opi||m.originalProfileImageUrl||m.fpi||m.fullProfileImageUrl||m.pi||m.profileImageUrl||''};}}).register(core);
 async function lookupMembershipProfile(r,u,kind,event,partial){
  const cached=client.getUserProfileSnapshot(r,u);
  const raw=event?.raw,feed=raw?.feed;
  const list=[...(Array.isArray(feed?.members)?feed.members:[]),feed?.member,...(Array.isArray(raw?.members)?raw.members:[]),raw?.member].filter(Boolean);
  const match=list.find(m=>id(m.userId??m.id??m.memberId??m.user_id)===u);
  const type=Number(match?.ptp??match?.profileType),link=id(match?.pli??match?.profileLinkId);
  const fresh=Number.isFinite(type)&&type>0&&([1,2,4].includes(type)||!!link);
  if(kind==='leave'){
   const profileType=fresh?type:cached?.profileType;
   const profileId=fresh?link:id(cached?.profileLinkId);
   const entry=profileId?client._profileLinkUrls?.get(profileId):null;
   return {name:cached?.name,profileType,url:![1,2,4].includes(profileType)&&entry&&Date.now()-entry.checkedAt<300000?entry.url:''};
  }
  if(!fresh)return lookupCurrentProfile(r,u,partial);
  const profile={name:cached?.name,profileType:type,url:''};partial?.(profile);
  if([1,2,4].includes(type))return profile;
  const entry=client._profileLinkUrls?.get(link);
  if(entry&&Date.now()-entry.checkedAt<300000)return {...profile,url:entry.url};
  const res=await client._carriage.infoLink([link]);
  if(res?.status!==0)return profile;
  const links=res.body?.ols,current=Array.isArray(links)?links.find(v=>id(v.li)===link):null,url=current?.lu;
  if(typeof url==='string'&&/^https:\/\/open\.kakao\.com\/o\/[A-Za-z0-9_-]+\/?$/.test(url)){
   client._profileLinkUrls?.set(link,{url,checkedAt:Date.now()});return {...profile,url};
  }
  return profile;
 }
 const lookupCurrentProfile=async(r,u,partial)=>{
  const room=client._resolveChatId(r),res=await client._carriage?.member(room,[u]);
  if(!res||res.status!==0)return null;
  const list=res.body?.members??res.body?.memberList??res.body?.memList;
  const m=Array.isArray(list)?list.find(v=>id(v.userId??v.id??v.memberId??v.user_id)===u):null;
  if(!m)return null;
  client._cacheMembers(room,[m]);
  const profile={name:client.getUserProfileSnapshot(room,u)?.name,imageUrl:m.opi||m.originalProfileImageUrl||m.fpi||m.fullProfileImageUrl||m.pi||m.profileImageUrl||'',memberType:m.mt??m.ut??m.userType??m.memberType??m.linkMemberType,profileType:m.ptp??m.profileType,profileLinkId:id(m.pli),url:''};
  if(typeof partial==='function')partial(profile);
  const profileId=id(m.pli),type=Number(m.ptp??m.profileType);
  if(!profileId||[1,2,4].includes(type))return profile;
  if(typeof partial==='function'){const entry=client._profileLinkUrls?.get(profileId);if(entry&&Date.now()-entry.checkedAt<300000)return {...profile,url:entry.url};}
  try{
   const info=await client._carriage.infoLink([profileId]);
   if(info?.status===0){const links=info.body?.ols;const current=Array.isArray(links)?links.find(v=>id(v.li)===profileId):null;profile.url=current?.lu||'';if(typeof partial==='function'&&/^https:\/\/open\.kakao\.com\/o\/[A-Za-z0-9_-]+\/?$/.test(profile.url))client._profileLinkUrls?.set(profileId,{url:profile.url,checkedAt:Date.now()});}
  }catch{}
  return profile;
 };
 profileHistory.register(core);
 createOpenProfileLink({onProfileObserved:profileHistory.observe,botId:()=>id(client.userId),noticeTarget:moderation.noticeTarget,fetchMessage:(r,l)=>client.fetchMessage(r,l),lookup:lookupCurrentProfile}).register(core);
 createUserId({botId:()=>id(client.userId),getName:(r,u)=>client.getUserProfileSnapshot(r,u)?.name||'',noticeTarget:moderation.noticeTarget,fetchMessage:(r,l)=>client.fetchMessage(r,l)}).register(core);
 createUserInfo({canManage:moderation.canManage,noticeTarget:moderation.noticeTarget,fetchMessage:(r,l)=>client.fetchMessage(r,l),lookup:lookupCurrentProfile,role:moderation.role,getHistory:warnings.getHistory,getActivity:activity.get}).register(core);
 for(const method of ['BLIND','BLINDMSG','HIDEMSG','HIDE'])client.onPush(method,packet=>{if(ready)hideConfirmation.observePush(packet);});
 for(const method of ['SYNCREWR','SYNCMODMSG'])client.onPush(method,packet=>{if(ready){hideConfirmation.observePush(packet);void deletion.onRewrite(packet).catch(err=>console.error('[DUKE] rewrite event failed',err?.name||'Error'));}});
 client.onDelete(event=>{if(ready)void deletion.onDelete(event).catch(err=>console.error('[DUKE] delete event failed',err?.name||'Error'));});
 client.onJoin(event=>{if(ready&&power.enabled(id(event?.room?.id??event?.chatId))){activity.member('join',event);void membership.handle('join',event);}});
 client.onLeave(event=>{if(ready&&power.enabled(id(event?.room?.id??event?.chatId))){activity.member('leave',event);void membership.handle('leave',event);}});
 client.on('error',()=>{ready=false;hideConfirmation.reset();chatHide.reset();watcher.reset();quiz.reset();typing.reset();console.error('[DUKE] connection error');});
 client.on('disconnect',()=>{ready=false;hideConfirmation.reset();chatHide.reset();watcher.reset();quiz.reset();typing.reset();});
 client.onReady(()=>{
  try{voiceAdapter??=createDukeVoiceAdapter(client);}
  catch{console.warn('[DUKE] VOX adapter unavailable');}
  ready=true;watcher.start();console.log('[DUKE] ready');
 });
 const earlyQuiz=new WeakSet(),quizChecked=new WeakSet(),quizSeen=new Map();
 client.on('dukeQuizRaw',({data,roomId,receivedAt,livePush})=>{
  if(!ready||!data||typeof data!=='object')return;
  const r=id(roomId),raw=data.chatLog??data;
  if(!r||Number(raw.type??raw.msgType??1)!==1)return;
  const text=raw.message??raw.msg??raw.text??'',isCommand=typeof text==='string'&&(/^-(?:퀴즈|타자게임|출석|ㅊㅅ)(?:\s|$)/u.test(text)||text.trim()==='ㅊㅅ');
  if(!livePush){quizChecked.add(data);if(isCommand)earlyQuiz.add(data);return;}
  const log=id(raw.logId??raw.id??raw.msgId),key=log?r+':'+log:null;
  if(!key){quizChecked.add(data);if(isCommand)earlyQuiz.add(data);return;}
  if(quizSeen.has(key)){quizChecked.add(data);if(isCommand)earlyQuiz.add(data);return;}
  quizSeen.set(key,1);while(quizSeen.size>20000)quizSeen.delete(quizSeen.keys().next().value);
  if(!quiz.has(r)&&!typing.has(r)&&!isCommand){quizChecked.add(data);return;}
  const room=client._buildRoomPayload(r);if(room.isOpenChat!==true)return;
  const e=normalize({raw:data,chatId:r,receivedAt},receivedAt);if(e.roomId!==r||!e.userId||!power.canHandle(e)||(rooms&&!rooms.has(r)))return;
  const name=raw.authorName||raw.authorNickname||raw.nickName||raw.nickname||raw.name||data.authorNickname||data.authorName||client.getUserProfileSnapshot(r,e.userId)?.name||'';
  e.msg={room,sender:{id:e.userId,name},message:{type:1,logId:log},raw:data};
  quizChecked.add(data);
  if(isCommand){earlyQuiz.add(data);void core.handle(e);return;}
  if(typing.answer(e)||quiz.answer(e))earlyQuiz.add(data);
 });
 client.on('message',(...args)=>{const receivedAt=performance.now();const msg=args.length===1?args[0]:args[1];const e=normalize(msg,receivedAt);if(!ready||!power.canHandle(e))return;void chatHide.observe(msg,e).catch(err=>console.error('[DUKE] link moderation failed',err?.name||'Error'));if(power.enabled(e.roomId)){activity.chat(msg,e);if(deletion.observe(msg,e)===true)return;}if(msg?.raw&&earlyQuiz.has(msg.raw))return;e.msg=msg;if(!(msg?.raw&&quizChecked.has(msg.raw))&&(typing.answer(e)||quiz.answer(e)))return;if(ready&&modes.manage(e.roomId)&&/^l$/i.test(String(e.text??'').trim())){void deletion.handle(msg,e).catch(err=>console.error('[DUKE] delete view failed',err?.name||'Error'));return;}if(ready&&modes.manage(e.roomId)&&/^[ku]$/i.test(String(e.text??'').trim())){void moderation.handle(msg,e).catch(err=>console.error('[DUKE] reply moderation failed',err?.name||'Error'));return;}if(/^-(벤|내풀|관리로그|프사|옾링|프로필로그|id|정보|채팅순위|채팅순위전체|내채팅|닉변감지|프로필감지|삭제감지|수정감지|게임가입|지갑|송금|코인순위|코인지급|코인회수|인벤|퀴즈|타자게임|게임쿨타임|관리|게임|봇켜기|봇끄기|경고|경고삭제|경고내역|관리자추가|관리자삭제|입장알림|퇴장알림)(?:\s|$)/u.test(String(e.text??'')))e.msg=msg;void core.handle(e);});
 await client.connect();return {client,core};
}
module.exports={startKakao,normalize,id};
