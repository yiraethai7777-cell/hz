'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {findVerifiedHangupMethod}=require('../shared/vox30-hangup-discovery');
const voice=require('../shared/voice-room');

const reviewed=method=>({method,reviewed:true,recordedClientHangUp:true,
  bsonSchemaVerified:true,sameCallServerByeVerified:true});

test('offline scan returns no method without reviewed termination evidence',()=>{
  assert.equal(findVerifiedHangupMethod(),null);
  assert.equal(findVerifiedHangupMethod([11009,10004]),null);
  assert.equal(findVerifiedHangupMethod([{...reviewed(11009)}]),null);
  assert.equal(findVerifiedHangupMethod([{...reviewed(10004),bsonSchemaVerified:false}]),null);
});
test('offline scan checks ascending method numbers and ignores invalid entries',()=>{
  assert.equal(findVerifiedHangupMethod([reviewed(12000),reviewed(12)]),12);
  assert.equal(findVerifiedHangupMethod([reviewed(65536),reviewed(65535)]),65535);
});
function fixture(text,evidence,senderId='10'){
  const messages=[];
  const client={userId:'10',connected:true,voiceRoomVerifiedHangupEvidence:evidence};
  return {messages,args:{
    text,client,roomId:'123',
    msg:{room:{isOpenChat:true},sender:{id:senderId,type:1}},
    send:async msg=>messages.push(msg)
  }};
}
test('bot-only command does not send packets and reports no unverified method',async()=>{
  const {args,messages}=fixture('#보룸종료찾기',[]);
  assert.equal(await voice.handle(args),true);
  assert.match(messages[0],/검증된 종료 매서드를 찾지 못했습니다/);
});
test('reviewed method without live stop transport is not reported as found',async()=>{
  const {args,messages}=fixture('#보룸종료찾기',[reviewed(12345)]);
  assert.equal(await voice.handle(args),true);
  assert.deepEqual(messages,['종료 요청용 VOX 드라이버가 연결되지 않았습니다.']);
});
test('unverified sender is denied even if evidence was injected',async()=>{
  const {args,messages}=fixture('#보룸종료찾기',[reviewed(12345)],'11');
  await voice.handle(args);
  assert.match(messages[0],/봇 계정만/);
});

test('live test requires the current room active and a verified call id',async()=>{
  const {args,messages}=fixture('#보룸종료찾기',[reviewed(12345)]);
  let stopped=false;
  args.adapter={
    async status(){return {roomId:'123',localSession:true,localActive:false,stopAvailable:true}},
    async stop(){stopped=true;throw Error('must not execute')},
  };
  await voice.handle(args);
  assert.equal(stopped,false);
  assert.deepEqual(messages,['이 방의 활성 VOX 통화 ID가 없습니다.']);
});
test('live test refuses a driver with unverified stop capability',async()=>{
  const {args,messages}=fixture('#보룸종료찾기',[reviewed(12345)]);
  let stopped=false;
  args.adapter={
    async status(){return {roomId:'123',localSession:true,localActive:true,
      localCallId:'987',stopAvailable:false}},
    async stop(){stopped=true;throw Error('must not execute')},
  };
  await voice.handle(args);
  assert.equal(stopped,false);
  assert.deepEqual(messages,['검증된 서버 종료 드라이버가 연결되지 않았습니다.']);
});
