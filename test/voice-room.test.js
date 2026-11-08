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
  assert.match(sent[0],/방장·부방장 또는 봇 계정만/);
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

test('room scope and own-account commands are handled',async()=>{
  const {args,sent}=fixture();
  args.msg.room.isOpenChat=false;
  await voice.handle(args);
  assert.match(sent[0],/오픈채팅방/);
  const own=fixture({text:'#보룸상태'});
  own.args.msg.sender.id=own.client.userId;
  const handled=await voice.handle(own.args);
  assert.equal(handled,true);
  assert.equal(own.sent.length,1);
  assert.match(own.sent[0],/보이스룸 상태/);
});

test('unsupported other commands return false',async()=>{
  const {args}=fixture({text:'#보룸예약'});
  assert.equal(await voice.handle(args),false);
});

test('verified inactive status is distinct from an unknown status',async()=>{
  const {args,sent}=fixture({text:'#보룸상태'});
  args.adapter={status:async()=>({active:false,verified:true,roomId:ROOM,status:0})};
  await voice.handle(args);
  assert.match(sent[0],/서버에서 비활성 상태 확인/);
});

test('stop is handled but does not fake an unsupported API',async()=>{
  const {args,sent}=fixture({text:'#보룸끄기'});
  await voice.handle(args);
  assert.match(sent[0],/종료 API/);
  assert.doesNotMatch(sent[0],/종료가 서버에서 확인/);
});

test('stop requires a verified active voice room in same chat',async()=>{
  const {args,sent}=fixture({text:'#보룸끄기'});
  let stops=0;
  args.adapter={
    status:async()=>({active:true,verified:true,roomId:'999',voiceRoomId:'15'}),
    stop:async()=>{stops++;return {closed:true,verified:true,roomId:ROOM};}
  };
  await voice.handle(args);
  assert.equal(stops,0);
  assert.match(sent[0],/활성 보이스룸을 확인하지 못해/);
});

test('stop calls adapter and requires explicit close confirmation',async()=>{
  const {args,sent}=fixture({text:'#보이스룸끄기'});
  const calls=[];
  args.adapter={
    status:async()=>({active:true,verified:true,roomId:ROOM,voiceRoomId:'154'}),
    stop:async payload=>{calls.push(payload);return {closed:true,verified:true,roomId:ROOM,status:0};}
  };
  await voice.handle(args);
  assert.deepEqual(calls,[{roomId:ROOM,voiceRoomId:'154'}]);
  assert.match(sent[0],/종료가 서버에서 확인/);
});

test('unverified stop result does not claim success',async()=>{
  const {args,sent}=fixture({text:'#보룸끄기'});
  let statusCount=0;
  args.adapter={
    status:async()=>++statusCount===1?
      {active:true,verified:true,roomId:ROOM}:{active:false,verified:false,roomId:ROOM},
    stop:async()=>({status:0})
  };
  await voice.handle(args);
  assert.equal(statusCount,2);
  assert.match(sent[0],/종료 결과를 검증하지 못했습니다/);
});

test('stop can verify inactive server state after ambiguous close response',async()=>{
  const {args,sent}=fixture({text:'#보룸끄기'});
  let statusCount=0;
  args.adapter={
    status:async()=>++statusCount===1?
      {active:true,verified:true,roomId:ROOM,voiceRoomId:'11'}:
      {active:false,verified:true,roomId:ROOM},
    stop:async()=>({status:0})
  };
  await voice.handle(args);
  assert.match(sent[0],/종료가 서버에서 확인/);
});

test('voice room help lists supported commands',async()=>{
  const {args,sent}=fixture({text:'#보룸명령어'});
  await voice.handle(args);
  assert.match(sent[0],/#보룸켜기/);
  assert.match(sent[0],/#보룸끄기/);
});

test('bot account can request status even when sender type is ordinary member',async()=>{
  const {args,client,sent}=fixture({text:'#보룸상태'});
  args.msg.sender.id=client.userId;
  args.msg.sender.type=2;
  const result=await voice.handle(args);
  assert.equal(result,true);
  assert.match(sent[0],/보이스룸 상태/);
  assert.doesNotMatch(sent[0],/봇 계정만 이 명령어를 사용할 수 있습니다/);
});

test('bot account can use help without a manager sender type',async()=>{
  const {args,client,sent}=fixture({text:'#보룸명령어'});
  args.msg.sender.id=client.userId;
  args.msg.sender.type=undefined;
  await voice.handle(args);
  assert.match(sent[0],/NEXI \| 보이스룸 명령어/);
  assert.match(sent[0],/봇 계정이 사용 가능/);
});

test('bot account can invoke verified create adapter despite sender type 2',async()=>{
  const {args,client,sent}=fixture({text:'#보룸켜기 봇 명령 테스트'});
  args.msg.sender.id=client.userId;
  args.msg.sender.type=2;
  let calls=0;
  args.adapter={create:async payload=>{
    calls++;
    assert.equal(payload.roomId,ROOM);
    assert.equal(payload.title,'봇 명령 테스트');
    return {created:true,verified:true,status:0,voiceRoomId:'42'};
  }};
  await voice.handle(args);
  assert.equal(calls,1);
  assert.match(sent[0],/생성 확인/);
});

test('bot account can invoke verified stop adapter despite sender type 2',async()=>{
  const {args,client,sent}=fixture({text:'#보룸끄기'});
  args.msg.sender.id=client.userId;
  args.msg.sender.type=2;
  let calls=0;
  args.adapter={
    status:async()=>({active:true,verified:true,roomId:ROOM,voiceRoomId:'42'}),
    stop:async()=>{calls++;return {closed:true,verified:true,roomId:ROOM,status:0};}
  };
  await voice.handle(args);
  assert.equal(calls,1);
  assert.match(sent[0],/종료가 서버에서 확인/);
});

test('non-bot sender cannot bypass manager role by using another non-manager ID',async()=>{
  const {args,sent}=fixture({text:'#보룸상태'});
  args.msg.sender.id='9007199254740993124';
  args.msg.sender.type=2;
  await voice.handle(args);
  assert.match(sent[0],/방장·부방장 또는 봇 계정만/);
});

test('bot account command access never bypasses verified room owner/manager role for actual create',async()=>{
  const {args,client,sent}=fixture({text:'#보룸켜기 테스트'});
  args.msg.sender.id=client.userId;
  args.msg.sender.type=2;
  client._getCachedMemberType=()=>2;
  let calls=0;
  args.adapter={create:async()=>{calls++;return {created:true,verified:true};}};
  await voice.handle(args);
  assert.equal(calls,0);
  assert.match(sent[0],/봇 계정에도 방장 또는 부방장/);
});
