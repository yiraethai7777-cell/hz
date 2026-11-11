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
  assert.match(sent[0],/직접 VOX 보이스룸 생성 기능은 인증 연동 전입니다/);
  assert.match(sent[0],/기존 Android\/Noa 생성 방식은 제거했습니다/);
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
  const {args,sent,client}=fixture();
  const calls=[];
  args.adapter={create:async data=>{
    calls.push(data);
    return {created:true,verified:true,status:0,voiceRoomId:'901'};
  }};
  await voice.handle(args);
  assert.deepEqual(calls,[{roomId:ROOM,title:'테스트 방',botUserId:client.userId,openLinkId:'9007199254740993333'}]);
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
  assert.match(sent[0],/직접 VOX 인증 미연결/);
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
  assert.match(sent[0],/카카오톡 관리 매니저 \| 보이스룸 명령어/);
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

test('bot account may request creation even without cached manager role',async()=>{
  const {args,client,sent}=fixture({text:'#보룸시작 테스트'});
  args.msg.sender.id=client.userId;
  args.msg.sender.type=2;
  client._getCachedMemberType=()=>2;
  let calls=0;
  args.adapter={create:async payload=>{
    calls++;
    assert.equal(payload.title,'테스트');
    return {created:true,verified:true,status:0};
  }};
  await voice.handle(args);
  assert.equal(calls,1);
  assert.match(sent[0],/생성 확인/);
});

test('bot account may request stop even without cached manager role',async()=>{
  const {args,client,sent}=fixture({text:'#보룸종료'});
  args.msg.sender.id=client.userId;
  args.msg.sender.type=2;
  client._getCachedMemberType=()=>2;
  let calls=0;
  args.adapter={
    status:async()=>({active:true,verified:true,roomId:ROOM,voiceRoomId:'777'}),
    stop:async()=>{calls++;return {closed:true,verified:true,roomId:ROOM};}
  };
  await voice.handle(args);
  assert.equal(calls,1);
  assert.match(sent[0],/종료가 서버에서 확인/);
});

test('screenshotted #보룸시작. is recognized and has default voice room title',async()=>{
  const {args,sent}=fixture({text:'#보룸시작.'});
  let name;
  args.adapter={create:async ({title})=>{name=title;return {created:true,verified:true};}};
  await voice.handle(args);
  assert.equal(name,'보이스룸');
  assert.match(sent[0],/생성 확인/);
});

test('aliases for start, stop and voice-room commands are all recognized',async()=>{
  for(const command of ['#보룸시작','!보룸시작','보룸시작','#보이스룸시작']){
    const {args,sent}=fixture({text:command});
    assert.equal(await voice.handle(args),true);
    assert.match(sent[0],/직접 VOX 보이스룸 생성 기능은 인증 연동 전입니다/);
  }
  for(const command of ['#보룸종료','!보룸종료','보룸종료','#보이스룸종료.']){
    const {args,sent}=fixture({text:command});
    assert.equal(await voice.handle(args),true);
    assert.match(sent[0],/종료 API/);
  }
});

test('bot account command can use a top-level senderId fallback',async()=>{
  const {args,client,sent}=fixture({text:'#보룸상태'});
  args.msg.sender.id=undefined;
  args.msg.sender.type=2;
  args.msg.senderId=client.userId;
  assert.equal(await voice.handle(args),true);
  assert.match(sent[0],/보이스룸 상태/);
});

test('manager role is still needed for non-bot users',async()=>{
  const {args,client,sent}=fixture({text:'#보룸시작'});
  client._getCachedMemberType=()=>2;
  args.msg.sender.type=2;
  let calls=0;
  args.adapter={create:async()=>{calls++;return {created:true,verified:true};}};
  await voice.handle(args);
  assert.equal(calls,0);
  assert.match(sent[0],/방장·부방장 또는 봇 계정만/);
});


