'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
// Voice routing is tested without a real PostgreSQL instance. This only
// mocks DB reads/command-block schema setup; integration tests use real DB.
const dbModule=require('../shared/db');
let testRoomVoiceEnabled='true';
let testRoomBotEnabled='true';
let testRoomRecordExists=true;
let testRoomSubscriptionAccess={allowed:true,subscription:null};
dbModule.getPool=()=>({query:async sql=>/voiceRoomEnabled/.test(sql)
  ? {rows:[{voice_enabled:testRoomVoiceEnabled}],rowCount:1}
  : /botEnabled/.test(sql)
    ? testRoomRecordExists
      ? {rows:[{enabled:testRoomBotEnabled,arden_clan:'false'}],rowCount:1}
      : {rows:[],rowCount:0}
    : {rows:[],rowCount:0}});
// Mock a grandfathered, active room so voice routing tests stay focused on the
// voice handler; subscription-expiry behavior is exercised by room-subscriptions.test.js.
require('../shared/room-subscriptions').access=async()=>testRoomSubscriptionAccess;
const {attachRouter}=require('../shared/router');

function fixture() {
  const sent=[];
  let callback;
  const client={
    userId:'9007199254740993123',
    connected:true,
    onMessage(fn){callback=fn;},
    chat:{sendText:async (roomId,body)=>{sent.push({roomId,body});return {status:0,body:{logId:'88888'}};}},
    _activeChatId:'18495931541358610',
    _getCachedMemberType:()=>4
  };
  const ready=new Promise(()=>{}); // unrelated game or DB init never completes
  const game={toggle:async()=>{throw Error('not applicable');},
    message:async()=>{throw Error('not applicable');}};
  const management={message:async()=>{throw Error('not applicable');}};
  attachRouter(client,{game,management,ready});
  const emit=(text,senderType=1,senderId='9007199254740993444')=>callback({
    room:{id:'18495931541358610',isOpenChat:true},
    sender:{id:senderId,type:senderType},
    message:{text}
  });
  return {client,ready,emit,sent};
}

test('voice-room status is handled without waiting for global ready',async()=>{
  const {emit,sent}=fixture();
  await emit('#보룸상태');
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/🎙️ 보이스룸 상태/);
  assert.match(sent[0].body,/직접 VOX 인증 미연결/);
});

test('legacy !보룸켜기 example is recognized before ready',async()=>{
  const {emit,sent}=fixture();
  await emit('!보룸켜기');
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/직접 VOX 보이스룸 생성 기능은 인증 연동 전입니다/);
});

test('status returns manager-only message for regular member even before ready',async()=>{
  const {emit,sent}=fixture();
  await emit('#보룸상태',2);
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/방장·부방장 또는 봇 계정만/);
});

test('supported alternative #보이스룸상태 replies before ready',async()=>{
  const {emit,sent}=fixture();
  await emit('#보이스룸상태');
  assert.match(sent[0].body,/보이스룸 상태/);
});

test('voice command logs an exception and attempts a user-visible error',async()=>{
  const {emit,sent,client}=fixture();
  // malformed chat ID causes synchronous exception inside voice-room handler
  await client.chat.sendText('18495931541358610','initial');
  const msg={room:{id:'abc',isOpenChat:true},
    sender:{id:'9007199254740993444',type:1},message:{text:'#보룸상태'}};
  // Separate fixture to capture raw callback via onMessage
  let cb;
  client.onMessage=fn=>{cb=fn;};
  attachRouter(client,{game:{},management:{},ready:new Promise(()=>{})});
  await cb(msg);
  assert.match(sent.at(-1).body,/명령어 처리 중 오류/);
});


test('bare 보룸상태 without a prefix also replies',async()=>{
  const {emit,sent}=fixture();
  await emit('보룸상태');
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/보이스룸 상태/);
});

test('bare 보룸켜기 without a prefix responds with unsupported protocol explanation',async()=>{
  const {emit,sent}=fixture();
  await emit('보룸켜기');
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/직접 VOX 보이스룸 생성 기능은 인증 연동 전입니다/);
});


