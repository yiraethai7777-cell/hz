'use strict';

const {
  createCodec,createVoiceRoom,checkedId,validateTitle,integer,I32,I64,METHODS,
  heartbeatReplySummary,
} = require('./vox30-protocol');

const PING_INTERVAL_MS=5000;

const CREATE_DEFAULT_MIC_ON_OFF=1;
const HEARTBEAT_AUDIO_STATE=0;
function boundedCounter(value,max=100000000){
  return Number.isSafeInteger(value)&&value>=0&&value<=max?value:null;
}
// Own-account and transport-only correlation for server 11009. Never emit
// raw 12011, credentials, participant IDs, SDP or transport addresses.
function sessionTerminationEvidence({elapsedMs,lastPongAgeMs,pingReplies,
  heartbeat,moderator,media,rtp}={}){
  const own=moderator?.ownStates||{};
  const mic=(typeof own.mic==='boolean'||
    (Number.isInteger(own.mic)&&own.mic>=-1&&own.mic<=16))?own.mic:null;
  const states=['connected','connecting','disconnected','failed','closed','new'];
  const connectionState=states.includes(media?.connectionState)?media.connectionState:'unknown';
  const txMode=['opus-silence','external-track','receive-only'].includes(media?.audioTxMode)?
    media.audioTxMode:'unknown';
  const acceptance=['body-resCode-zero','body-resCode-nonzero','unverified']
    .includes(heartbeat?.acceptance)?heartbeat.acceptance:'unverified';
  return {
    elapsedMs:boundedCounter(elapsedMs,3600000),
    lastPongAgeMs:boundedCounter(lastPongAgeMs,3600000),
    pingReplies:boundedCounter(pingReplies,100000),
    heartbeat:{replyReceived:heartbeat?.replyReceived===true,
      headerStatus:boundedCounter(heartbeat?.headerStatus,65535),
      resCodePresent:heartbeat?.resCodePresent===true,acceptance,
      ...(Number.isSafeInteger(heartbeat?.resCode)&&Math.abs(heartbeat.resCode)<100000
        ?{resCode:heartbeat.resCode}:{})},
    moderator:{own:moderator?.own==='present'?'present':
        moderator?.own==='not_observed'?'not_observed':'unknown',mic},
    declared:{createDefaultMicOnOff:CREATE_DEFAULT_MIC_ON_OFF,
      heartbeatAudioState:HEARTBEAT_AUDIO_STATE},
    media:{connectionState,audioTxMode:txMode,audioTxFailed:media?.audioTxFailed===true},
    rtp:{available:rtp?.available===true,
      outboundPackets:boundedCounter(rtp?.outboundPackets),
      outboundBytes:boundedCounter(rtp?.outboundBytes),
      inboundPackets:boundedCounter(rtp?.inboundPackets)},
  };
}