test('experimental Noa accepted request is only an unverified dispatch, never creation success', async () => {
  const { args, sent } = fixture({ text: '#보룸시작 NEXI' });
  args.adapter = {
    create: async () => ({ requestAccepted: true, verified: false }),
    status: async () => { throw Error('must not be queried after acknowledged dispatch'); },
  };
  await voice.handle(args);
  assert.match(sent[0], /보이스룸 생성 요청이 Railway 직접 VOX 클라이언트에 전달/);
  assert.match(sent[0], /실제 카카오톡 서버 개설은 아직 확인되지 않았습니다/);
  assert.doesNotMatch(sent[0], /보이스룸 생성 확인!/);
});

test('experimental Noa current local session is not displayed as server verified', async () => {
  const { args, sent } = fixture({ text: '#보룸상태' });
  args.adapter = {
    create: async () => ({ requestAccepted: false, verified: false }),
    status: async () => ({ roomId: ROOM, localSession: true, localActive: true, verified: false }),
  };
  await voice.handle(args);
  assert.match(sent[0], /Railway 직접 VOX에서 이 방의 보룸 세션 표시/);
  assert.match(sent[0], /서버 상태 미검증/);
  assert.doesNotMatch(sent[0], /서버에서 개설 상태 확인/);
});

test('experimental Noa local session does not authorize room shutdown', async () => {
  const { args, sent } = fixture({ text: '#보룸종료' });
  args.adapter = {
    create: async () => ({ requestAccepted: true, verified: false }),
    status: async () => ({ roomId: ROOM, localSession: true, localActive: true, verified: false }),
  };
  await voice.handle(args);
  assert.match(sent[0], /실제 보이스룸 종료 API/);
});


test('voice join command is registered without a VOX transport and tells the missing dependency', async () => {
  const {args,sent}=fixture({text:'#보룸참가'});
  assert.equal(await voice.handle(args),true);
  assert.match(sent[0],/보이스룸 참가 실행 불가/);
  assert.match(sent[0],/Railway 직접 VOX 인증/);
});

test('voice join status command is registered without any enable switch', async () => {
  const {args,sent}=fixture({text:'#보룸참가상태'});
  await voice.handle(args);
  assert.match(sent[0],/VOX 접속정보/);
  assert.match(sent[0],/Railway 전용 VOX 인증·음성 세션 미구현/);
});

test('voice join calls the adapter for this bot account and never claims server membership', async () => {
  const {args,sent,client}=fixture({text:'#보룸참가'});
  const calls=[];
  args.adapter={
    status:async data=>{
      calls.push({method:'status',data});
      return {statusKnown:true,localActive:false,verified:false};
    },
    join:async data=>{
      calls.push({method:'join',data});
      return {requestAccepted:true,verified:false};
    },
  };
  await voice.handle(args);
  assert.deepEqual(calls,[
    {method:'status',data:{roomId:ROOM,botUserId:client.userId}},
    {method:'join',data:{roomId:ROOM,botUserId:client.userId}},
  ]);
  assert.match(sent[0],/보이스룸 참가 요청을 Railway 직접 VOX 클라이언트에 전달/);
  assert.match(sent[0],/실제 참가 여부/);
  assert.doesNotMatch(sent[0],/참가 확인!|서버에서 개설 상태 확인/);
});

test('join never replaces a voice session active in another room', async () => {
  const {args,sent}=fixture({text:'#보룸참가'});
  let calls=0;
  args.adapter={
    status:async()=>({statusKnown:true,localActive:false,localBusyOtherRoom:true}),
    join:async()=>{calls++;return {requestAccepted:true};},
  };
  await voice.handle(args);
  assert.equal(calls,0);
  assert.match(sent[0],/다른 방에서 보이스룸 세션/);
});

test('duplicate voice join to a room with an existing local session does not rejoin', async () => {
  const {args,sent}=fixture({text:'#보룸참가'});
  let calls=0;
  args.adapter={
    status:async()=>({statusKnown:true,localActive:true}),
    join:async()=>{calls++;return {requestAccepted:true};},
  };
  await voice.handle(args);
  assert.equal(calls,0);
  assert.match(sent[0],/이미 감지됩니다/);
  assert.doesNotMatch(sent[0],/진행자 권한 확인/);
});