test('same Kakao account as bot can execute status without being silently ignored',async()=>{
  const {client,sent}=fixture();
  let callback;
  client.onMessage=handler=>{callback=handler;};
  attachRouter(client,{game:{},management:{},ready:new Promise(()=>{})});
  await callback({
    room:{id:'18495931541358610',isOpenChat:true},
    sender:{id:client.userId,type:1},
    message:{text:'#보룸상태'}
  });
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/보이스룸 상태/);
});


test('voice status sends a WRITE with confirmed logId',async()=>{
  const {emit,sent}=fixture();
  await emit('#보룸상태');
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/보이스룸 상태/);
});

test('failed WRITE still returns from command handler and logs failure',async()=>{
  const {emit,client}=fixture();
  const original=client.chat.sendText;
  let attempts=0;
  client.chat.sendText=async(...args)=>{
    attempts++;
    throw Error('WRITE failed: status=-203');
  };
  await emit('#보룸상태');
  assert.equal(attempts,1);
  client.chat.sendText=original;
});

test('voice stop command routes without waiting for global ready',async()=>{
  const {emit,sent}=fixture();
  await emit('#보룸끄기');
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/실제 보이스룸 종료 API/);
});

test('voice help command routes without requiring an active driver',async()=>{
  const {emit,sent}=fixture();
  await emit('!보룸명령어');
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/카카오톡 관리 매니저 \| 보이스룸 명령어/);
});

test('screenshotted #보룸시작 receives an unsupported API response',async()=>{
  const {emit,sent}=fixture();
  await emit('#보룸시작 .');
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/직접 VOX 보이스룸 생성 기능은 인증 연동 전입니다/);
});

test('bot account with ordinary sender role can issue #보룸시작',async()=>{
  const {emit,sent,client}=fixture();
  await emit('#보룸시작',2,client.userId);
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/직접 VOX 보이스룸 생성 기능은 인증 연동 전입니다/);
  assert.doesNotMatch(sent[0].body,/방장·부방장 또는 봇 계정만/);
});

test('ordinary non-bot chat members still cannot issue voice-room commands',async()=>{
  const {emit,sent}=fixture();
  await emit('#보룸시작',2);
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/방장·부방장 또는 봇 계정만/);
});

test('bot account with ordinary sender role can query status',async()=>{
  const {emit,sent,client}=fixture();
  await emit('#보룸상태',2,client.userId);
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/보이스룸 상태/);
});

test('alias #보룸종료 routes to stop handler',async()=>{
  const {emit,sent}=fixture();
  await emit('#보룸종료');
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/종료 API/);
});


test('observation commands route before unrelated DB/game ready', async () => {
  const { emit, sent } = fixture();
  const observer = require('../shared/voice-room-observer');
  const roomId = '18495931541358610';
  try {
    await emit('#보룸감지시작');
    assert.match(sent.at(-1).body, /3분간 시작/);
    await emit('#보룸감지');
    assert.match(sent.at(-1).body, /판정: 확인 불가/);
    observer.observeMessage({
      room: { id: roomId, isOpenChat: true },
      message: { type: 52, text: 'do not include me' },
    });
    await emit('#보룸감지');
    assert.match(sent.at(-1).body, /관련 이벤트 후보: 1건/);
    assert.match(sent.at(-1).body, /실제 개설\/활성 여부 미확정/);
    assert.doesNotMatch(sent.at(-1).body, /do not include me/);
    await emit('#보룸감지종료');
    assert.match(sent.at(-1).body, /감지를 종료/);
  } finally {
    observer.stop(roomId);
  }
});

test('observation commands remain manager-or-bot-account only', async () => {
  const { emit, sent } = fixture();
  await emit('#보룸감지시작', 2);
  assert.match(sent.at(-1).body, /방장·부방장 또는 봇 계정만/);
});

test('status commands still never report unverified observer hits as live VoiceRoom', async () => {
  const { emit, sent } = fixture();
  const observer = require('../shared/voice-room-observer');
  const roomId = '18495931541358610';
  try {
    observer.start(roomId);
    observer.observeMessage({ room: { id: roomId, isOpenChat: true }, message: { type: 52 } });
    await emit('#보룸상태');
    assert.match(sent.at(-1).body, /직접 VOX 인증 미연결/);
    assert.doesNotMatch(sent.at(-1).body, /서버에서 개설 상태 확인/);
  } finally { observer.stop(roomId); }
});


