'use strict';

// Offline-only experimental VOX control packet codec.
// Source: 2020 VoIP framing (storycraft) + 2025 VoiceRoom analysis (itznullbyte).
// NOT authenticated or validated against a current KakaoTalk VOX server.
// Does not open sockets and cannot log in or join a voice room.
const crypto = require('node:crypto');
const HEADER_LENGTH = 12;
const BLOCK_LENGTH = 16;
const MAX_CIPHERTEXT = 1024 * 1024;
const IV = Buffer.from('6d10dd11ba3761c9771e22f36e10c19d', 'hex');
const METHODS = Object.freeze({ LOGIN: 11002, PING: 11015, CLIENT_OFFER: 12023 });

function cipherAvailable() {
  return crypto.getCiphers().includes('seed-cbc');
}
function ensureCipher() {
  if (!cipherAvailable()) {
    throw new Error('SEED-CBC를 지원하는 별도 Node 실행 환경이 필요합니다. 기존 봇 프로세스의 OpenSSL 설정을 변경하지 마세요.');
  }
}
function deriveKey(first8) {
  if (!Buffer.isBuffer(first8) || first8.length !== 8) throw new TypeError('VOX header prefix must be 8 bytes');
  return crypto.createHash('md5').update(first8).digest();
}
function validateMethod(method) {
  if (!Number.isInteger(method) || method < 0 || method > 0xffff) throw new RangeError('Invalid VOX method');
}
function validateNonce(nonce) {
  if (!Buffer.isBuffer(nonce) || nonce.length !== 6) throw new TypeError('VOX nonce must be 6 bytes');
}
function createNonce() {
  // Older packet description uses four random bytes followed by two zero bytes;
  // newer 2025 writeup describes the entire six-byte region as a nonce.
  // We only encode offline until an actual runtime trace clarifies this distinction.
  return Buffer.concat([crypto.randomBytes(4), Buffer.alloc(2)]);
}
function encryptPayload(payload, headerPrefix) {
  ensureCipher();
  if (!Buffer.isBuffer(payload) || payload.length < 5 || payload.length > MAX_CIPHERTEXT - BLOCK_LENGTH) {
    throw new RangeError('Invalid VOX BSON payload');
  }
  const length = payload.readInt32LE(0);
  if (length !== payload.length || payload[payload.length - 1] !== 0) throw new Error('Invalid BSON wire length');
  const key = deriveKey(headerPrefix);
  const cipher = crypto.createCipheriv('seed-cbc', key, IV);
  return Buffer.concat([cipher.update(payload), cipher.final()]);
}
function decryptPayload(ciphertext, headerPrefix) {
  ensureCipher();
  if (!Buffer.isBuffer(ciphertext) || !ciphertext.length || ciphertext.length > MAX_CIPHERTEXT ||
      ciphertext.length % BLOCK_LENGTH !== 0) throw new RangeError('Invalid ciphertext size');
  const decipher = crypto.createDecipheriv('seed-cbc', deriveKey(headerPrefix), IV);
  const payload = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  if (payload.length < 5 || payload.readInt32LE(0) !== payload.length || payload.at(-1) !== 0) {
    throw new Error('Decrypted VOX payload is not valid BSON framing');
  }
  return payload;
}
function pack(method, payload, nonce = createNonce()) {
  validateMethod(method); validateNonce(nonce);
  const prefix = Buffer.alloc(8);
  nonce.copy(prefix, 0);
  prefix.writeUInt16LE(method, 6);
  const ciphertext = encryptPayload(payload, prefix);
  const packet = Buffer.allocUnsafe(HEADER_LENGTH + ciphertext.length);
  prefix.copy(packet, 0);
  packet.writeUInt32LE(ciphertext.length, 8);
  ciphertext.copy(packet, HEADER_LENGTH);
  return packet;
}
function unpack(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < HEADER_LENGTH + BLOCK_LENGTH) throw new Error('Incomplete VOX frame');
  const length = packet.readUInt32LE(8);
  if (length < BLOCK_LENGTH || length > MAX_CIPHERTEXT || length % BLOCK_LENGTH !== 0 ||
      packet.length !== HEADER_LENGTH + length) throw new Error('Invalid VOX frame length');
  return {
    method: packet.readUInt16LE(6),
    nonce: Buffer.from(packet.subarray(0, 6)),
    payload: decryptPayload(packet.subarray(HEADER_LENGTH), packet.subarray(0, 8)),
  };
}
class FrameDecoder {
  #buf = Buffer.alloc(0);
  // Returns complete frame buffers, never decrypts or logs payloads.
  push(chunk) {
    if (!Buffer.isBuffer(chunk)) throw new TypeError('Expected network bytes');
    if (chunk.length > MAX_CIPHERTEXT + HEADER_LENGTH) throw new Error('Overlarge VOX network chunk');
    this.#buf = Buffer.concat([this.#buf, chunk]);
    const frames = [];
    while (this.#buf.length >= HEADER_LENGTH) {
      const length = this.#buf.readUInt32LE(8);
      if (length < BLOCK_LENGTH || length > MAX_CIPHERTEXT || length % BLOCK_LENGTH !== 0) {
        this.#buf = Buffer.alloc(0);
        throw new Error('Invalid VOX ciphertext length');
      }
      const total = HEADER_LENGTH + length;
      if (this.#buf.length < total) break;
      frames.push(Buffer.from(this.#buf.subarray(0, total)));
      this.#buf = this.#buf.subarray(total);
    }
    return frames;
  }
  reset() { this.#buf = Buffer.alloc(0); }
}
module.exports = { HEADER_LENGTH, BLOCK_LENGTH, MAX_CIPHERTEXT, IV, METHODS,
  cipherAvailable, deriveKey, createNonce, encryptPayload, decryptPayload, pack, unpack, FrameDecoder };
