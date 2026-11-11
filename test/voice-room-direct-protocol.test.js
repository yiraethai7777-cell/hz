'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createDirectVoxBridge,positiveId,voiceTitle}=
  require('../shared/voice-room-direct-protocol');

const ROOM='18495931541358610';
const USER='418692594';
const BOT='9007199254740993123';

function mockWire(overrides={}) {
  const calls=[];
  let serverActive=false;
  const wire={
    identity:async()=>({userId:USER,authenticated:true}),
    roomMembership:async chatId=>({chatId,roomType:'OM',isMember:true}),
    makeVoiceRoom:async ({chatId,title})=>{
      calls.push({chatId,title});
      serverActive=true;
      return {requestAccepted:true};
    },
    voiceRoomStatus:async chatId=>({
      source:'kakao-server',chatId,active:serverActive,
      voiceRoomId:serverActive?'777':undefined,
    }),
    ...overrides,
  };
  return {wire,calls};
}

test('verified native transport accepts a creation with exact server evidence',async()=>{
  const {wire,calls}=mockWire();
  const bridge=createDirectVoxBridge({wire,expectedUserId:USER});
  assert.deepEqual(await bridge.create({roomId:ROOM,title:'테스트',botUserId:BOT}),{
    requestAccepted:true,verified:true,voiceRoomId:'777',
  });
  assert.deepEqual(calls,[{chatId:ROOM,title:'테스트'}]);
  assert.deepEqual(await bridge.status({roomId:ROOM,botUserId:BOT}),{
    roomId:ROOM,verified:true,active:true,voiceRoomId:'777',statusKnown:true,
  });
});

test('no raw VOX protocol is ever guessed when a native transport is missing',()=>{
  assert.throws(()=>createDirectVoxBridge({wire:{},expectedUserId:USER}),/클라이언트/);
  assert.throws(()=>createDirectVoxBridge({wire:null,expectedUserId:USER}),/클라이언트/);
});

test('wrong actor ID or room membership blocks the native mutation',async()=>{
  for(const changes of [
    {identity:async()=>({userId:BOT,authenticated:true})},
    {identity:async()=>({userId:USER,authenticated:false})},
    {roomMembership:async chatId=>({chatId,roomType:'OM',isMember:false})},
    {roomMembership:async chatId=>({chatId,roomType:'M',isMember:true})},
    {roomMembership:async()=>({chatId:BOT,roomType:'OM',isMember:true})},
  ]) {
    const {wire,calls}=mockWire(changes);
    const bridge=createDirectVoxBridge({wire,expectedUserId:USER});
    await assert.rejects(()=>bridge.create({roomId:ROOM,title:'테스트',botUserId:BOT}));
    assert.deepEqual(calls,[]);
  }
});

test('a native acknowledgement alone never becomes verified',async()=>{
  const {wire}=mockWire({
    voiceRoomStatus:async chatId=>({source:'local',chatId,active:true}),
  });
  const bridge=createDirectVoxBridge({wire,expectedUserId:USER});
  assert.deepEqual(await bridge.create({roomId:ROOM,title:'테스트',botUserId:BOT}),{
    requestAccepted:true,verified:false,
  });
  assert.deepEqual(await bridge.status({roomId:ROOM}),{
    roomId:ROOM,verified:false,active:undefined,voiceRoomId:undefined,statusKnown:false,
  });
});

test('rejects malformed IDs/titles without sending requests',async()=>{
  const {wire,calls}=mockWire();
  const bridge=createDirectVoxBridge({wire,expectedUserId:USER});
  for(const room of ['-1','0','not-an-id','9223372036854775808']) {
    await assert.rejects(()=>bridge.create({roomId:room,title:'테스트'}));
  }
  for(const title of ['','a'.repeat(41),'bad\ntext']){
    await assert.rejects(()=>bridge.create({roomId:ROOM,title}));
  }
  assert.throws(()=>positiveId('1e4'));
  assert.throws(()=>voiceTitle(' '));
  assert.deepEqual(calls,[]);
});

test('simultaneous native create requests for one actor are refused',async()=>{
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const {wire,calls}=mockWire({
    makeVoiceRoom:async ({chatId,title})=>{
      calls.push({chatId,title});
      await pending;
      return {requestAccepted:true};
    },
  });
  const bridge=createDirectVoxBridge({wire,expectedUserId:USER});
  const first=bridge.create({roomId:ROOM,title:'첫번째',botUserId:BOT});
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(()=>bridge.create({roomId:ROOM,title:'두번째',botUserId:BOT}),
    /다른 생성 요청/);
  release();
  await first;
  assert.equal(calls.length,1);
});
