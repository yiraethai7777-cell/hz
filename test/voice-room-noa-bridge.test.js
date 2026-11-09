'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createNoaBridge, installFromEnv, bridgeConfig } =
  require('../shared/voice-room-noa-bridge');

const ROOM = '18495931541358610';
const TOKEN = 'private-long-test-bridge-token';
function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  };
}

test('bridge without Noa credentials does not override an existing adapter', () => {
  const old = { create: async () => ({ created: false }) };
  const client = { voiceRoomAdapter: old };
  assert.equal(installFromEnv(client, {
    NEXI_VOICE_NOA_URL: 'https://noa.example/',
    NEXI_VOICE_NOA_TOKEN: TOKEN,
  }), false);
  assert.equal(client.voiceRoomAdapter, old);
});

test('invalid config leaves bot adapter disabled; HTTPS and strong token required', () => {
  const client = {};
  assert.equal(installFromEnv(client, {
    NEXI_VOICE_BRIDGE_ENABLED: '1',
    NEXI_VOICE_NOA_URL: 'http://noa.example',
    NEXI_VOICE_NOA_TOKEN: TOKEN,
  }), false);
  assert.equal(client.voiceRoomAdapter, undefined);
  for (const url of ['http://example.com', 'https://user:pw@example.com', 'https://example.com/?token=x']) {
    assert.throws(() => bridgeConfig(url, TOKEN), /HTTPS/);
  }
  assert.throws(() => bridgeConfig('https://example.com', 'short'), /토큰/);
});

test('opt-in forwards create to exact Noa endpoint, no LOCO packets, and never asserts verified', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return response({ ok: true, chatId: ROOM, title: 'NEXI 테스트' });
  };
  const client = {};
  assert.equal(installFromEnv(client, {
    NEXI_VOICE_BRIDGE_ENABLED: '1',
    NEXI_VOICE_NOA_URL: 'https://noa.example/bridge',
    NEXI_VOICE_NOA_TOKEN: TOKEN,
  }, fetchImpl), true);
  const result = await client.voiceRoomAdapter.create({
    roomId: ROOM, title: 'NEXI 테스트', openLinkId: 'private-open-link',
  });
  assert.deepEqual(result, { requestAccepted: true, verified: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://noa.example/bridge/api/vox/voice-rooms');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.redirect, 'error');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer ' + TOKEN);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { chatId: ROOM, title: 'NEXI 테스트' });
  assert.doesNotMatch(calls[0].opts.body, /private-open-link/);
});

test('mismatched room or backend error never becomes accepted creation', async () => {
  let bridge = createNoaBridge({
    baseUrl: 'https://noa.example', token: TOKEN,
    fetchImpl: async () => response({ ok: true, chatId: '99999999999' }),
  });
  assert.deepEqual(await bridge.create({ roomId: ROOM, title: '테스트' }), {
    requestAccepted: false, verified: false,
  });
  bridge = createNoaBridge({
    baseUrl: 'https://noa.example', token: TOKEN,
    fetchImpl: async () => response({ ok: false, chatId: ROOM }),
  });
  assert.equal((await bridge.create({ roomId: ROOM, title: '테스트' })).requestAccepted, false);
});

test('HTTP error never echoes body, credentials or unknown server content', async () => {
  const bridge = createNoaBridge({
    baseUrl: 'https://noa.example', token: TOKEN,
    fetchImpl: async () => response({ token: TOKEN, raw: 'very-private-data' }, 401),
  });
  await assert.rejects(
    () => bridge.create({ roomId: ROOM, title: '테스트' }),
    err => !String(err.message).includes(TOKEN) &&
      !String(err.message).includes('very-private-data') &&
      /브리지 HTTP 응답: 401/.test(err.message),
  );
});

test('Noa module status is local session evidence only, never a verified Kakao server status', async () => {
  const bridge = createNoaBridge({
    baseUrl: 'https://noa.example', token: TOKEN,
    fetchImpl: async (url, opts) => {
      assert.equal(new URL(url).pathname, '/api/vox/status');
      assert.equal(opts.method, 'GET');
      return response({
        moduleLoaded: true,
        voiceroom: { idle: false, chatId: ROOM, callId: 'private-call', screen: 'VOX' },
      });
    },
  });
  const state = await bridge.status({ roomId: ROOM });
  assert.deepEqual(state, {
    roomId: ROOM, verified: false, localSession: true, localActive: true,
    statusKnown: true,
  });
  const otherRoom = await bridge.status({ roomId: '99999999999' });
  assert.equal(otherRoom.localActive, false);
  assert.equal(otherRoom.verified, false);
  assert.equal(bridge.stop, undefined);
});

test('invalid room ID and title are rejected before sending HTTP requests', async () => {
  let sends = 0;
  const bridge = createNoaBridge({
    baseUrl: 'https://noa.example', token: TOKEN,
    fetchImpl: async () => { sends++; return response({ ok: true, chatId: ROOM }); },
  });
  await assert.rejects(() => bridge.create({ roomId: 'not-an-id', title: 'test' }), /ID/);
  await assert.rejects(() => bridge.create({ roomId: ROOM, title: 'a'.repeat(41) }), /제목/);
  await assert.rejects(() => bridge.status({ roomId: '-1' }), /ID/);
  assert.equal(sends, 0);
});