test('type-52 open and close presentation hints stay tentative in command replies', async () => {
  const { emit, sent } = fixture();
  const observer = require('../shared/voice-room-observer');
  const roomId = '18495931541358610';
  try {
    observer.start(roomId);
    for (const text of ['보이스룸', '0:16']) {
      observer.observeMessage({
        room: { id: roomId, isOpenChat: true },
        message: { type: 52, text },
        raw: { chatLog: { attachment: '{"event":"secret-room-token","state":1,"uid":"private"}' } },
      });
    }
    await emit('#보룸감지');
    const reply = sent.at(-1).body;
    assert.match(reply, /관련 이벤트 후보: 2건/);
    assert.match(reply, /개설 표시 후보/);
    assert.match(reply, /종료 표시 후보/);
    assert.match(reply, /첨부필드 event:string,state:number/);
    assert.match(reply, /실제 개설\/활성 여부 미확정/);
    assert.doesNotMatch(reply, /secret-room-token|private/);
  } finally { observer.stop(roomId); }
});


test('room probe outputs recognized lifecycle events but not voice server credentials', async () => {
  const { emit, sent } = fixture();
  const observer = require('../shared/voice-room-observer');
  const roomId = '18495931541358610';
  try {
    observer.start(roomId);
    for (const [eventType, duration] of [['vr_invite', 0], ['vr_bye', 17]]) {
      observer.observeMessage({
        room: { id: roomId, isOpenChat: true },
        message: { type: 52, text: 'private-chat-content' },
        raw: { chatLog: { attachment: JSON.stringify({
          type: eventType, duration, csIP: '192.0.2.5', csPort: 9000,
          csIP6: '2001:db8::1', callId: 'private-call',
        }) } }
      });
    }
    await emit('#보룸감지');
    const reply = sent.at(-1).body;
    assert.match(reply, /개설 이벤트 후보\(type=vr_invite\)/);
    assert.match(reply, /종료 이벤트 후보\(type=vr_bye\)/);
    assert.match(reply, /지속시간 17초/);
    assert.match(reply, /실제 개설\/활성 여부 미확정/);
    assert.doesNotMatch(reply, /192\.0\.2|2001:db8|private-call|private-chat-content/);
    await emit('#보룸상태');
    assert.match(sent.at(-1).body, /직접 VOX 인증 미연결/);
  } finally {
    observer.stop(roomId);
  }
});


test('management-enabled automatic detection appears in #보룸상태 and #보룸감지', async () => {
  const auto=require('../shared/voice-room-auto-detect');
  const roomId='18495931541358610';
  const observer=require('../shared/voice-room-observer');
  observer.stop(roomId); // command should work without a manual 3-minute watch
  const send=[];
  const event={ room:{ id:roomId, isOpenChat:true },
    message:{ type:52, logId:'9988776655441', text:'should not be copied' },
    raw:{ chatLog:{ attachment: JSON.stringify({
      type:'vr_invite', duration:0, csIP:'192.0.2.10', callId:'sensitive'
    }) } } };
  assert.equal(await auto.handleMessage(event,{
    isManaged:async()=>true,
    isBotEnabled:async()=>true,
    send:async(id,text)=>send.push({id,text})
  }),true);
  const {emit,sent}=fixture();
  await emit('#보룸상태');
  assert.match(sent.at(-1).body,/마지막 자동 감지: 개설 이벤트 수신/);
  assert.match(sent.at(-1).body,/직접 VOX 인증 미연결/);
  await emit('#보룸감지');
  assert.match(sent.at(-1).body,/마지막 자동 감지 기록/);
  assert.match(sent.at(-1).body,/개설 이벤트 수신/);
  assert.doesNotMatch(JSON.stringify(sent),/192\.0\.2|sensitive|should not be copied/);
  assert.equal(send.length,1);
});

