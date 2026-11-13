'use strict';

const {
  createCodec,createVoiceRoom,joinVoiceRoomTrial,checkedId,validateTitle,integer,I32,I64,METHODS,
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
  heartbeat,moderator,media,rtp,createTiming}={}){
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
    media:{connectionState,
      iceConnectionState:['new','checking','connected','completed','disconnected','failed','closed']
        .includes(media?.iceConnectionState)?media.iceConnectionState:'unknown',
      audioTxMode:txMode,audioTxFailed:media?.audioTxFailed===true},
    rtp:{available:rtp?.available===true,
      outboundPackets:boundedCounter(rtp?.outboundPackets),
      outboundBytes:boundedCounter(rtp?.outboundBytes),
      inboundPackets:boundedCounter(rtp?.inboundPackets),
      remoteInboundReports:boundedCounter(rtp?.remoteInboundReports,256),
      networkObserved:rtp?.network?.selectedPairObserved===true,
      selectedPairState:['succeeded','in-progress','waiting','frozen','failed','cancelled']
        .includes(rtp?.network?.selectedPairState)?rtp.network.selectedPairState:'unknown',
      transportBytesReceived:boundedCounter(rtp?.network?.transportBytesReceived,1000000000000),
      selectedPairResponsesReceived:boundedCounter(rtp?.network?.selectedPairResponsesReceived,1000000000000)},
    serverTimers:{
      createInterval:boundedCounter(createTiming?.interval,3600000),
      createConnTimeout:boundedCounter(createTiming?.connTimeout,3600000),
      createRespTimeout:boundedCounter(createTiming?.respTimeout,3600000),
      pingInterval:boundedCounter(heartbeat?.serverTiming?.interval,3600000),
      pingConnTimeout:boundedCounter(heartbeat?.serverTiming?.connTimeout,3600000),
      pingRespTimeout:boundedCounter(heartbeat?.serverTiming?.respTimeout,3600000),
      configuredPingIntervalMs:PING_INTERVAL_MS,
      serverTimerUnitsVerified:false,
    },
  };
}