const BOT_ID = '9007199254740993123';

test('Noa bridge connects automatically when credentials are configured, without any ON switch', () => {
  const client = {};
  assert.equal(installFromEnv(client, {
    NEXI_VOICE_NOA_URL: 'https://noa.example',
    NEXI_VOICE_NOA_TOKEN: TOKEN,
  }, async () => response({ ok: false })), true);
  assert.equal(typeof client.voiceRoomAdapter.join, 'function');
  assert.equal(typeof client.voiceRoomAdapter.leave, 'function');
  assert.equal(typeof client.voiceRoomAdapter.status, 'function');
});

function mockNoaJoin(fetchCalls, { userId = BOT_ID, activeRoom = null, accepted = true } = {}) {
  return async (url, opts) => {
    const path = new URL(url).pathname;
    fetchCalls.push({ path, method: opts.method, body: opts.body });
    if (path === '/api/status') {
      return response({
        currentUserId: userId, androidAvailable: true,
        kakaoHookActive: true, voxControlActive: true,
      });
    }
    if (path === '/api/vox/status') {
      return response({
        moduleLoaded: true,
        voiceroom: activeRoom == null
          ? { idle: true, chatId: null } : { idle: false, chatId: activeRoom },
      });
    }
    if (path === '/api/vox/voice-rooms/join') {
      return response({ ok: accepted, chatId: ROOM, callId: 'redacted-session-id' });
    }
    if (path === '/api/vox/leave') {
      return response({ ok: accepted, chatId: ROOM, kind: 'voiceroom' });
    }
    throw Error('unexpected path ' + path);
  };
}

test('join calls the real Noa voice-room endpoint and checks the bot identity first', async () => {
  const calls = [];
  const bridge = createNoaBridge({
    baseUrl: 'https://noa.example', token: TOKEN, fetchImpl: mockNoaJoin(calls),
  });
  assert.deepEqual(await bridge.join({roomId:ROOM,botUserId:BOT_ID}),
    {requestAccepted:true,verified:false});
  assert.deepEqual(calls.map(x => x.path), [
    '/api/status', '/api/vox/voice-rooms/join',
  ]);
  assert.deepEqual(JSON.parse(calls[1].body), {chatId:ROOM});
  assert.doesNotMatch(JSON.stringify(calls[1]), /redacted-session-id|Authorization/);
});

test('different Android KakaoTalk account blocks every mutating action', async () => {
  const calls = [];
  const bridge = createNoaBridge({
    baseUrl: 'https://noa.example', token: TOKEN,
    fetchImpl: mockNoaJoin(calls, {userId:'11111111111111'}),
  });
  await assert.rejects(()=>bridge.join({roomId:ROOM,botUserId:BOT_ID}), /계정|VOX/);
  await assert.rejects(()=>bridge.leave({roomId:ROOM,botUserId:BOT_ID}), /계정|VOX/);
  assert.deepEqual(calls.map(x=>x.path), ['/api/status', '/api/status']);
});

test('missing or unavailable VOX identity refuses to send join', async () => {
  const calls = [];
  const bridge = createNoaBridge({
    baseUrl: 'https://noa.example', token: TOKEN,
    fetchImpl: async (url, opts) => {
      calls.push(new URL(url).pathname);
      return response({
        currentUserId: BOT_ID, androidAvailable: true,
        kakaoHookActive: true, voxControlActive: false,
      });
    },
  });
  await assert.rejects(()=>bridge.join({roomId:ROOM,botUserId:BOT_ID}), /VOX/);
  assert.deepEqual(calls,['/api/status']);
});

test('Noa leave only requests ending the Android voice session, never the whole room', async () => {
  const calls = [];
  const bridge = createNoaBridge({
    baseUrl: 'https://noa.example', token: TOKEN, fetchImpl: mockNoaJoin(calls),
  });
  assert.deepEqual(await bridge.leave({roomId:ROOM,botUserId:BOT_ID}),
    {requestAccepted:true,verified:false});
  assert.deepEqual(JSON.parse(calls.at(-1).body),
    {chatId:ROOM,kind:'voiceroom'});
  assert.equal(bridge.stop,undefined);
});

test('Noa local status detects a busy voice session in a different room', async () => {
  const calls = [];
  const bridge = createNoaBridge({
    baseUrl: 'https://noa.example', token: TOKEN,
    fetchImpl: mockNoaJoin(calls,{activeRoom:'444444444444444'}),
  });
  const state = await bridge.status({roomId:ROOM,botUserId:BOT_ID});
  assert.equal(state.localBusyOtherRoom,true);
  assert.equal(state.localActive,false);
  assert.equal(state.verified,false);
  assert.deepEqual(calls.map(x=>x.path), ['/api/status','/api/vox/status']);
});

test('join rejects invalid bot identity or room before mutating VOX', async () => {
  const calls = [];
  const bridge = createNoaBridge({
    baseUrl: 'https://noa.example', token: TOKEN, fetchImpl: mockNoaJoin(calls),
  });
  await assert.rejects(()=>bridge.join({roomId:'bad',botUserId:BOT_ID}), /ID/);
  await assert.rejects(()=>bridge.join({roomId:ROOM,botUserId:'bad'}), /ID/);
  assert.equal(calls.length,0);
});
