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
