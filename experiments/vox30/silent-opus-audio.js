'use strict';

// Experimental, non-audible Opus TX path for direct VOX signalling.
// RFC 7587 uses a 48 kHz RTP clock; this known Opus silence frame is
// independent of copyrighted audio and carries no voice content.
// A successful writeRtp is NOT proof that the Kakao server accepted audio.
const { randomBytes } = require('node:crypto');
const { MediaStreamTrack, RtpHeader, RtpPacket } = require('werift');

const FRAME_MS = 20;
const TICKS_PER_FRAME = 960;
const SILENCE_OPUS = Buffer.from([0xf8, 0xff, 0xfe]);

function createSilentOpusSource({
  Track = MediaStreamTrack, Header = RtpHeader, Packet = RtpPacket,
  setIntervalFn = setInterval, clearIntervalFn = clearInterval,
  randomBytesFn = randomBytes,
} = {}) {
  const track = new Track({ kind: 'audio' });
  if (typeof track.writeRtp !== 'function' || typeof track.stop !== 'function')
    throw Error('Opus 송신용 MediaStreamTrack 구현이 필요합니다.');
  const entropy = randomBytesFn(10);
  if (!Buffer.isBuffer(entropy) || entropy.length !== 10)
    throw Error('RTP 무작위 초기값 생성 오류');
  let sequenceNumber = entropy.readUInt16BE(0);
  let timestamp = entropy.readUInt32BE(2);
  const ssrc = entropy.readUInt32BE(6);
  let timer = null;
  let started = false;
  let stopped = false;
  let sentPackets = 0;
  let failed = false;
  let connectionReady = () => false;

  function sendIfConnected() {
    if (stopped || failed || !connectionReady()) return;
    try {
      const packet = new Packet(new Header({
        payloadType: 111, // werift replaces this with the negotiated Opus PT.
        sequenceNumber, timestamp, ssrc, marker: sentPackets === 0,
      }), Buffer.from(SILENCE_OPUS));
      track.writeRtp(packet);
      sequenceNumber = (sequenceNumber + 1) & 0xffff;
      timestamp = (timestamp + TICKS_PER_FRAME) >>> 0;
      sentPackets++;
    } catch {
      // Avoid crashing the live KakaoTalk bot from an experimental RTP task.
      failed = true;
      if (timer !== null) clearIntervalFn(timer);
      timer = null;
    }
  }

  function start(isConnected) {
    if (started || stopped || typeof isConnected !== 'function')
      throw Error('Opus 송신 시작 상태 오류');
    started = true;
    connectionReady = isConnected;
    timer = setIntervalFn(sendIfConnected, FRAME_MS);
    timer?.unref?.();
    sendIfConnected();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer !== null) clearIntervalFn(timer);
    timer = null;
    track.stop();
  }

  return Object.freeze({
    track, start, stop,
    getState() {
      return { started, stopped, failed, sentPackets };
    },
  });
}

module.exports = { createSilentOpusSource, FRAME_MS, TICKS_PER_FRAME, SILENCE_OPUS };
