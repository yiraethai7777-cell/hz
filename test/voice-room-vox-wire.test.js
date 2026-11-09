'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const v = require('../shared/voice-room-vox-wire');
function bson(obj = { version: 1, t: '테스트' }) {
  // Minimal valid BSON for offline tests; production has a bson dependency.
  const parts = [];
  for (const [key, val] of Object.entries(obj)) {
    const k = Buffer.from(key + '\0');
    if (typeof val === 'number') {
      const p = Buffer.alloc(1 + k.length + 4);
      p[0] = 0x10;
      k.copy(p, 1);
      p.writeInt32LE(val, 1 + k.length);
      parts.push(p);
    } else if (typeof val === 'string') {
      const b = Buffer.from(val, 'utf8');
      const p = Buffer.alloc(1 + k.length + 4 + b.length + 1);
      p[0] = 2;
      k.copy(p, 1);
      p.writeInt32LE(b.length + 1, 1 + k.length);
      b.copy(p, 1 + k.length + 4);
      parts.push(p);
    }
  }
  const len = 4 + parts.reduce((a, b) => a + b.length, 0) + 1;
  const data = Buffer.alloc(len);
  data.writeInt32LE(len, 0);
  let off = 4;
  for (const p of parts) { p.copy(data, off); off += p.length; }
  return data;
}
const sample = bson();
const nonce = Buffer.from('010203040000', 'hex');

test('experimental VOX method numbers and header layout from public research', () => {
  assert.equal(v.METHODS.LOGIN, 11002);
  assert.equal(v.METHODS.PING, 11015);
  assert.equal(v.METHODS.CLIENT_OFFER, 12023);
  assert.equal(v.HEADER_LENGTH, 12);
  assert.equal(v.IV.toString('hex'), '6d10dd11ba3761c9771e22f36e10c19d');
});
test('deterministic SEED-CBC packet round-trip preserves raw BSON bytes', () => {
  assert.equal(v.cipherAvailable(), true);
  const packet = v.pack(v.METHODS.LOGIN, sample, nonce);
  assert.equal(packet.readUInt16LE(6), 11002);
  assert.equal(packet.subarray(0, 6).toString('hex'), nonce.toString('hex'));
  assert.equal(packet.readUInt32LE(8), packet.length - v.HEADER_LENGTH);
  const out = v.unpack(packet);
  assert.deepEqual(out.payload, sample);
  assert.equal(out.method, 11002);
  assert.deepEqual(out.nonce, nonce);
});
test('split and merged TLS chunks produce complete frames', () => {
  const a = v.pack(v.METHODS.LOGIN, sample, nonce);
  const b = v.pack(v.METHODS.PING, bson({ version: 2 }), nonce);
  const stream = new v.FrameDecoder();
  assert.deepEqual(stream.push(a.subarray(0, 2)), []);
  assert.deepEqual(stream.push(a.subarray(2, 15)), []);
  assert.deepEqual(stream.push(Buffer.concat([a.subarray(15), b])), [a, b]);
});
test('oversized and malformed frames rejected without poisoning later reads', () => {
  const stream = new v.FrameDecoder();
  const bad = Buffer.alloc(12);
  bad.writeUInt32LE(v.MAX_CIPHERTEXT + 16, 8);
  assert.throws(() => stream.push(bad), /Invalid/);
  const a = v.pack(v.METHODS.PING, sample, nonce);
  assert.deepEqual(stream.push(a), [a]);
  assert.throws(() => v.unpack(Buffer.concat([a, Buffer.alloc(16)])), /length/);
});
test('invalid nonce, method and BSON input fail closed', () => {
  assert.throws(() => v.pack(70000, sample, nonce), /method/);
  assert.throws(() => v.pack(v.METHODS.LOGIN, sample, Buffer.alloc(2)), /nonce/);
  assert.throws(() => v.pack(v.METHODS.LOGIN, Buffer.from('bad'), nonce), /payload/);
  const tampered = Buffer.from(sample);
  tampered.writeInt32LE(0, 0);
  assert.throws(() => v.pack(v.METHODS.LOGIN, tampered, nonce), /BSON/);
});
test('fixed LE framing and SEED-CBC regression vector', () => {
  const known = Buffer.from('120000001076657273696f6e000100000000', 'hex');
  const framed = v.pack(v.METHODS.LOGIN, known, nonce);
  assert.equal(framed.toString('hex'),
    '010203040000fa2a20000000c729da4926fec31cac5d04826482a993714b16b1720e22ba52b9a5d0e3664ec7');
  assert.deepEqual(v.unpack(framed).payload, known);
});
