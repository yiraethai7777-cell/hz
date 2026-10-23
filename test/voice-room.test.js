'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const voice=require('../shared/voice-room');

const ROOM='18495931541358610';
function fixture(overrides={}) {
  const sent=[],calls=[];
  const client={
    connected:true,userId:'9007199254740993123',
    _activeChatId:ROOM,type:4,
    _getCachedMemberType(room,id){return room===ROOM && String(id)==='9007199254740993123'?4:null;}
  };
  const args={
    client,roomId:ROOM,
    msg:{room:{id:ROOM,isOpenChat:true,openLinkId:'9007199254740993333'},sender:{id:'11',type:1}},
    text:'#보룸켜기 테스트 방',
    send:async text=>sent.push(text),
    ...overrides
  };
  return {args,client,sent,calls};
}

test('unsupported voice room command never fabricates a LOCO request',async()=>{
  const {args,sent}=fixture();
  const result=await voice.handle(args);
  assert.equal(result,true);
  assert.match(sent[0],/생성 API가 아직 연결되지 않았습니다/);
  assert.match(sent[0],/CREATE_VOICEROOM/);
  assert.doesNotMatch(sent[0],/생성 확인/);
});

test('room role on requester must be owner or manager',async()=>{
  const {args,sent}=fixture();
  args.msg.sender.type=2;
  args.adapter={create:async()=>{throw Error('must not call');}};
  await voice.handle(args);
  assert.match(sent[0],/방장 또는 부방장만/);
});

test('bot must also be owner or manager in the same room',async()=>{
  const {args,sent,client}=fixture();
  client._getCachedMemberType=()=>2;
  args.adapter={create:async()=>{throw Error('must not call');}};
  await voice.handle(args);
  assert.match(sent[0],/봇 계정에도 방장 또는 부방장/);
});

test('uncertain bot role refuses create without scanning chat members',async()=>{
  const {args,sent,client}=fixture();
  client._getCachedMemberType=()=>null;
  client.type=0;
  let calls=0;
  args.adapter={create:async()=>{calls++;return {created:true,verified:true};}};
  await voice.handle(args);
  assert.equal(calls,0);
  assert.match(sent[0],/권한을 확인할 수 없습니다/);
});

test('verified adapter may create named voice room',async()=>{
  const {args,sent}=fixture();
  const calls=[];
  args.adapter={create:async data=>{
    calls.push(data);
    return {created:true,verified:true,status:0,voiceRoomId:'901'};
  }};
  await voice.handle(args);
  assert.deepEqual(calls,[{roomId:ROOM,title:'테스트 방',openLinkId:'9007199254740993333'}]);
  assert.match(sent[0],/보이스룸 생성 확인/);
  assert.match(sent[0],/901/);
});

test('server status needs explicit verification, not status=0 alone',async()=>{
  const {args,sent}=fixture();
  args.adapter={create:async()=>({status:0})};
  await voice.handle(args);
  assert.match(sent[0],/검증하지 못했습니다/);
});

test('verify live status when start reply does not confirm',async()=>{
  const {args,sent}=fixture();
  args.adapter={
    create:async()=>({status:0}),
    status:async()=>({active:true,verified:true,roomId:ROOM,voiceRoomId:'302'})
  };
  await voice.handle(args);
  assert.match(sent[0],/생성 확인/);
  assert.match(sent[0],/302/);
});

test('status query can report unconfigured transport',async()=>{
  const {args,sent}=fixture({text:'#보룸상태'});
  await voice.handle(args);
  assert.match(sent[0],/보이스룸 상태/);
  assert.match(sent[0],/미연동/);
});

test('status reply recognizes active verified server state',async()=>{
  const {args,sent}=fixture({text:'#보이스룸상태'});
  args.adapter={create:async()=>({}),status:async()=>({active:true,verified:true,roomId:ROOM,voiceRoomId:'304'})};
  await voice.handle(args);
  assert.match(sent[0],/서버에서 개설 상태 확인/);
  assert.match(sent[0],/304/);
});

test('duplicate requests cannot run simultaneously',async()=>{
  const {args,sent}=fixture();
  let release;
  let calls=0;
  args.adapter={create:async()=>{
    calls++;
    await new Promise(resolve=>{release=resolve;});
    return {created:true,verified:true};
  }};
  const first=voice.handle(args);
  await Promise.resolve();
  const second=await voice.handle(args);
  assert.equal(second,true);
  assert.equal(calls,1);
  assert.ok(sent.some(t=>t.includes('이미 이 방의 보이스룸 개설 요청')));
  release();
  await first;
  assert.ok(sent.some(t=>t.includes('생성 확인')));
});

test('malformed title cannot be sent to adapter',async()=>{
  const {args,sent}=fixture();
  args.text='#보룸켜기 '+'가'.repeat(41);
  let calls=0;
  args.adapter={create:async()=>{calls++;return {created:true,verified:true};}};
  await voice.handle(args);
  assert.equal(calls,0);
  assert.match(sent[0],/40자 이하/);
});

test('room scope and bot self command are respected',async()=>{
  const {args,sent}=fixture();
  args.msg.room.isOpenChat=false;
  await voice.handle(args);
  assert.match(sent[0],/오픈채팅방/);
  const own=fixture();
  own.args.msg.sender.id=own.client.userId;
  const handled=await voice.handle(own.args);
  assert.equal(handled,true);
  assert.equal(own.sent.length,0);
});

test('unsupported other commands return false',async()=>{
  const {args}=fixture({text:'#보룸끄기'});
  assert.equal(await voice.handle(args),false);
});
