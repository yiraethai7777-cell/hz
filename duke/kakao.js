'use strict';
const {createCore}=require('./core');
const {performance}=require('node:perf_hooks');
const {createCounter}=require('./metrics');
const {createMembership}=require('./manage/membership');
function id(value){if(typeof value==='number'&&!Number.isSafeInteger(value))return null;const s=String(value??'');return /^[1-9]\d*$/.test(s)?s:null;}
function normalize(msg,receivedAt=performance.now()){const raw=msg?.raw?.chatLog??msg?.raw??{};return {roomId:id(raw.chatRoomId??raw.chatId??msg?.raw?.chatId)??id(msg?.room?.id??msg?.chatId),userId:id(raw.userId??raw.authorId??raw.senderId??msg?.sender?.id??msg?.senderId),text:raw.message??raw.msg??raw.text??msg?.message?.text??msg?.text,receivedAt:Number.isFinite(msg?.receivedAt)?msg.receivedAt:receivedAt};}
async function startKakao({authPath,dataDir,website,roomList}){
 const rooms=roomList?new Set(roomList.split(',').map(x=>x.trim()).filter(x=>id(x))):null;
 if(rooms&&!rooms.size)throw Error('Invalid test rooms');
 const {createClient}=require('../dist');
 const client=createClient({authPath,autoConnect:false,autoReconnect:true,debug:false});
 let ready=false;
 const send=async(roomId,body)=>{const r=await client.chat.sendText(roomId,body);if(r?.status!=null&&r.status!==0)throw Error('send failed');return r;};
 const membership=createMembership({dir:dataDir,allowedRooms:rooms,botId:()=>id(client.userId),send,lookupProfile:(roomId,userId)=>{const type=client.getUserOpenProfileType(roomId,userId);if([1,2,4].includes(type))return '';return client.getUserOpenProfileLink(roomId,userId);}});
 const core=createCore({allowedRooms:rooms,counter:createCounter({dir:dataDir}),website,getStatus:()=>({kakaoConnected:ready,manage:'입퇴장 알림 지원',manageRooms:membership.activeCount()}),send});
 membership.register(core);
 client.onJoin(event=>{if(ready)void membership.handle('join',event);});
 client.onLeave(event=>{if(ready)void membership.handle('leave',event);});
 client.on('error',()=>{ready=false;console.error('[DUKE] connection error');});
 client.on('disconnect',()=>{ready=false;});
 client.onReady(()=>{ready=true;console.log('[DUKE] ready');});
 client.on('message',(...args)=>{const receivedAt=performance.now();void core.handle(normalize(args.length===1?args[0]:args[1],receivedAt));});
 await client.connect();return {client,core};
}
module.exports={startKakao,normalize,id};