// Adapter for the existing #보룸시작 command.
function createVox30Adapter({
  actorUserId,cfg,entryHost,entryPort=9282,codec,
  credentialsForRoom,rtcFactory,verifyMembership,connect,transport,appVer,userTypeForRoom=()=>1,
}={}) {
  const userId=checkedId(actorUserId);
  if(String(cfg?.userId??'')!==userId)
    throw Error('VOX 인증 계정과 실행 계정이 다릅니다.');
  if(!entryHost || typeof credentialsForRoom!=='function' ||
      typeof rtcFactory!=='function' || typeof verifyMembership!=='function')
    throw Error('VOX 인증·채팅방 참여·WebRTC 구현체가 필요합니다.');
  if(!codec?.frame || !codec?.parse)
    throw Error('VOX 암호화/BSON codec이 필요합니다.');
  let active=null;
  let running=false;
  async function release(current) {
    if(active!==current)return;
    active=null;
    clearInterval(current.timer);
    current.session.conn.close();
    try{await current.peer.close();}catch{}
    console.info('[VOICE VOX30] local voice session released');
  }
  function startKeepalive(current) {
    const {conn,callId,csId}=current.session;
    // The Android 26.9.2 VOX serializer includes the user, device and media
    // state. This receive-only peer has no outgoing video, filter or recording.
    const pingBody={
      userId:new I64(userId),
      ...(csId==null?{}:{csId:new I64(checkedId(csId))}),
      ...(callId==null?{}:{callId:new I64(checkedId(callId))}),
      devType:new I32(4),
      voiceFilter:new I32(0),
      audioState:new I32(0),
      videoState:new I32(0),
      recInfo:{
        recSessionId:new I64('0'),
        recordCount:new I32(0),
        recordDuration:new I64('0'),
        recordIds:[],
      },
    };
    let waiting=false;
    const tick=async()=>{
      if(active!==current || waiting)return;
      const mediaState=current.peer.getState?.()||{};
      const media=mediaState.connectionState??'unknown';
      if(media==='failed'||media==='closed'){
        await release(current);
        return;
      }
      waiting=true;
      let pong;
      try{
        pong=conn.wait(METHODS.PING);
        await conn.send(METHODS.PING,pingBody);
        console.info('[VOICE VOX30] 11015 sent; media='+
          media+' txMode='+(mediaState.audioTxMode??'unknown')+
          ' txPackets='+(Number.isSafeInteger(mediaState.audioTxPackets)?mediaState.audioTxPackets:0)+
          ' txFailed='+(mediaState.audioTxFailed===true));
      }catch{
        pong?.cancel();
        await release(current);
        return;
      }finally{
        if(!pong)waiting=false;
      }
      try{
        const packet=await pong.promise;
        const evidence=heartbeatReplySummary(packet);
        if(active===current){
          current.lastHeartbeatEvidence=evidence;
          current.lastHeartbeatReplyAt=Date.now();
          current.pingReplies=(current.pingReplies||0)+1;
        }
        // An absent BSON resCode is not a verified server acknowledgement,
        // even if the 11015 response's packet header status is 0.
        console.info('[VOICE VOX30] 11015 reply evidence '+
          JSON.stringify(evidence));
        if(active===current && typeof current.peer.getRtpStats==='function'){
          try{
            const stats=await current.peer.getRtpStats();
            if(active===current){
              current.lastRtpStats=stats;
              console.info('[VOICE VOX30] RTP transport stats '+
                JSON.stringify(stats));
            }
          }catch{}
        }
      }catch{
        if(active===current)console.info('[VOICE VOX30] 11015 reply not observed');
      }finally{waiting=false;}
    };
    // Send the initial heartbeat as soon as the WebRTC answer is applied;
    // waiting a whole interval can miss a short server session deadline.
    console.info('[VOICE VOX30] PING interval='+PING_INTERVAL_MS+
      'ms; declared audioState=0 videoState=0; '+
      'media state may differ from VOX moderator mic state');
    current.timer=setInterval(()=>{void tick();},PING_INTERVAL_MS);
    current.timer.unref();
    conn.whenClosed?.then(()=>release(current));
    void tick();
  }
  return {
    kind:'vox30-direct-experimental',
    async status({roomId}={}) {
      const id=checkedId(roomId);
      return {
        roomId:id,verified:false,statusKnown:false,
        localSession:true,localActive:active?.chatId===id,
        ...(active&&active.chatId!==id?{localBusyOtherRoom:true}:{}),
      };
    },
    async create({roomId,title}={}) {
      const chatId=checkedId(roomId),name=validateTitle(title);
      if(running)throw Error('다른 VOX 생성 요청을 처리 중입니다.');
      if(active)throw Error('VOX 계정에 이미 활성 음성 세션이 있습니다.');
      running=true;
      let peer=null,session=null;
      let observedModerator=null;
      try {
        if(await verifyMembership({actorUserId:userId,chatId})!==true)
          throw Error('VOX 실행 계정의 오픈채팅 참여를 확인할 수 없습니다.');
        const credentials=await credentialsForRoom({actorUserId:userId,chatId});
        if(!credentials || typeof credentials.oauthToken!=='string' ||
            typeof credentials.deviceUuid!=='string')
          throw Error('VOX 계정 토큰 또는 기기 UUID가 없습니다.');
        peer=await rtcFactory({actorUserId:userId,chatId,title:name});
        if(!peer || typeof peer.createOffer!=='function' ||
            typeof peer.applyAnswer!=='function' || typeof peer.close!=='function')
          throw Error('실제 WebRTC PeerConnection 구현이 필요합니다.');
        const sdp=await peer.createOffer();
        session=await createVoiceRoom({
          cfg,chatId,title:name,
          oauthToken:credentials.oauthToken,deviceUuid:credentials.deviceUuid,
          sdp,userType:userTypeForRoom({chatId}),entryHost,entryPort,codec,appVer,...(connect?{connect}:{}),
          // Handle the server's terminal event immediately, without waiting
          // for the TCP socket to close or continuing to ping a dead call.
          transport:{
            ...transport,
            diagnosticActorUserId:userId,
            onPacket(packet) {
              transport?.onPacket?.(packet);
              if(packet?.method===12011 && packet?.memberGroups?.moderators){
                // Own member states only: the server's moderator roster is
                // already sanitized before this callback is invoked.
                observedModerator=packet.memberGroups.moderators;
                if(active?.chatId===chatId)active.lastModerator=observedModerator;
              }
              if(packet?.method===11009 && active?.chatId===chatId) {
                const current=active;
                console.info('[VOICE VOX30] server terminal; latest RTP stats '+
                  JSON.stringify(current.lastRtpStats??{available:false})+
                  '; last heartbeat='+JSON.stringify(
                    current.lastHeartbeatEvidence??{replyReceived:false}));
                let media={};
                try{media=current.peer.getState?.()||{};}catch{}
                const now=Date.now();
                console.info('[VOICE VOX30] LOCO lifecycle at termination '+
                  JSON.stringify(require('./voice-room-auto-detect')
                    .callCorrelation(chatId,current.session.callId)));
                console.info('[VOICE VOX30] server termination correlation '+
                  JSON.stringify(sessionTerminationEvidence({
                    elapsedMs:now-current.createdAt,
                    lastPongAgeMs:current.lastHeartbeatReplyAt==null?null:
                      now-current.lastHeartbeatReplyAt,
                    pingReplies:current.pingReplies||0,
                    heartbeat:current.lastHeartbeatEvidence,
                    moderator:current.lastModerator,
                    media,rtp:current.lastRtpStats,
                  })));
                // The server already ended the call. Never keep a phantom
                // local session alive or automatically recreate voice rooms.
                void release(current);
              }
            },
          },
        });
        await peer.applyAnswer(session.remoteSdp);
        active={chatId,session,peer,timer:null,
          createdAt:Date.now(),pingReplies:0,lastModerator:observedModerator};
        startKeepalive(active);
        return {requestAccepted:true,verified:false,
          callId:session.callId==null?null:checkedId(session.callId)};
      }catch(e){
        if(session && active?.session===session)await release(active);
        else {
          session?.conn.close();
          if(peer)await Promise.resolve(peer.close()).catch(()=>{});
        }
        throw e;
      }finally{running=false;}
    },
    // Local release only. It is NOT the KakaoTalk server's room termination.
    async dispose() {
      if(active)await release(active);
    },
  };
}

module.exports={createVox30Adapter,createCodec,sessionTerminationEvidence};
