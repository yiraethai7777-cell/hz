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

test('bridge is disabled without explicit opt-in and never changes existing adapter', () => {
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
