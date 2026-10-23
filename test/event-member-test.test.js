'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {handle}=require('../shared/event-member-test');

function request(overrides={}) {
  const messages=[];
  const client={
    connected:true,userId:'999',
    getCachedMemberProfiles:()=>[
      {id:'101',name:'𒊮𝐀𝐏𝐄𝐗 정 ᯽'},
      {id:'102',name:'일반'},
      {id:'999',name:'APEX 봇'}
    ],
    refreshMemberProfiles:()=>{throw Error('Must not request MEMLIST')}
  };
  return {client,roomId:'100',msg:{room:{isOpenChat:true},sender:{type:1}},
    send:async text=>{messages.push(text)},messages,...overrides};
}

test('event cache diagnostic detects styled APEX and excludes bot without server query',async()=>{
  const ctx=request();await handle(ctx);
  assert.equal(ctx.messages.length,1);
  assert.match(ctx.messages[0],/캐시에서 확인된 인원: 3명/);
  assert.match(ctx.messages[0],/APEX 후보\(캐시 기준\): 1명/);
  assert.match(ctx.messages[0],/현재 참여 여부는 확인되지 않았습니다/);
});

test('event cache diagnostic rejects unauthorized and regular chat rooms',async()=>{
  const a=request({msg:{room:{isOpenChat:true},sender:{type:2}}});await handle(a);
  assert.match(a.messages[0],/방장 또는 부방장/);
  const b=request({msg:{room:{isOpenChat:false},sender:{type:1}}});await handle(b);
  assert.match(b.messages[0],/오픈채팅방/);
});

test('event cache lookup and reply failures are safely contained',async()=>{
  const ctx=request();ctx.client.getCachedMemberProfiles=()=>{
    ctx.client.connected=false;throw Error('Connection closed');
  };
  await assert.doesNotReject(handle(ctx));assert.equal(ctx.messages.length,0);
  ctx.client.connected=true;
  ctx.client.getCachedMemberProfiles=()=>{throw Error('Unexpected cache failure')};
  ctx.send=async()=>{throw Error('Not connected')};
  await assert.doesNotReject(handle(ctx));
});

test('event cache lookup blocks concurrent requests in the same room',async()=>{
  const ctx=request();
  let release;
  ctx.client.getCachedMemberProfiles=()=>new Promise(resolve=>{release=resolve});
  const first=handle(ctx);await handle(ctx);
  assert.match(ctx.messages[0],/이미 이벤트 인원 캐시/);
  release([{id:'101',name:'APEX'}]);
  await first;
  assert.match(ctx.messages[1],/APEX 후보\(캐시 기준\): 1명/);
});

test('event cache diagnostic never requests live member information',async()=>{
  const ctx=request();let attempts=0;
  ctx.client._carriage={memList:()=>{attempts++},chatOnRoom:()=>{attempts++}};
  await handle(ctx);
  assert.equal(attempts,0);
});

require('ts-node/register/transpile-only');
const {KakaoForgeClient} = require('../src/client/client');

function mockRosterClient(body) {
  const client=Object.create(KakaoForgeClient.prototype);
  Object.assign(client,{
    _carriage:{_socket:{destroyed:false},memList:async()=>({status:0,body})},
    _resolveChatId:id=>id,
    _eventRosterIds:new Map(),_eventDepartedIds:new Map(),
    _memberNames:new Map(),_memberTypes:new Map(),
    _memberProfileLinkIds:new Map(),_memberProfileTypes:new Map(),
    _memberProfileImages:new Map(),
    _chatRooms:new Map(),_touchMemberCache:()=>{}
  });
  return client;
}

test('member refresh supports m arrays without losing exact string IDs',async()=>{
  const client=mockRosterClient({m:[{userId:'9007199254740993123',nickName:'𝐀𝐏𝐄𝐗',mt:2}],token:0});
  const progress=[];
  const result=await client.refreshMemberProfiles('18495931541358610',{onProgress:x=>progress.push(x)});
  assert.equal(result.length,1);
  assert.equal(result[0].id,'9007199254740993123');
  assert.equal(result[0].name,'𝐀𝐏𝐄𝐗');
  assert.equal(progress[0].source,'m');
  assert.deepEqual(progress[0].bodyKeys,['m','token']);
});

test('empty MEMLIST reports diagnostic keys instead of fake zero participants',async()=>{
  const client=mockRosterClient({someField:1,token:0});
  const progress=[];
  await assert.rejects(()=>client.refreshMemberProfiles('18495931541358610',{onProgress:x=>progress.push(x)}),/No current member IDs returned/);
  assert.equal(progress[0].source,'none');
  assert.deepEqual(progress[0].bodyKeys,['someField','token']);
});


test('member refresh accepts memberIds without unsafe numeric conversion',async()=>{
  const exact='9007199254740993123';
  const client=mockRosterClient({status:0,type:1,memberIds:[exact],token:0});
  const progress=[];
  const result=await client.refreshMemberProfiles('100',{onProgress:p=>progress.push(p)});
  assert.deepEqual(result.map(x=>x.id),[exact]);
  assert.equal(progress[0].source,'memberIds');
  assert.equal(progress[0].totalMembers,1);
});

