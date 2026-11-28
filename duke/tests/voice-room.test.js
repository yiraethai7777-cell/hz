'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCore } = require('../core');
const { registerVoiceRoom } = require('../manage/voice-room');

function setup(adapter, watchOpen = () => null, watchEnd = () => null) {
  const replies = [];
  const core = createCore({
    allowedRooms: new Set(['1']),
    canHandle: event => !event.botOff,
    canExecute: (event, command) => command.section !== 'MANAGEMENT' || !event.manageOff,
    send: async (room, message) => replies.push(message),
  });
  registerVoiceRoom(core, {
    canManage: event => event.userId === '2',
    getAdapter: () => adapter,
    watchOpen,
    watchEnd,
  });
  const run = (text, overrides = {}) => core.handle({ text, roomId: '1', userId: '2', ...overrides });
  return { replies, run };
}

test('voice commands obey the existing prefix, room, power and management gates', async () => {
  const { replies, run } = setup({ create: () => assert.fail('unexpected start') });
  assert.equal(await run('#보룸시작'), false);
  assert.equal(await run('-보룸시작', { roomId: '9' }), false);
  assert.equal(await run('-보룸시작', { botOff: true }), false);
  assert.equal(await run('-보룸시작', { manageOff: true }), false);
  assert.equal(await run('-보룸시작', { userId: '3' }), true);
  assert.match(replies[0], /관리 권한이 없습니다/);
});

test('start requires server confirmation and stop releases only local VOX', async () => {
  let released = 0;
  const adapter = {
    async create(request) {
      assert.deepEqual(request, { roomId: '1', title: '테스트 보이스룸' });
      return { requestAccepted: true, callId: '3' };
    },
    async stop() { assert.fail('server hangup must not be called'); },
    async disconnect(request) {
      assert.deepEqual(request, { roomId: '1' });
      return { localReleased: ++released === 1, noLocalSession: released !== 1, serverEnded: false };
    },
  };
  const unconfirmed = setup(adapter);
  await unconfirmed.run('-보룸시작 테스트 보이스룸');
  await unconfirmed.run('-보룸종료');
  assert.match(unconfirmed.replies[0], /개설 여부는 확인되지 않았습니다/);
  assert.match(unconfirmed.replies[1], /보룸을 종료하였습니다\.$/);
  const confirmed = setup(adapter, roomId => ({ wait: async callId => roomId === '1' && callId === '3', close() {} }));
  await confirmed.run('-보룸시작 테스트 보이스룸');
  await confirmed.run('-보룸종료');
  assert.match(confirmed.replies[0], /개설되었습니다/);
  assert.match(confirmed.replies[1], /해제할 듀크 봇의 VOX 연결이 없습니다/);
});

test('local disconnect reports unavailable or unverified without claiming room termination',async()=>{
  for(const adapter of [{},{disconnect:async()=>({localReleased:false})}]){
    const {replies,run}=setup(adapter);
    await run('-보룸종료');
    assert.match(replies[0],/사용할 수 없습니다|확인하지 못했습니다/);
  }
});

test('unavailable operations return their status without sending requests', async () => {
  const forbidden = () => assert.fail('unexpected VOX request');
  const { replies, run } = setup({ status: async () => ({}), stop: forbidden, join: forbidden, acceptRole: forbidden });
  for (const command of ['보룸참가', '진행자주기', '진행자받기', '스피커주기', '스피커받기']) {
    assert.equal(await run('-' + command), true);
  }
  assert.equal(replies.length, 5);
  for (const reply of replies) assert.match(reply, /검증/);
});
