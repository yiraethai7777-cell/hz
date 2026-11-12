'use strict';

const {RTCPeerConnection}=require('werift');
const {createSilentOpusSource}=require('./silent-opus-audio');

const DEFAULT_ICE_TIMEOUT_MS=15000;

function unwrapAnswer(value) {
  const sdp=typeof value==='string'?value:
    (typeof value?.sdp==='string'?value.sdp:null);
  if(!sdp || !sdp.startsWith('v=0') || !sdp.includes('m=audio ') ||
     sdp.length>128*1024)
    throw Error('VOX 원격 WebRTC audio SDP answer 형식 오류');
  return {type:'answer',sdp};
}

function waitIceGathering(peer,ms=DEFAULT_ICE_TIMEOUT_MS) {
  if(peer.iceGatheringState==='complete')return Promise.resolve();
  let cleanup=()=>{};
  return new Promise((resolve,reject)=>{
    let settled=false;
    const done=error=>{
      if(settled)return;
      settled=true;cleanup();
      if(error)reject(error);else resolve();
    };
    const onChange=()=>{
      if(peer.iceGatheringState==='complete')done();
      else if(peer.signalingState==='closed')done(Error('WebRTC 세션이 종료됐습니다.'));
    };
    const timer=setTimeout(()=>done(Error('WebRTC ICE 후보 수집 시간 초과')),ms);
    let off=()=>{};
    if(typeof peer.addEventListener==='function'){
      peer.addEventListener('icegatheringstatechange',onChange);
      off=()=>peer.removeEventListener?.('icegatheringstatechange',onChange);
    }else if(typeof peer.onIceGatheringStateChange?.subscribe==='function'){
      const sub=peer.onIceGatheringStateChange.subscribe(onChange);
      off=()=>sub?.unsubscribe?.();
    }else{
      clearTimeout(timer);
      reject(Error('WebRTC ICE 수집 이벤트를 구독할 수 없습니다.'));
      return;
    }
    cleanup=()=>{clearTimeout(timer);off();};
    onChange();
  });
}

function createWebRtcPeer({
  PeerConnection=RTCPeerConnection,rtcConfig={},iceTimeoutMs=DEFAULT_ICE_TIMEOUT_MS,
  outgoingAudioTrack=null,silentAudio=false,silentAudioFactory=createSilentOpusSource,
}={}) {
  if(typeof PeerConnection!=='function')
    throw Error('WebRTC RTCPeerConnection 구현이 필요합니다.');
  if(!Number.isInteger(iceTimeoutMs)||iceTimeoutMs<100||iceTimeoutMs>60000)
    throw Error('WebRTC ICE 제한 시간 설정 오류');
  const pc=new PeerConnection(rtcConfig);
  if(typeof pc.addTransceiver!=='function' || typeof pc.createOffer!=='function' ||
     typeof pc.setLocalDescription!=='function'||typeof pc.setRemoteDescription!=='function'||
     typeof pc.close!=='function'){
    pc.close?.();
    throw Error('WebRTC 필수 메서드가 누락됐습니다.');
  }
  if(outgoingAudioTrack && silentAudio){
    pc.close();throw Error('외부 오디오 트랙과 무음 RTP 테스트를 동시에 지정할 수 없습니다.');
  }
  const silence=silentAudio ? silentAudioFactory() : null;
  if(silence){
    if(silence.track?.kind!=='audio' || typeof silence.start!=='function' ||
       typeof silence.stop!=='function' || typeof silence.getState!=='function'){
      pc.close();throw Error('무음 Opus 송신 소스 형식 오류');
    }
    // Use one negotiated bidirectional audio m-line, not an extra sendonly
    // line that the Kakao VOX answer may not recognize.
    pc.addTransceiver(silence.track,{direction:'sendrecv'});
  }else if(outgoingAudioTrack){
    if(outgoingAudioTrack.kind!=='audio' || typeof pc.addTrack!=='function'){
      pc.close();throw Error('WebRTC 오디오 트랙 입력 오류');
    }
    pc.addTrack(outgoingAudioTrack);
  }else{
    // Receive-only audio is intentional; it does NOT fake a microphone source.
    pc.addTransceiver('audio',{direction:'recvonly'});
  }
  let offerMade=false,answered=false,closed=false;
  return {
    async createOffer() {
      if(offerMade||closed)throw Error('WebRTC SDP offer 중복 요청');
      offerMade=true;
      const offer=await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIceGathering(pc,iceTimeoutMs);
      const sdp=pc.localDescription?.sdp;
      if(typeof sdp!=='string'||!sdp.startsWith('v=0')||!sdp.includes('m=audio '))
        throw Error('WebRTC audio SDP 생성 실패');
      return sdp;
    },
    async applyAnswer(remote) {
      if(!offerMade||answered||closed)throw Error('WebRTC answer 적용 순서 오류');
      const answer=unwrapAnswer(remote);
      await pc.setRemoteDescription(answer);
      answered=true;
      // Do not emit RTP until the local DTLS/ICE connection is fully connected.
      // This diagnostic source can later be replaced by a licensed audio source.
      silence?.start(()=>pc.connectionState==='connected');
      // Setting SDP alone does not prove ICE/DTLS or remote room creation.
      return {answerApplied:true,connectionState:pc.connectionState??'unknown'};
    },
    getState() {
      return {iceConnectionState:pc.iceConnectionState??'unknown',
        connectionState:pc.connectionState??'unknown',answered,closed,
        audioTxMode:silence?'opus-silence':outgoingAudioTrack?'external-track':'receive-only',
        audioTxPackets:silence?.getState().sentPackets??0,
        audioTxFailed:silence?.getState().failed??false};
    },
    async getRtpStats() {
      // A local writeRtp() call does not mean that RTP was actually sent.
      // Werift's outbound-rtp statistics provide a stronger, still local,
      // transport-level signal. No peer addresses, SDP or SSRC are logged.
      if(typeof pc.getStats!=='function')
        return {available:false};
      try {
        const report=await pc.getStats();
        const values=report instanceof Map?report.values():
          Array.isArray(report)?report:Object.values(report||{});
        let outboundPackets=0,outboundBytes=0,inboundPackets=0;
        let outboundStreams=0,inboundStreams=0;
        for(const stat of values){
          if(!stat || typeof stat!=='object')continue;
          const type=stat.type;
          if(type!=='outbound-rtp' && type!=='inbound-rtp')continue;
          const kind=stat.kind??stat.mediaType;
          if(kind!==undefined && kind!=='audio')continue;
          if(type==='outbound-rtp'){
            outboundStreams++;
            if(Number.isSafeInteger(stat.packetsSent)&&stat.packetsSent>=0)
              outboundPackets+=stat.packetsSent;
            if(Number.isSafeInteger(stat.bytesSent)&&stat.bytesSent>=0)
              outboundBytes+=stat.bytesSent;
          }else{
            inboundStreams++;
            if(Number.isSafeInteger(stat.packetsReceived)&&stat.packetsReceived>=0)
              inboundPackets+=stat.packetsReceived;
          }
        }
        return {available:true,outboundStreams,outboundPackets,
          outboundBytes,inboundStreams,inboundPackets};
      }catch {
        return {available:false,failed:true};
      }
    },
    async close() {
      if(closed)return;
      closed=true;
      silence?.stop();
      pc.close();
    },
  };
}

module.exports={createWebRtcPeer,unwrapAnswer,waitIceGathering};