test('automatic room detection does not claim active voice server from a received event', async () => {
  const {emit,sent}=fixture();
  await emit('#보룸상태');
  assert.match(sent.at(-1).body,/실시간 서버 검증 아님/);
  assert.match(sent.at(-1).body,/직접 VOX 인증 미연결/);
});


test('voice join, join status and leave route with room voice enabled, without global initialization', async () => {
  const {emit,sent}=fixture();
  for(const cmd of ['#보룸참가','#보룸참가상태','#보룸퇴장']){
    await emit(cmd);
    assert.equal(sent.length,cmd==='#보룸참가'?1:cmd==='#보룸참가상태'?2:3);
    assert.match(sent.at(-1).body,/VOX|브리지|보이스룸/);
  }
});

test('ordinary chat participants cannot execute join or leave', async () => {
  const {emit,sent}=fixture();
  await emit('#보룸참가',2);
  await emit('#보룸퇴장',2);
  assert.equal(sent.length,2);
  assert.ok(sent.every(x=>/방장·부방장 또는 봇 계정만/.test(x.body)));
});

test('bot account with nonmanager message role can reach the voice join handler', async () => {
  const {emit,sent,client}=fixture();
  await emit('#보룸참가',2,client.userId);
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/보이스룸 참가 실행 불가/);
  assert.doesNotMatch(sent[0].body,/방장·부방장 또는 봇 계정만/);
});

test('!보룸참여 and !보룸참여상태 are routed before unrelated initialization',async()=>{
  const {emit,sent}=fixture();
  await emit('!보룸참여');
  assert.match(sent.at(-1).body,/11002\(LOGIN\)/);
  await emit('!보룸참여상태');
  assert.match(sent.at(-1).body,/보룸 참가 상태/);
});


test('screenshotted VOX stop experiment commands are routed before global game ready',async()=>{
  for(const [cmd,expected] of [
    ['#보룸종료시험 11009','종료 실험이 비활성화되어 있습니다'],
    ['#보룸종료시험 연결해제','종료 실험이 비활성화되어 있습니다'],
    ['#보이스룸종료시험 11009','종료 실험이 비활성화되어 있습니다'],
  ]){
    const {emit,client,sent}=fixture();
    client.voiceRoomAdapter={
      async status({roomId}){
        return {roomId,localSession:true,localActive:true,
          unsafeStopExperimentAvailable:false};
      },
      async experimentalStop(){throw Error('disabled experiment cannot be invoked')},
    };
    await emit(cmd);
    assert.equal(sent.length,1,cmd);
    assert.match(sent[0].body,/종료 실험이 비활성화되어 있습니다/);
  }
});

test('VOX stop experiment reaches exactly the intended transport and never reports closure on send',async()=>{
  for(const [cmd,mode,response,expected] of [
    ['#보룸종료시험 11009','11009',{packetSent:true},/11009 패킷을 1회 송신/],
    ['#보룸종료시험 연결해제','disconnect',{localReleased:true},/VOX 연결만 강제로 해제/],
  ]){
    const {emit,client,sent}=fixture();
    const calls=[];
    client.voiceRoomAdapter={
      async status({roomId}){
        return {roomId,localSession:true,localActive:true,
          unsafeStopExperimentAvailable:true};
      },
      async experimentalStop(req){
        calls.push(req);
        return response;
      },
    };
    await emit(cmd);
    assert.deepEqual(calls,[{roomId:'18495931541358610',mode}]);
    assert.equal(sent.length,1);
    assert.match(sent[0].body,expected);
    assert.doesNotMatch(sent[0].body,/보이스룸 종료가 서버에서 확인되었습니다/);
  }
});

test('VOX stop experiment is subject to room voice enabled permission gate',async()=>{
  const permission=require('../shared/voice-room-permission');
  for(const text of ['#보룸종료시험 11009','#보룸종료시험 연결해제',
    '#보이스룸종료시험 11009']){
    assert.equal(permission.isActionCommand(text),true);
  }
  assert.equal(permission.isActionCommand('#보룸종료시험방'),false);
});


