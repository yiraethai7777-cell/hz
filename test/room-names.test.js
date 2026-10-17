'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
require('ts-node/register/transpile-only');
const {KakaoForgeClient}=require('../src/client/client');
test('room title metadata excludes live/voice titles, notices and JSON fragments',()=>{
 const c=Object.create(KakaoForgeClient.prototype);
 assert.equal(c._extractTitle({chatMetas:[{type:11,content:'{"title":"보이스룸 제목","liveon":true}'}]}),'');
 assert.equal(c._extractTitle({chatMetas:[{type:1,content:'공지 제목'},{type:'3',content:'실제 방 제목'},{type:11,content:'{"title":"다른 보이스룸"}'}]}),'실제 방 제목');
 assert.equal(c._extractTitle({chatMetas:[{type:3,content:'"인코딩된 방 제목"'}]}),'인코딩된 방 제목');
 assert.equal(c._extractTitle({meta:{type:11,content:'{"title":"보이스룸"}'},chatRoomName:'정확한 방 이름'}),'정확한 방 이름');
});
test('CHATINFO without room ID repairs the requested room name; open-link lookup resolves empty titles',async()=>{
 const c=Object.create(KakaoForgeClient.prototype);c._chatRooms=new Map([['100',{chatId:'100',isOpenChat:false,title:''}],['200',{chatId:'200',isOpenChat:true,title:'',openLinkId:'300'}]]);c._chatInfoInFlight=new Map();c._resolveChatId=x=>x;c._recordChatAlias=()=>{};
 c._carriage={chatInfo:async id=>({body:{chatInfo:{chatMetas:[{type:3,content:id==='100'?'복구된 방 이름':'오픈방'}],type:id==='100'?'MultiChat':'OM'}}})};
 c._ensureOpenLinkName=async()=> '진짜 오픈채팅방';
 await c._ensureChatInfo('100');assert.equal(c._chatRooms.get('100').title,'복구된 방 이름');
 await c.refreshChatRoomNames();assert.equal(c.getKnownChatRooms().find(r=>r.id==='200').name,'진짜 오픈채팅방');
});
