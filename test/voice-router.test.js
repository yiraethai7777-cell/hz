'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
// Voice routing is tested without a real PostgreSQL instance. This only
// mocks DB reads/command-block schema setup; integration tests use real DB.
const dbModule=require('../shared/db');
dbModule.getPool=()=>({query:async()=>({rows:[],rowCount:0})});
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
  assert.match(sent[0].body,/미연동/);
});

test('legacy !보룸켜기 example is recognized before ready',async()=>{
  const {emit,sent}=fixture();
  await emit('!보룸켜기');
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/생성 API가 아직 연결되지 않았습니다/);
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
  assert.match(sent[0].body,/생성 API가 아직 연결되지 않았습니다/);
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
  assert.match(sent[0].body,/NEXI \| 보이스룸 명령어/);
});

test('screenshotted #보룸시작 receives an unsupported API response',async()=>{
  const {emit,sent}=fixture();
  await emit('#보룸시작 .');
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/보이스룸 생성 API가 아직 연결되지 않았습니다/);
});

test('bot account with ordinary sender role can issue #보룸시작',async()=>{
  const {emit,sent,client}=fixture();
  await emit('#보룸시작',2,client.userId);
  assert.equal(sent.length,1);
  assert.match(sent[0].body,/보이스룸 생성 API가 아직 연결되지 않았습니다/);
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
    assert.match(sent.at(-1).body, /미연동/);
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
    assert.match(sent.at(-1).body, /미연동/);
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
  assert.match(sent.at(-1).body,/미연동/);
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
  assert.match(sent.at(-1).body,/미연동/);
});