test('voice leave only calls Android session leave with same-room status', async () => {
  const {args,sent,client}=fixture({text:'#보룸퇴장'});
  const calls=[];
  args.adapter={
    status:async data=>{calls.push({method:'status',data});
      return {statusKnown:true,localActive:true,verified:false};},
    leave:async data=>{calls.push({method:'leave',data});
      return {requestAccepted:true,verified:false};},
  };
  await voice.handle(args);
  assert.deepEqual(calls,[
    {method:'status',data:{roomId:ROOM,botUserId:client.userId}},
    {method:'leave',data:{roomId:ROOM,botUserId:client.userId}},
  ]);
  assert.match(sent[0],/퇴장 요청을 전달/);
  assert.match(sent[0],/보룸 전체 종료 명령은 아닙니다/);
  assert.doesNotMatch(sent[0],/서버에서 확인되었습니다/);
});

test('voice leave refuses without a same-room active session', async () => {
  const {args,sent}=fixture({text:'#보룸퇴장'});
  let calls=0;
  args.adapter={
    status:async()=>({statusKnown:true,localActive:false}),
    leave:async()=>{calls++;return {requestAccepted:true};},
  };
  await voice.handle(args);
  assert.equal(calls,0);
  assert.match(sent[0],/퇴장 요청을 보내지 않았습니다/);
});

test('ordinary member cannot issue voice join or leave even with adapter', async () => {
  for(const command of ['#보룸참가','#보룸퇴장','#보룸참가상태']){
    const {args,sent}=fixture({text:command});
    args.msg.sender.type=2;
    args.adapter={
      join:async()=>{throw Error('must not run');},
      leave:async()=>{throw Error('must not run');}
    };
    await voice.handle(args);
    assert.match(sent[0],/방장·부방장 또는 봇 계정만/);
  }
});

test('bot account can request voice join even with nonmanager sender role', async () => {
  const {args,sent,client}=fixture({text:'#보룸참가'});
  args.msg.sender.id=client.userId;
  args.msg.sender.type=2;
  args.adapter={
    status:async()=>({statusKnown:true,localActive:false}),
    join:async()=>({requestAccepted:true,verified:false}),
  };
  await voice.handle(args);
  assert.match(sent[0],/보이스룸 참가 요청을 Railway 직접 VOX 클라이언트에 전달/);
});

test('voice join or leave fail closed when Android session status cannot be checked',async()=>{
  for(const command of ['#보룸참가','#보룸퇴장']){
    const {args,sent}=fixture({text:command});
    let calls=0;
    args.adapter={
      status:async()=>({statusKnown:false}),
      join:async()=>{calls++;return {requestAccepted:true};},
      leave:async()=>{calls++;return {requestAccepted:true};},
    };
    await voice.handle(args);
    assert.equal(calls,0);
    assert.match(sent[0],/상태를 확인할 수 없어/);
  }
});

