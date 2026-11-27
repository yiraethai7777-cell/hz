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
      // Audio RTP sent locally is not proof that the server received it.
      // Candidate-pair, transport and RTCP stats provide separate evidence.
      // Strictly whitelist numerical counters and enum states: no SDP, ICE
      // candidates, remote addresses, SSRCs or report IDs may reach logs.
      if(typeof pc.getStats!=='function')return {available:false};
      const metric=value=>Number.isSafeInteger(value)&&value>=0&&
        value<=1000000000000?value:null;
      try {
        const report=await pc.getStats();
        const values=report instanceof Map?report.values():
          Array.isArray(report)?report:Object.values(report||{});
        let outboundPackets=0,outboundBytes=0,inboundPackets=0;
        let outboundStreams=0,inboundStreams=0;
        let transportReports=0,transportBytesSent=0,transportBytesReceived=0;
        let hasTransportSent=false,hasTransportReceived=false;
        let remoteInboundReports=0;
        const pairs=[];
        let selectedCandidatePairId=null;
        for(const stat of values){
          if(!stat||typeof stat!=='object')continue;
          const type=stat.type;
          if(type==='outbound-rtp'||type==='inbound-rtp'){
            const kind=stat.kind??stat.mediaType;
            if(kind!==undefined&&kind!=='audio')continue;
            if(type==='outbound-rtp'){
              outboundStreams++;
              if(metric(stat.packetsSent)!==null)outboundPackets+=stat.packetsSent;
              if(metric(stat.bytesSent)!==null)outboundBytes+=stat.bytesSent;
            }else{
              inboundStreams++;
              if(metric(stat.packetsReceived)!==null)inboundPackets+=stat.packetsReceived;
            }
          }else if(type==='remote-inbound-rtp'){
            // Usually derived from remote RTCP Receiver Reports, if werift
            // exposes the category. Missing stats are inconclusive.
            if(stat.kind===undefined||stat.kind==='audio')remoteInboundReports++;
          }else if(type==='transport'){
            transportReports++;
            if(metric(stat.bytesSent)!==null){
              hasTransportSent=true;transportBytesSent+=stat.bytesSent;
            }
            if(metric(stat.bytesReceived)!==null){
              hasTransportReceived=true;transportBytesReceived+=stat.bytesReceived;
            }
            if(typeof stat.selectedCandidatePairId==='string'&&
               stat.selectedCandidatePairId.length<256)
              selectedCandidatePairId=stat.selectedCandidatePairId;
          }else if(type==='candidate-pair'&&pairs.length<256){
            pairs.push(stat);
          }
        }
        const result={available:true,outboundStreams,outboundPackets,
          outboundBytes,inboundStreams,inboundPackets,
          remoteInboundReports:Math.min(remoteInboundReports,256)};
        if(transportReports||pairs.length){
          const selected=pairs.find(pair=>
            typeof pair.id==='string'&&pair.id===selectedCandidatePairId)||
            pairs.find(pair=>pair.nominated===true&&pair.state==='succeeded')||
            pairs.find(pair=>pair.selected===true);
          const network={
            transportReports:Math.min(transportReports,256),
            candidatePairReports:pairs.length,
            selectedPairObserved:!!selected,
          };
          if(hasTransportSent&&metric(transportBytesSent)!==null)
            network.transportBytesSent=transportBytesSent;
          if(hasTransportReceived&&metric(transportBytesReceived)!==null)
            network.transportBytesReceived=transportBytesReceived;
          if(selected){
            const known=['succeeded','in-progress','waiting','frozen','failed','cancelled'];
            network.selectedPairState=known.includes(selected.state)?
              selected.state:'unknown';
            if(typeof selected.nominated==='boolean')
              network.selectedPairNominated=selected.nominated;
            for(const key of ['bytesSent','bytesReceived','responsesReceived',
                'requestsSent','consentRequestsSent']){
              const value=metric(selected[key]);
              if(value!==null)network['selectedPair'+key[0].toUpperCase()+key.slice(1)]=value;
            }
          }
          result.network=network;
        }
        return result;
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
