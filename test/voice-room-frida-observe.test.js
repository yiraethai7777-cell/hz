'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../experiments/voice-room/frida-vox-observe.js'), 'utf8');

function run(runtime) {
  const events = [];
  const sandbox = { send: e => events.push(e), ...runtime };
  vm.runInNewContext(source, sandbox, { timeout: 2000 });
  return events;
}

test('Frida probe is explicitly read-only and reports unavailable Java VM', () => {
  const events = run({ Java: { available: false } });
  assert.deepEqual(events.map(e => e.event), ['unavailable']);
});

test('hooks version-matched VOX methods without changing arguments or result', () => {
  const calls = [];
  const signatures = {
    makeVoiceroom: [{ call: (instance, ...args) => {
      calls.push({ method: 'makeVoiceroom', instance, args }); return 42;
    }}],
    joinVoiceroom: [{ call: (instance, ...args) => {
      calls.push({ method: 'joinVoiceroom', instance, args }); return 'joined';
    }}],
  };
  const runtime = { Java: {
    available: true, perform: f => f(),
    enumerateMethods: query => query.includes('voiceroom') ? [{ classes: [{
      name: 'test.VoxManager',
      methods: ['makeVoiceroom(java.lang.String)', 'joinVoiceroom(long, long)', 'notVox(java.lang.String)'],
    }] }] : [],
    use: name => {
      assert.equal(name, 'test.VoxManager');
      return Object.fromEntries(Object.entries(signatures).map(([k, overloads]) => [k, { overloads }]));
    },
  }};
  const events = run(runtime);
  assert.equal(events.filter(e => e.event === 'installed').length, 2);
  const target = { fake: true };
  assert.equal(signatures.makeVoiceroom[0].implementation.call(target, 'secret-room-id'), 42);
  assert.equal(signatures.joinVoiceroom[0].implementation.call(target, 'private-token', 3), 'joined');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ['secret-room-id']);
  assert.deepEqual(calls[1].args, ['private-token', 3]);
  assert.equal(events.filter(e => e.event === 'enter').length, 2);
  assert.equal(events.filter(e => e.event === 'return').length, 2);
  assert.ok(!JSON.stringify(events).includes('secret-room-id'));
  assert.ok(!JSON.stringify(events).includes('private-token'));
  assert.equal(events.at(-1).event, 'return');
});

test('original error propagates without revealing secret exception text', () => {
  const original = { call: () => { throw Error('hidden-private-token'); } };
  const events = run({ Java: {
    available: true, perform: f => f(),
    enumerateMethods: q => q.includes('Moderator') ? [{ classes: [{
      name: 'test.Manager', methods: ['vRCAcceptModeratorInvitation()'],
    }] }] : [],
    use: () => ({ vRCAcceptModeratorInvitation: { overloads: [original] } }),
  }});
  assert.throws(() => original.implementation(), /hidden-private-token/);
  assert.equal(events.at(-1).event, 'original_exception');
  assert.ok(!JSON.stringify(events).includes('hidden-private-token'));
});

test('no method arguments are collected or sent even when original receives objects', () => {
  const original = { call: (_this, arg) => arg };
  const events = run({ Java: {
    available: true, perform: f => f(),
    enumerateMethods: q => q.includes('voiceroom') ? [{ classes: [{
      name: 'test.Vox', methods: ['joinVoiceroom(java.lang.Object)'],
    }] }] : [],
    use: () => ({ joinVoiceroom: { overloads: [original] } }),
  }});
  const privateData = { token: 'private-secret', callId: '123' };
  assert.strictEqual(original.implementation(privateData), privateData);
  assert.ok(!JSON.stringify(events).includes('private-secret'));
  assert.ok(!JSON.stringify(events).includes('123'));
});
