'use strict';
const {createCore}=require('./core');
const {createCounter}=require('./metrics');
function id(value){if(typeof value==='number'&&!Number.isSafeInteger(value))return null;const s=String(value??'');return /^[1-9]\d*$/.test(s)?s:null;}
function parseSentAt(value){if(value==null)return null;const s=String(value);if(!/^\d+$/.test(s))return null;const n=Number(s);if(!Number.isSafeInteger(n))return null;if(n>=1000000000&&n<10000000000)return {ms:n*1000,precision:1000};if(n>=1000000000000&&n<10000000000000)return {ms:n,precision:1};return null;}
function normalize(msg){const raw=msg?.raw?.chatLog??msg?.raw??{};return {roomId:id(raw.chatRoomId??raw.chatId??msg?.raw?.chatId)??id(msg?.room?.id??msg?.chatId),userId:id(raw.userId??raw.authorId??raw.senderId??msg?.sender?.id??msg?.senderId),text:raw.message??raw.msg??raw.text??msg?.message?.text??msg?.text,sentAt:parseSentAt(raw.sendAt??raw.createdAt??raw.s)};}
async function startKakao({authPath,dataDir,website,roomList}){
 const rooms=roomList?new Set(roomList.split(',').map(x=>x.trim()).filter(x=>id(x))):null;
 if(rooms&&!rooms.size)throw Error('Invalid test rooms');
 const {createClient}=require('../dist');
 const client=createClient({authPath,autoConnect:false,autoReconnect:true,debug:false});
 let ready=false;
 const core=createCore({allowedRooms:rooms,counter:createCounter({dir:dataDir}),website,getStatus:()=>({kakaoConnected:ready}),send:async(roomId,body)=>{const r=await client.chat.sendText(roomId,body);if(r?.status!=null&&r.status!==0)throw Error('send failed');return r;}});
 client.on('error',()=>{ready=false;console.error('[DUKE] connection error');});
 client.on('disconnect',()=>{ready=false;});
 client.onReady(()=>{ready=true;console.log('[DUKE] ready');});
 client.on('message',(...args)=>{void core.handle(normalize(args.length===1?args[0]:args[1]));});
 await client.connect();return {client,core};
}
module.exports={startKakao,normalize,id,parseSentAt};