test('bot account starts VOX even when !봇끄기 and room voice are both OFF',async()=>{
  const voice=require('../shared/voice-room');
  const {emit,client,sent}=fixture();
  let called=0,request;
  client.voiceRoomAdapter={
    async status({roomId}){return {roomId,localSession:true,localActive:false};},
    async create(args){called++;request=args;return {created:true,verified:true};},
  };
  testRoomBotEnabled='false';
  testRoomVoiceEnabled='false';
  try{
    await emit('#보룸시작 봇전용',2,client.userId);
    assert.equal(called,1,'bot-own message must reach voice create');
    assert.equal(request.roomId,'18495931541358610');
    assert.equal(request.title,'봇전용');
    assert.match(sent.at(-1).body,/보룸을 시작했습니다/);
    assert.doesNotMatch(sent.at(-1).body,/OFF/);
  }finally{
    testRoomBotEnabled='true';testRoomVoiceEnabled='true';
  }
});
test('bot account create aliases bypass voice OFF, non-create voice actions do not',async()=>{
  const voice=require('../shared/voice-room');
  const permission=require('../shared/voice-room-permission');
  for(const input of ['#보룸시작 테스트','!보룸켜기 테스트','보이스룸시작 테스트','#보이스룸켜기 테스트']){
    assert.equal(permission.isCreateCommand(input),true,input);
  }
  for(const input of ['#보룸종료','#보룸종료시험 11009','#보룸상태','#보룸시작금지']){
    assert.equal(permission.isCreateCommand(input),false,input);
  }
  const {emit,client,sent}=fixture();
  let calls=0;
  client.voiceRoomAdapter={async status({roomId}){return {roomId,localSession:true,localActive:false};},
    async create(){calls++;return {created:true,verified:true};}};
  testRoomVoiceEnabled='false';
  try{
    await emit('#보룸켜기 테스트',2,client.userId);
    assert.equal(calls,1);
    assert.match(sent.at(-1).body,/보룸을 시작했습니다/);
    await emit('#보룸종료',2,client.userId);
    assert.match(sent.at(-1).body,/보이스룸 기능이 OFF/);
  }finally{testRoomVoiceEnabled='true';}
});
test('bot OFF continues to block other users and voice OFF still blocks ordinary manager create',async()=>{
  const {emit,client,sent}=fixture();
  let called=0;
  client.voiceRoomAdapter={async create(){called++;return {created:true,verified:true};}};
  testRoomBotEnabled='false';
  testRoomVoiceEnabled='false';
  try{
    await emit('#보룸시작 일반',1,'999991');
    assert.equal(called,0);
    assert.equal(sent.length,0);
    testRoomBotEnabled='true';
    await emit('#보룸시작 일반',1,'999991');
    assert.equal(called,0);
    assert.equal(sent.length,1);
    assert.match(sent[0].body,/보이스룸 기능이 OFF/);
  }finally{
    testRoomBotEnabled='true';testRoomVoiceEnabled='true';
  }
});


test('bot #보룸시작 works without web-issued room subscription or hz_rooms record',async()=>{
  const {emit,client,sent}=fixture();
  let calls=0,request;
  client.voiceRoomAdapter={
    async status({roomId}){return {roomId,localSession:true,localActive:false};},
    async create(options){calls++;request=options;return {created:true,verified:true};},
  };
  testRoomSubscriptionAccess={allowed:false,subscription:null};
  testRoomRecordExists=false;
  testRoomBotEnabled='false';
  testRoomVoiceEnabled='false';
  try {
    await emit('#보룸시작 웹없이',2,client.userId);
    assert.equal(calls,1);
    assert.equal(request.roomId,'18495931541358610');
    assert.equal(request.title,'웹없이');
    assert.equal(sent.length,1);
    assert.match(sent[0].body,/보룸을 시작했습니다/);
  } finally {
    testRoomSubscriptionAccess={allowed:true,subscription:null};
    testRoomRecordExists=true;
    testRoomBotEnabled='true';
    testRoomVoiceEnabled='true';
  }
});

