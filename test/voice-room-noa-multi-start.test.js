'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  roomList, cleanTitle, startMultiple, main,
} = require('../experiments/voice-room/noa-multi-start');
const ROOM_A = '18496234145974738';
const ROOM_B = '18357439193628181';
const BOT = '9007199254740993123';

test('two real room IDs are passed sequentially to the hook bridge, without a leave', async () => {
  const calls = [];
  const waits = [];
  const result = await startMultiple({
    roomIds: [ROOM_A, ROOM_B],
    botUserId: BOT,
    title: 'NEXI 보룸',
    adapter: {
      create: async arg => {
        calls.push(arg);
        return { requestAccepted: true, verified: false };
      },
      leave: async () => { throw Error('must not leave original VOX session'); },
    },
    delayMs: 1200,
    sleep: async ms => { waits.push(ms); },
  });
  assert.deepEqual(calls, [
    { roomId: ROOM_A, title: 'NEXI 보룸', botUserId: BOT },
    { roomId: ROOM_B, title: 'NEXI 보룸', botUserId: BOT },
  ]);
  assert.deepEqual(waits, [1200]);
  assert.deepEqual(result.map(x => x.state), [
    'request_accepted', 'request_accepted',
  ]);
  assert.ok(result.every(x => x.serverVerified === false));
});

test('a failed first room does not prevent the second command', async () => {
  const calls = [];
  const result = await startMultiple({
    roomIds: [ROOM_A, ROOM_B], botUserId: BOT,
    adapter: { create: async data => {
      calls.push(data.roomId);
      if (data.roomId === ROOM_A) throw Error('secret-token');
      return { requestAccepted: false };
    }},
    delayMs: 0,
  });
  assert.deepEqual(calls, [ROOM_A, ROOM_B]);
  assert.deepEqual(result.map(x => x.state), [
    'request_failed', 'not_accepted',
  ]);
  assert.ok(!JSON.stringify(result).includes('secret-token'));
});

test('rejects unsafe IDs, duplicates, excessive rooms and control chars before requests', async () => {
  assert.throws(() => roomList([ROOM_A, ROOM_A]), /중복/);
  assert.throws(() => roomList(['9223372036854775808']), /Int64/);
  assert.throws(() => roomList(['1e10']), /Int64/);
  assert.throws(() => roomList(Array.from({ length: 13 }, (_, i) => String(i + 1))), /1~12/);
  assert.throws(() => cleanTitle('abc\nhello'), /제어문자/);
  let called = 0;
  await assert.rejects(() => startMultiple({
    roomIds: ['-1'], botUserId: BOT,
    adapter: { create: async () => { called++; } },
  }), /Int64/);
  assert.equal(called, 0);
});

test('absence of Noa credentials is not treated as successful creation', async () => {
  await assert.rejects(() => main([ROOM_A], {
    NEXI_BOT_USER_ID: BOT,
  }, () => {}), /브리지/);
});