test('voice help shows join, join status and leave command names',async()=>{
  const {args,sent}=fixture({text:'#보룸명령어'});
  await voice.handle(args);
  assert.match(sent[0],/#보룸참가/);
  assert.match(sent[0],/#보룸참가상태/);
  assert.match(sent[0],/#보룸퇴장/);
});

test('legacy Noa adapter is explicitly rejected in direct-only voice mode',()=>{
  const legacy={kind:'noa-android-experimental',create:async()=>({requestAccepted:true})};
  assert.equal(voice.adapterOf({voiceRoomAdapter:legacy}),null);
});

test('direct VOX status displays existing Kakao auth without asserting VOX server login',async()=>{
  const {args,client,sent}=fixture({text:'#보룸상태'});
  client.voiceRoomAuthCandidate={diagnostics:()=>({
    hasKakaoCredentials:true,kakaoRoomCached:true,
    kakaoMemberTypeCached:true,voxServerAuthenticated:false,voxCreationReady:false,
  })};
  await voice.handle(args);
  assert.match(sent[0],/기존 카카오톡 인증 정보: 메모리에서 확인/);
  assert.match(sent[0],/대상 오픈채팅방 캐시: 확인/);
  assert.match(sent[0],/VOX 서버 인증: 미검증/);
  assert.doesNotMatch(sent[0],/VOX 서버 인증: 성공/);
});

test('direct VOX create with OAuth candidate still refuses to send an unverified request',async()=>{
  const {args,client,sent}=fixture({text:'#보룸시작 테스트'});
  client.voiceRoomAuthCandidate={diagnostics:()=>({
    hasKakaoCredentials:true,voxServerAuthenticated:false,voxCreationReady:false,
  })};
  await voice.handle(args);
  assert.match(sent[0],/기존 카카오톡 OAuth 후보는 감지됐지만 VOX 서버 승인은 아직 확인되지 않았습니다/);
  assert.doesNotMatch(sent[0],/보이스룸 생성 확인/);
});


test('bot account may probe Railway TLS only, without reporting VOX login success',async()=>{
  const {args,client,sent}=fixture({text:'#보룸TLS진단'});
  args.msg.sender.id=client.userId;
  let probes=0;
  client.voiceRoomTlsProbe=async()=>{
    probes++;
    return {
      entry:{status:'tls_verified',tlsVersion:'TLSv1.3',certificateVerified:true},
      observed:{status:'certificate_name_mismatch',certificateVerified:false},
    };
  };
  assert.equal(await voice.handle(args),true);
  assert.equal(probes,1);
  assert.match(sent[0],/후보 TCP 9282: TLSv1\.3/);
  assert.match(sent[0],/후보 TCP 995: 검증 실패/);
  assert.match(sent[0],/VOX 서버 인증: 미검증/);
  assert.match(sent[0],/인증 토큰·VOX 패킷은 보내지 않았습니다/);
  assert.doesNotMatch(sent[0],/보이스룸 생성 확인/);

  assert.equal(await voice.handle(args),true);
  assert.equal(probes,1);
  assert.match(sent[1],/10분에 한 번/);
});

test('non-bot manager cannot trigger Railway TLS network requests',async()=>{
  const {args,client,sent}=fixture({text:'#보룸TLS진단'});
  let probes=0;
  client.voiceRoomTlsProbe=async()=>{probes++;throw Error('must not probe');};
  await voice.handle(args);
  assert.equal(probes,0);
  assert.match(sent[0],/봇 계정만 실행/);
});

test('TLS diagnostic is visible in voice help',async()=>{
  const {args,sent}=fixture({text:'#보룸명령어'});
  await voice.handle(args);
  assert.match(sent[0],/#보룸TLS진단/);
});


test('bot-only VOX auth preflight reports readiness without claiming server authentication',async()=>{
  const {args,client,sent}=fixture({text:'#보룸인증점검'});
  args.msg.sender.id=client.userId;
  client.voiceRoomAuthPreflight=()=>({
    sessionConnected:true,kakaoCredentialsPresent:true,openChatCached:true,
    botMemberCached:true,botModeratorCached:true,
    appVersionPresent:true,carrierPresent:true,deviceProfileVerified:false,
    authenticatedVoxSession:false,creationEnabled:false,
  });
  assert.equal(await voice.handle(args),true);
  assert.match(sent[0],/기존 OAuth·기기 정보: 확인/);
  assert.match(sent[0],/검증된 VOX 기기 프로필: 미확인/);
  assert.match(sent[0],/VOX 서버 OAuth 인증: 미검증/);
  assert.match(sent[0],/실제 생성: 비활성화/);
  assert.doesNotMatch(sent[0],/생성 확인/);
});

test('unauthorized managers cannot inspect VOX auth readiness',async()=>{
  const {args,client,sent}=fixture({text:'#보룸인증점검'});
  let calls=0;
  client.voiceRoomAuthPreflight=()=>{calls++;return {};};
  await voice.handle(args);
  assert.equal(calls,0);
  assert.match(sent[0],/봇 계정만 사용할 수 있습니다/);
});

test('VOX auth preflight is in help and never sends credentials',async()=>{
  const {args,sent}=fixture({text:'#보룸명령어'});
  await voice.handle(args);
  assert.match(sent[0],/#보룸인증점검/);
});