// Adapter for the existing #보룸시작 command.
function createVox30Adapter({
  actorUserId,cfg,entryHost,entryPort=9282,codec,
  credentialsForRoom,rtcFactory,verifyMembership,connect,transport,appVer,userTypeForRoom=()=>1,
  // Only version-matched, independently verified drivers may be supplied.
  joinTransport=null,acceptSpeakerTransport=null,acceptModeratorTransport=null,
  experimentalJoin=false,
  // A version-matched, independently verified wire implementation is required.
  // No production hangup driver exists yet; unknown method numbers MUST NOT be sent.
  hangupTransport=null,
  // Explicitly opt-in diagnostic only: NOT a verified server-side hangup.
  unsafeStopExperiment=false,
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
  const canServerHangup=hangupTransport?.verified===true&&
    hangupTransport.appVer===appVer&&
    typeof hangupTransport.hangUp==='function';
  const {ownRole}=require('./vox30-role-state');
  // This is deliberately NOT claimed as a verified join implementation.
  // The 11002 BSON trial only runs with an explicit environment opt-in.
  const joinDriver=joinTransport || (experimentalJoin===true?
    async({roomId,actorUserId,invitation})=>{
      if(active||!invitation)throw Error('VOX 참가 대상 세션이 없습니다.');
      let peer=null,session=null;
      try{
        peer=await rtcFactory({actorUserId,chatId:roomId,role:'listener'});
        if(!peer||typeof peer.createOffer!=='function'||
           typeof peer.applyAnswer!=='function'||typeof peer.close!=='function')
          throw Error('VOX WebRTC 오디오 참가 연결이 없습니다.');
        const offer=await peer.createOffer();
        session=await joinVoiceRoomTrial({
          cfg,chatId:roomId,callId:invitation.callId,invitation,
          ...((await credentialsForRoom({actorUserId,chatId:roomId}))||{}),
          sdp:offer,appVer,entryHost,entryPort,codec,
          userType:userTypeForRoom({chatId:roomId}),...(connect?{connect}:{}),
          transport:{
            ...transport,diagnosticActorUserId:userId,
            onPacket(packet) {
              transport?.onPacket?.(packet);
              if(active?.chatId!==roomId)return;
              if(packet?.method===12011){
                const role=ownRole(packet);
                if(role)active.lastOwnRole=role;
                participant.onRoster(packet,{roomId,callId:active.session.callId});
              }
              if(packet?.method===11009&&
                 Number.isSafeInteger(packet?.codes?.reason)){
                void release(active);
              }
            },
            onAuthenticatedRoleInvitation(info) {
              if(active?.chatId!==roomId||
                 String(active.session?.callId)!==info.callId)return;
              void participant.receiveAuthenticatedInvitation({
                ...info,roomId,
              }).catch(()=>{});
            },
          },
        });
        await peer.applyAnswer(session.remoteSdp);
        if(active)throw Error('다른 보이스룸이 이미 활성화되어 있습니다.');
        const current={chatId:roomId,session,peer,timer:null,
          createdAt:Date.now(),pingReplies:0,joinedExisting:true};
        active=current;
        participant.activate({roomId,callId:session.callId});
        startKeepalive(current);
        console.info('[VOICE VOX30] experimental join login accepted; roster/media unverified');
        return {requestAccepted:true,verified:false};
      }catch(err){
        try{session?.conn.close();}catch{}
        try{await peer?.close();}catch{}
        throw err;
      }
    }:null);
  const participant=require('./vox30-participation').createParticipationController({
    actorUserId:userId,joinTransport:joinDriver,
    acceptSpeakerTransport,acceptModeratorTransport,
  });
  async function release(current,{graceful=false}={}) {
    if(active!==current)return;
    active=null;
    participant.release();
    clearInterval(current.timer);
    if(graceful&&typeof current.session.conn.closeGracefully==='function') {
      try{await current.session.conn.closeGracefully();}
      catch{current.session.conn.close();}
    }else{
      current.session.conn.close();
    }
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
      const same=active?.chatId===id;
      return {
        roomId:id,verified:false,statusKnown:false,
        localSession:true,localActive:same,stopAvailable:canServerHangup,
        unsafeStopExperimentAvailable:unsafeStopExperiment===true && same,
        ...(same&&active?.session?.callId!=null
          ?{localCallId:checkedId(active.session.callId)}:{}),
        ...((()=>{
          const info=participant.status(id);
          return {joinAvailable:info.joinAvailable,
            joinTrialAvailable:experimentalJoin===true,
            speakerAutoAcceptAvailable:info.speakerAutoAcceptAvailable,
            moderatorAutoAcceptAvailable:info.moderatorAutoAcceptAvailable,
            pendingRoles:info.pendingRoles,invitedRoles:info.invitedRoles};
        })()),
        ...(same&&active.lastOwnRole?{
          role:active.lastOwnRole.role,roleSource:active.lastOwnRole.source,
          mic:active.lastOwnRole.mic,
        }:{}),
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
      let observedOwnRole=null;
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
            onAuthenticatedRoleInvitation(info) {
              // Trust only a matched actor + same active VOX call. Never
              // authorize invitations copied from chat attachments.
              if(active?.chatId!==chatId || 
                 String(active.session?.callId)!==info.callId)return;
              void participant.receiveAuthenticatedInvitation({
                ...info,roomId:chatId,
              }).then(result=>{
                if(result?.pending)console.info('[VOICE VOX30] verified role invitation stored; acceptance wire unavailable');
                if(result?.awaitingRoster)console.info('[VOICE VOX30] role acceptance requested; waiting for own roster');
              }).catch(()=>{});
            },
            onPacket(packet) {
              transport?.onPacket?.(packet);
              if(packet?.method===12011){
                if(active?.chatId===chatId && active.session?.callId)
                  participant.onRoster(packet,{roomId:chatId,callId:active.session.callId});
                const role=ownRole(packet);
                if(role){
                  observedOwnRole=role;
                  if(active?.chatId===chatId)active.lastOwnRole=role;
                }
              }
              if(packet?.method===12011 && packet?.memberGroups?.moderators){
                // Own member states only: the server's moderator roster is
                // already sanitized before this callback is invoked.
                observedModerator=packet.memberGroups.moderators;
                if(active?.chatId===chatId)active.lastModerator=observedModerator;
              }
              if(packet?.method===11009 &&
                  Number.isSafeInteger(packet?.codes?.reason) &&
                  active?.chatId===chatId) {
                const current=active;
                console.info('[VOICE VOX30] server terminal; latest RTP stats '+
                  JSON.stringify(current.lastRtpStats??{available:false})+
                  '; last heartbeat='+JSON.stringify(
                    current.lastHeartbeatEvidence??{replyReceived:false}));
                let media={};
                try{media=current.peer.getState?.()||{};}catch{}
                const now=Date.now();
                console.info('[VOICE VOX30] signaling validation at termination '+
                  JSON.stringify(current.session.signaling??{replyVerified:false}));
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
                    createTiming:current.session.serverTiming,
                  })));
                // The server already ended the call. Never keep a phantom
                // local session alive or automatically recreate voice rooms.
                void release(current);
              }
            },
          },
        });
        await peer.applyAnswer(session.remoteSdp);
        // 11003 packet reception is distinct from the 11028 acceptance.
        // These counters are not proof of server-side media activation.
        console.info('[VOICE VOX30] 11003/11028 signaling validation '+
          JSON.stringify(session.signaling??{replyVerified:false}));
        console.info('[VOICE VOX30] 11028 server timer fields '+
          JSON.stringify(session.serverTiming??{notProvided:true})+
          '; unit interpretation unverified');
        active={chatId,session,peer,timer:null,
          createdAt:Date.now(),pingReplies:0,lastModerator:observedModerator,
          lastOwnRole:observedOwnRole};
        if(session.callId!=null){
          participant.activate({roomId:chatId,callId:session.callId});
        }
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
    // Only a real, version-matched VOX hangup implementation may request
    // server termination. TLS FIN, 11009 server events and old 10004 examples
    // are not client hangup evidence. Keep RTP/PING active until the server
    // ends the call; callers verify same-call LOCO vr_bye before claiming success.
    async stop({roomId,voiceRoomId}={}) {
      const id=checkedId(roomId);
      const current=active;
      if(!current||current.chatId!==id)
        return {roomId:id,closed:false,verified:false,
          localReleased:false,serverStopUnavailable:true};
      const callId=checkedId(current.session.callId);
      if(voiceRoomId!=null&&checkedId(voiceRoomId)!==callId)
        throw Error('다른 보이스룸 통화 ID로 종료할 수 없습니다.');
      if(!canServerHangup){
        console.warn('[VOICE VOX30] verified hangUp wire unavailable; retained creator session');
        return {roomId:id,closed:false,verified:false,
          localReleased:false,serverStopUnavailable:true};
      }
      if(running)throw Error('다른 VOX 요청을 처리 중입니다.');
      running=true;
      try {
        const ack=await hangupTransport.hangUp({
          roomId:id,callId,
          csId:current.session.csId==null?null:checkedId(current.session.csId),
          actorUserId:userId,connection:current.session.conn,
        });
        const requestAccepted=active===current && ack?.requestAccepted===true;
        // An ACK (or a successful send) cannot establish room termination.
        // Only an independently received matching vr_bye can confirm it.
        return {roomId:id,requestAccepted,closed:false,verified:false,
          localReleased:false,serverStopUnavailable:false};
      }finally {running=false;}
    },
    // Experiment ONLY: the server's 11009 notification is not a documented
    // client request; a guessed minimal BSON envelope may be ignored/rejected.
    // Force-disconnect releases only THIS ROOM's VOX TLS/WebRTC, not KakaoForge.
    async experimentalStop({roomId,mode}={}) {
      const id=checkedId(roomId);
      if(unsafeStopExperiment!==true)
        return {roomId:id,disabled:true,serverEnded:false};
      if(!['11009','disconnect'].includes(mode))
        throw Error('허용되지 않은 VOX 종료 실험 방식입니다.');
      const current=active;
      if(!current||current.chatId!==id)
        return {roomId:id,noLocalSession:true,serverEnded:false};
      if(running)throw Error('다른 VOX 요청을 처리 중입니다.');
      running=true;
      try{
        if(mode==='11009'){
          if(current.sent11009Experiment===true)
            return {roomId:id,alreadyTried:true,serverEnded:false};
          current.sent11009Experiment=true;
          const callId=checkedId(current.session.callId);
          const body={
            userId:new I64(userId),
            callId:new I64(callId),
            ...(current.session.csId==null?{}:{
              csId:new I64(checkedId(current.session.csId))
            }),
            reason:new I32(0),
          };
          // Number and body schema are unverified. One attempt per live call.
          try{
            await current.session.conn.send(11009,body);
            console.warn('[VOICE VOX30] experimental outgoing method=11009, server result unverified');
            return {roomId:id,packetSent:true,localReleased:false,serverEnded:false};
          }catch{
            console.warn('[VOICE VOX30] experimental 11009 send failed');
            return {roomId:id,packetSent:false,localReleased:false,serverEnded:false};
          }
        }
        await release(current);
        console.warn('[VOICE VOX30] experimental local VOX disconnect; Kakao room not verified closed');
        return {roomId:id,packetSent:false,localReleased:true,serverEnded:false};
      }finally{
        running=false;
      }
    },
    async join({roomId,botUserId}={}) {
      const id=checkedId(roomId);
      if(botUserId!=null&&checkedId(botUserId)!==userId)
        throw Error('VOX 참가 계정이 Railway 봇과 다릅니다.');
      if(active||running)throw Error('VOX 음성 세션이 이미 활성화되어 있거나 처리 중입니다.');
      if(await verifyMembership({actorUserId:userId,chatId:id})!==true)
        throw Error('VOX 오픈채팅 참여 정보를 확인할 수 없습니다.');
      // An invite is an untrusted locator, NOT proof of VOX login.
      const invitation=require('./voice-room-join-info').resolve(id);
      running=true;
      try{return await participant.join({roomId:id,invitation});}
      finally{running=false;}
    },
    // To be called ONLY after a verified decoder supplies an exact bot-targeted
    // server invitation on the active authenticated call connection.
    async receiveAuthenticatedRoleInvitation(info) {
      return participant.receiveAuthenticatedInvitation(info);
    },
    // Manual role acceptance requires a matching invitation from the
    // authenticated VOX TLS session; arbitrary user-entered roles are ignored.
    async acceptRole({roomId,role}={}) {
      return participant.acceptRole({roomId,role});
    },
    // Local release only. It is NOT the KakaoTalk server's room termination.
    async dispose() {
      if(active)await release(active);
    },
  };
}

module.exports={createVox30Adapter,createCodec,sessionTerminationEvidence};
