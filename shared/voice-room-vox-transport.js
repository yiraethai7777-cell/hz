'use strict';

// Experimental Node.js VOX control *transport*, not a KakaoTalk voice-room client.
// TLS authentication and explicit host allowlisting are mandatory. No automatic
// login packets, guessed BSON, re-logins, or imports in the production bot.
const { EventEmitter } = require('node:events');
const { isIP } = require('node:net');
const tls = require('node:tls');
const wire = require('./voice-room-vox-wire');

const DEFAULT_CONTROL_PORT = 5228; // 2025 third-party research, not live-verified in 2026.
const CONNECT_TIMEOUT_MS = 8000;

function validateTarget({host, servername, allowedHosts, port = DEFAULT_CONTROL_PORT}) {
  if (typeof host !== 'string' || !isIP(host)) {
    throw new Error('VOX 서버의 명확한 IP 주소가 필요합니다.');
  }
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0 ||
      !allowedHosts.includes(host)) {
    // Do not trust an IP from a remote vr_invite message as an outbound target.
    throw new Error('VOX 서버가 사전 검증된 허용목록에 없습니다.');
  }
  if (typeof servername !== 'string' || servername.length > 253 ||
      !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(servername) ||
      isIP(servername) || servername.includes('..')) {
    throw new Error('TLS 인증서 검증용 서버 DNS 이름이 필요합니다.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('잘못된 VOX 제어 포트입니다.');
  }
  return {host, servername, port};
}

class VoxFrameSocket extends EventEmitter {
  constructor(socket) {
    super();
    if (!socket || socket.encrypted !== true || socket.authorized !== true ||
        typeof socket.write !== 'function' || typeof socket.on !== 'function') {
      throw new Error('인증되지 않은 TLS 연결은 사용할 수 없습니다.');
    }
    this.socket = socket;
    this.decoder = new wire.FrameDecoder();
    this.closed = false;
    this._onData = chunk => {
      try {
        for (const packet of this.decoder.push(chunk)) {
          // The caller must validate authentication and BSON meaning.
          // Frame parsing alone never counts as a successful VOX login.
          this.emit('frame', wire.unpack(packet));
        }
      } catch {
        this.emit('failure', 'VOX 프레임 검증 실패');
        this.close();
      }
    };
    this._onError = () => {
      this.emit('failure', 'VOX 연결 오류');
      this.close();
    };
    this._onClose = () => {
      this.closed = true;
      this.decoder.reset();
      this.emit('closed');
    };
    socket.on('data', this._onData);
    socket.on('error', this._onError);
    socket.on('close', this._onClose);
  }
  send(method, bsonBuffer) {
    if (this.closed || this.socket.destroyed) throw new Error('VOX TLS 연결이 종료됐습니다.');
    // No hardcoded/login defaults. Authenticated request BODY MUST be supplied
    // by a separately validated, version-matched protocol implementation.
    return this.socket.write(wire.pack(method, bsonBuffer));
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.decoder.reset();
    this.socket.destroy();
  }
}

// Explicit call-only factory. Never install this into hz-new.js or voice-room.js
// until a version-matched VOX LOGIN response contract is verified.
function connectTrustedVox(target, { tlsConnect = tls.connect,
                                     timeoutMs = CONNECT_TIMEOUT_MS } = {}) {
  const info = validateTarget(target);
  if (typeof tlsConnect !== 'function' ||
      !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
    return Promise.reject(new Error('잘못된 VOX 연결 설정입니다.'));
  }
  return new Promise((resolve, reject) => {
    let socket;
    let done = false;
    let timer;
    function fail(message) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket?.removeListener('secureConnect', secure);
      socket?.removeListener('error', error);
      socket?.removeListener('close', earlyClose);
      socket?.destroy();
      reject(new Error(message));
    }
    function error() { fail('VOX TLS 연결 실패'); }
    function earlyClose() { fail('VOX TLS 연결이 인증 전에 종료됐습니다.'); }
    function secure() {
      if (socket.encrypted !== true || socket.authorized !== true) {
        fail('VOX TLS 서버 인증서 검증 실패');
        return;
      }
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.removeListener('secureConnect', secure);
      socket.removeListener('error', error);
      socket.removeListener('close', earlyClose);
      try {
        resolve(new VoxFrameSocket(socket));
      } catch {
        socket.destroy();
        reject(new Error('VOX TLS 세션 초기화 실패'));
      }
    }
    try {
      // No fallback to TLS 1.0, no rejectUnauthorized:false, no guessed SNI.
      socket = tlsConnect({
        host: info.host, port: info.port, servername: info.servername,
        rejectUnauthorized: true, minVersion: 'TLSv1.2',
      });
      socket.once('secureConnect', secure);
      socket.once('error', error);
      socket.once('close', earlyClose);
      timer = setTimeout(() => fail('VOX TLS 연결 제한시간 초과'), timeoutMs);
      timer.unref?.();
    } catch {
      fail('VOX TLS 연결 초기화 실패');
    }
  });
}

module.exports = { DEFAULT_CONTROL_PORT, CONNECT_TIMEOUT_MS, validateTarget,
  connectTrustedVox, VoxFrameSocket };