test('bot account aliases also work in unregistered room without manager portal',async()=>{
  for(const cmd of ['#보룸켜기 관리자웹없음','!보이스룸시작 관리자웹없음']){
    const {emit,client,sent}=fixture();
    let created=0;
    client.voiceRoomAdapter={
      async status({roomId}){return {roomId,localSession:true,localActive:false};},
      async create(){created++;return {created:true,verified:true};},
    };
    testRoomSubscriptionAccess={allowed:false,subscription:null};
    testRoomRecordExists=false;
    testRoomVoiceEnabled='false';
    try {
      await emit(cmd,2,client.userId);
      assert.equal(created,1,cmd);
      assert.match(sent[0].body,/보룸을 시작했습니다/);
    }finally{
      testRoomSubscriptionAccess={allowed:true,subscription:null};
      testRoomRecordExists=true;
      testRoomVoiceEnabled='true';
    }
  }
});

test('unlicensed room still blocks manager and ordinary account VOX create',async()=>{
  const {emit,client,sent}=fixture();
  let created=0;
  client.voiceRoomAdapter={async create(){created++;return {created:true,verified:true};}};
  testRoomSubscriptionAccess={allowed:false,subscription:null};
  testRoomRecordExists=false;
  try {
    await emit('#보룸시작 일반방장',1,'9007199254740993444');
    await emit('#보룸시작 일반',2,'9007199254740993555');
    assert.equal(created,0);
    assert.equal(sent.length,0);
  }finally{
    testRoomSubscriptionAccess={allowed:true,subscription:null};
    testRoomRecordExists=true;
  }
});

test('expired paid subscription is never bypassed, including the bot account',async()=>{
  const {emit,client,sent}=fixture();
  let created=0;
  client.voiceRoomAdapter={async create(){created++;return {created:true,verified:true};}};
  testRoomSubscriptionAccess={allowed:false,subscription:{
    roomId:'18495931541358610',active:false,status:'expired',plan:'all'
  }};
  try{
    await emit('#보룸시작 기간만료',1,client.userId);
    assert.equal(created,0);
    assert.equal(sent.length,0);
  }finally{testRoomSubscriptionAccess={allowed:true,subscription:null};}
});

test('unregistered bot cannot bypass subscription for other VOX commands',async()=>{
  const {emit,client,sent}=fixture();
  let stopped=0;
  client.voiceRoomAdapter={async stop(){stopped++;return {closed:true,verified:true}}};
  testRoomSubscriptionAccess={allowed:false,subscription:null};
  try{
    await emit('#보룸종료',1,client.userId);
    await emit('#보룸종료시험 연결해제',1,client.userId);
    assert.equal(stopped,0);
    assert.equal(sent.length,0);
  }finally{testRoomSubscriptionAccess={allowed:true,subscription:null};}
});


test('bot-only speaker acceptance reaches the VOX handler without room portal or voice ON',async()=>{
  const {emit,client,sent}=fixture();
  let calls=0;
  client.voiceRoomAdapter={
    async status({roomId}){return {roomId,localActive:true,invitedRoles:['speaker']};},
    async acceptRole(req){
      calls++;assert.deepEqual(req,{roomId:'18495931541358610',role:'speaker'});
      return {handled:false,reason:'protocol-unverified'};
    },
  };
  testRoomSubscriptionAccess={allowed:false,subscription:null};
  testRoomVoiceEnabled='false';
  testRoomRecordExists=false;
  try{
    await emit('#보룸스피커받기',2,client.userId);
    assert.equal(calls,1);
    assert.match(sent[0].body,/스피커 초대 이벤트는 확인했지만/);
  }finally{
    testRoomSubscriptionAccess={allowed:true,subscription:null};
    testRoomVoiceEnabled='true';
    testRoomRecordExists=true;
  }
});
test('unregistered room manager cannot bypass account identity to accept VOX role',async()=>{
  const {emit,client,sent}=fixture();
  let calls=0;
  client.voiceRoomAdapter={
    async status(){return {localActive:true,invitedRoles:['moderator']}},
    async acceptRole(){calls++;return {handled:true}},
  };
  testRoomSubscriptionAccess={allowed:false,subscription:null};
  try{
    await emit('#보룸진행자받기',1,'9007199254740993222');
    assert.equal(calls,0);
    assert.equal(sent.length,0);
  }finally{testRoomSubscriptionAccess={allowed:true,subscription:null};}
});
