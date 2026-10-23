'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
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
  const emit=(text,senderType=1)=>callback({
    room:{id:'18495931541358610',isOpenChat:true},
    sender:{id:'9007199254740993444',type:senderType},
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
  assert.match(sent[0].body,/방장 또는 부방장만/);
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