test('manual event test falls back to CHATONROOM profiles when MEMLIST is status only',async()=>{
  const client=mockRosterClient({status:0});
  let calls=0;
  client._carriage.chatOnRoom=async()=>{calls++;return {status:0,body:{
    status:0,m:[{userId:'9007199254740993123',nickName:'𝐀𝐏𝐄𝐗 멤버',mt:2}]
  }};};
  const progress=[];
  const result=await client.refreshMemberProfiles('100',{
    allowChatOnRoomFallback:true,onProgress:p=>progress.push(p)
  });
  assert.equal(calls,1);
  assert.equal(result.length,1);
  assert.equal(result[0].id,'9007199254740993123');
  assert.equal(result[0].name,'𝐀𝐏𝐄𝐗 멤버');
  assert.deepEqual(progress.map(x=>x.source),['none','CHATONROOM:m']);
});

test('manual event scan refuses a roster with IDs but no verified nicknames',async()=>{
  const client=mockRosterClient({memberIds:['9007199254740993123'],token:0});
  client._carriage.chatOnRoom=async()=>({status:0,body:{status:0}});
  await assert.rejects(
    ()=>client.refreshMemberProfiles('100',{allowChatOnRoomFallback:true}),
    /no nicknames available/
  );
});

test('manual event reply warns when only some member nicknames are known',async()=>{
  const ctx=request();
  ctx.client.refreshMemberProfiles=async()=>[
    {id:'101',name:'APEX'},
    {id:'102',name:''}
  ];
  await handle(ctx);
  assert.match(ctx.messages[0],/전체 추첨 대상은 미확정/);
});


test('getCachedMemberProfiles reads exact ID strings without network calls',()=>{
  const client=mockRosterClient({status:0});
  const room='18495931541358610',exact='9007199254740993123';
  client._cacheMembers(room,[{userId:exact,nickName:'𝐀𝐏𝐄𝐗 회원',mt:2}]);
  client._setEventRoomRoster(room,[{userId:exact}]);
  client._carriage.memList=()=>{throw Error('Unexpected MEMLIST')};
  client._carriage.chatOnRoom=()=>{throw Error('Unexpected CHATONROOM')};
  const result=client.getCachedMemberProfiles(room);
  assert.deepEqual(result.map(m=>m.id),[exact]);
  assert.equal(result[0].name,'𝐀𝐏𝐄𝐗 회원');
});


test('event cache excludes left participant even when stale profile data remains',()=>{
  const client=mockRosterClient({status:0});
  const room='18495931541358610';
  const current='9007199254740993123', departed='9007199254740993124';
  const people=[
    {userId:current,nickName:'𝐀𝐏𝐄𝐗 남은사람',mt:2},
    {userId:departed,nickName:'𝐀𝐏𝐄𝐗 퇴장자',mt:2}
  ];
  client._cacheMembers(room,people);
  client._setEventRoomRoster(room,people);
  assert.equal(client.getCachedMemberProfiles(room).length,2);
  client._trackEventRoomMembership('leave',{
    room:{id:room,isOpenChat:true},member:{ids:[departed],names:['']}
  });
  assert.deepEqual(client.getCachedMemberProfiles(room).map(m=>m.id),[current]);
  // Late profile response must not make a departed participant eligible again.
  client._cacheMembers(room,[people[1]]);
  assert.deepEqual(client.getCachedMemberProfiles(room).map(m=>m.id),[current]);
  // Even an old room snapshot cannot re-add an unjoined participant.
  client._setEventRoomRoster(room,people);
  assert.deepEqual(client.getCachedMemberProfiles(room).map(m=>m.id),[current]);
});

test('event cache excludes kicked participants in only the specified room',()=>{
  const client=mockRosterClient({status:0});
  const room='100', other='200', id='9007199254740993123';
  client._cacheMembers(room,[{userId:id,nickName:'APEX'}]);
  client._cacheMembers(other,[{userId:id,nickName:'APEX'}]);
  client._setEventRoomRoster(room,[{userId:id}]);
  client._setEventRoomRoster(other,[{userId:id}]);
  client._trackEventRoomMembership('kick',{
    room:{id:room,isOpenChat:true},member:{ids:[id],names:[]}
  });
  assert.equal(client.getCachedMemberProfiles(room).length,0);
  assert.equal(client.getCachedMemberProfiles(other).length,1);
});

test('joined participant is restored after a fresh join event',()=>{
  const client=mockRosterClient({status:0});
  const room='100', id='9007199254740993123',person={userId:id,nickName:'APEX 새로 입장'};
  client._cacheMembers(room,[person]);
  client._setEventRoomRoster(room,[person]);
  client._trackEventRoomMembership('leave',{room:{id:room,isOpenChat:true},member:{ids:[id]}});
  assert.equal(client.getCachedMemberProfiles(room).length,0);
  client._trackEventRoomMembership('join',{
    room:{id:room,isOpenChat:true},
    member:{ids:[id]}, members:[{id,name:'APEX 새로 입장',type:2}]
  });
  assert.deepEqual(client.getCachedMemberProfiles(room).map(m=>m.id),[id]);
});

test('event cache refuses member profiles without a current snapshot',()=>{
  const client=mockRosterClient({status:0});
  const room='100',id='9007199254740993123';
  client._cacheMembers(room,[{userId:id,nickName:'APEX 예전회원'}]);
  assert.deepEqual(client.getCachedMemberProfiles(room),[]);
  client._setEventRoomRoster(room,[{userId:id}]);
  assert.equal(client.getCachedMemberProfiles(room).length,1);
  client._eventRosterIds.clear(); // Simulates a dropped connection
  assert.deepEqual(client.getCachedMemberProfiles(room),[]);
});
