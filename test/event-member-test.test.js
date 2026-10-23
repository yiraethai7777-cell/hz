'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {handle} = require('../shared/event-member-test');

function request(overrides = {}) {
  const messages = [];
  const client = {
    connected: true,
    userId: '999',
    refreshMemberProfiles: async (_room, {onProgress}) => {
      onProgress({page: 1, pageMembers: 3, totalMembers: 3, hasMore: false});
      return [
        {id: '101', name: '𒊮𝐀𝐏𝐄𝐗 정 ᯽'},
        {id: '102', name: '일반'},
        {id: '999', name: 'APEX 봇'}
      ];
    }
  };
  return {client, roomId: '100', msg: {room: {isOpenChat: true}, sender: {type: 1}},
    send: async message => {messages.push(message);}, messages, ...overrides};
}

test('event member test normalizes APEX and excludes the bot', async () => {
  const ctx = request();
  await handle(ctx);
  assert.equal(ctx.messages.length, 1);
  assert.match(ctx.messages[0], /조회된 인원: 3명/);
  assert.match(ctx.messages[0], /APEX 추첨 대상: 1명/);
});

test('event member test rejects non-admin and non-open rooms', async () => {
  const noPermission = request({msg: {room: {isOpenChat: true}, sender: {type: 2}}});
  await handle(noPermission);
  assert.match(noPermission.messages[0], /방장 또는 부방장/);
  const notOpen = request({msg: {room: {isOpenChat: false}, sender: {type: 1}}});
  await handle(notOpen);
  assert.match(notOpen.messages[0], /오픈채팅방/);
});

test('event member lookup failure and disconnected response do not throw', async () => {
  const ctx = request();
  ctx.client.refreshMemberProfiles = async () => {
    ctx.client.connected = false;
    throw Error('Connection closed');
  };
  await assert.doesNotReject(handle(ctx));
  assert.equal(ctx.messages.length, 0);
  ctx.client.connected = true;
  ctx.client.refreshMemberProfiles = async () => {throw Error('MEMLIST failed');};
  ctx.send = async () => {throw Error('Not connected');};
  await assert.doesNotReject(handle(ctx));
});

test('event member test prevents concurrent scans in the same room', async () => {
  const ctx = request();
  let finish;
  ctx.client.refreshMemberProfiles = async () => new Promise(resolve => {finish = resolve;});
  const first = handle(ctx);
  await handle(ctx);
  assert.match(ctx.messages[0], /이미 이벤트 인원을 조회/);
  finish([{id:'101',name:'APEX'}]);
  await first;
  assert.match(ctx.messages[1], /APEX 추첨 대상: 1명/);
});

require('ts-node/register/transpile-only');
const {KakaoForgeClient} = require('../src/client/client');

function mockRosterClient(body) {
  const client=Object.create(KakaoForgeClient.prototype);
  Object.assign(client,{
    _carriage:{_socket:{destroyed:false},memList:async()=>({status:0,body})},
    _resolveChatId:id=>id,
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
