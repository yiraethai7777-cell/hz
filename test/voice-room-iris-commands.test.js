'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {handle,commandOf}=require('../shared/voice-room-iris-commands');
const {installIrisSidecarFromEnv}=require('../shared/voice-room-noa-bridge');

const ROOM='18495931541358610';
const BOT='9007199254740993123';
const TOKEN='private-long-test-bridge-token';
function mock({text='#보룸아이리스시작 방 제목',sender=BOT,bridge,roomOpen=true,direct}={}) {
  const sent=[],calls=[];
  const client={
    userId:BOT,voiceRoomIrisAdapter:bridge,voiceRoomAdapter:direct,
  };
  const msg={room:{id:ROOM,isOpenChat:roomOpen},sender:{id:sender,type:1}};
  const args={client,roomId:ROOM,msg,text,send:async txt=>sent.push(txt)};
  return {args,sent,calls};
}
function bridge({state={statusKnown:true,localActive:false},accepted=true}={}) {
  const calls=[];
  return {
    calls,
    async status(x){calls.push(['status',x]);return state;},
    async create(x){calls.push(['create',x]);return {requestAccepted:accepted,verified:false};},
    async join(x){calls.push(['join',x]);return {requestAccepted:accepted,verified:false};},
    async leave(x){calls.push(['leave',x]);return {requestAccepted:accepted,verified:false};},
  };
}

test('Iris/Noa commands recognized but ordinary direct commands are not hijacked',()=>{
  assert.equal(commandOf('#보룸아이리스시작 제목')[1],'보룸아이리스시작');
  assert.equal(commandOf('#보룸시작 제목'),null);
});

test('Iris/Noa commands do not require a live bridge for explanatory status',async()=>{
  const f=mock({text:'#보룸아이리스상태'});
  assert.equal(await handle(f.args),true);
  assert.match(f.sent[0],/별도 Android 연동이 준비되지 않았습니다/);
});

test('only exact Railway bot account may control remote Android actor',async()=>{
  const b=bridge();
  const f=mock({sender:'111',bridge:b});
  await handle(f.args);
  assert.match(f.sent[0],/봇 계정만/);
  assert.equal(b.calls.length,0);
});

test('open-chat rule is checked before remote Noa requests',async()=>{
  const b=bridge();
  const f=mock({bridge:b,roomOpen:false});
  await handle(f.args);
  assert.match(f.sent[0],/오픈채팅방/);
  assert.equal(b.calls.length,0);
});

test('create uses Iris-compatible Noa adapter but never asserts confirmed 30-second survival',async()=>{
  const b=bridge();
  const f=mock({bridge:b});
  await handle(f.args);
  const create=b.calls.find(x=>x[0]==='create');
  assert.equal(create[1].roomId,ROOM);
  assert.equal(create[1].title,'방 제목');
  assert.equal(create[1].botUserId,BOT);
  assert.match(f.sent[0],/요청이 접수되었습니다/);
  assert.match(f.sent[0],/30초 이상 유지 여부는 아직 검증되지 않았습니다/);
});

test('existing Railway direct voice session prevents Noa duplicate creation',async()=>{
  const b=bridge();
  const f=mock({bridge:b,direct:{status:async()=>({localActive:true})}});
  await handle(f.args);
  assert.match(f.sent[0],/중복 생성을 막았습니다/);
  assert.equal(b.calls.some(x=>x[0]==='create'),false);
});

test('busy Noa Android voice session is protected',async()=>{
  const b=bridge({state:{statusKnown:true,localBusyOtherRoom:true,localActive:false}});
  const f=mock({bridge:b});
  await handle(f.args);
  assert.match(f.sent[0],/다른 방의 음성 세션/);
  assert.equal(b.calls.some(x=>x[0]==='create'),false);
});

test('Noa status is explicitly local evidence, not server-verified',async()=>{
  const b=bridge({state:{statusKnown:true,localActive:true}});
  const f=mock({text:'#보룸아이리스상태',bridge:b});
  await handle(f.args);
  assert.match(f.sent[0],/Android 앱에서 이 방의 음성 세션 감지/);
  assert.match(f.sent[0],/서버에서 30초 이상 유지된 증거는 아닙니다/);
});

test('join and leave preserve account ID and room scope',async()=>{
  const j=bridge();
  await handle(mock({text:'#보룸아이리스참가',bridge:j}).args);
  assert.equal(j.calls.find(x=>x[0]==='join')[1].botUserId,BOT);
  const l=bridge({state:{statusKnown:true,localActive:true}});
  await handle(mock({text:'#보룸아이리스퇴장',bridge:l}).args);
  assert.equal(l.calls.find(x=>x[0]==='leave')[1].roomId,ROOM);
});

test('unverified status blocks create and no secret error is copied to user',async()=>{
  const b=bridge({state:{statusKnown:false}});
  const f=mock({bridge:b});
  await handle(f.args);
  assert.equal(b.calls.some(x=>x[0]==='create'),false);
  const secret='secret-remote-url-token';
  const bad=mock({bridge:{status:async()=>{throw Error(secret);}}});
  await handle(bad.args);
  assert.doesNotMatch(bad.sent[0],new RegExp(secret));
});

test('sidecar installation never replaces existing direct VOX adapter or logs secrets',()=>{
  const direct={kind:'vox30-direct-experimental',create:async()=>({})};
  const client={voiceRoomAdapter:direct};
  const originalLog=console.info,originalWarn=console.warn;
  let logs='';
  try{
    console.info=(msg)=>{logs+=msg;};
    console.warn=(msg)=>{logs+=msg;};
    assert.equal(installIrisSidecarFromEnv(client,{
      NEXI_VOICE_NOA_URL:'https://noa.example',
      NEXI_VOICE_NOA_TOKEN:TOKEN,
      NEXI_VOICE_NOA_ACTOR_USER_ID:'123456789012345678',
    },async()=>{throw Error('network must not be used during install');}),true);
    assert.equal(client.voiceRoomAdapter,direct);
    assert.equal(client.voiceRoomIrisAdapter.kind,'noa-android-experimental');
    assert.doesNotMatch(logs,new RegExp(TOKEN));
  }finally{console.info=originalLog;console.warn=originalWarn;}
});

test('sidecar refuses implicit same-account Android login',()=>{
  const client={voiceRoomAdapter:{kind:'vox30-direct-experimental'}};
  const warn=console.warn;
  try {
    console.warn=()=>{};
    assert.equal(installIrisSidecarFromEnv(client,{
      NEXI_VOICE_NOA_URL:'https://noa.example',
      NEXI_VOICE_NOA_TOKEN:TOKEN,
    }),false);
    assert.equal(client.voiceRoomIrisAdapter,undefined);
  }finally{console.warn=warn;}
});
