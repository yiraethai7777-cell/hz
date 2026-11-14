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
test('reviewed evidence displays exactly the requested short method format',async()=>{
  const {args,messages}=fixture('#보룸종료찾기',[reviewed(12345)]);
  assert.equal(await voice.handle(args),true);
  assert.deepEqual(messages,['매서드: 12345']);
});
test('unverified sender is denied even if evidence was injected',async()=>{
  const {args,messages}=fixture('#보룸종료찾기',[reviewed(12345)],'11');
  await voice.handle(args);
  assert.match(messages[0],/봇 계정만/);
});
