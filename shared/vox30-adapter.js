'use strict';

const {
  createCodec,createVoiceRoom,checkedId,validateTitle,integer,I32,I64,METHODS,
} = require('./vox30-protocol');

const PING_INTERVAL_MS=15000;

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
    current.timer=setInterval(async()=>{
      if(active!==current || waiting)return;
      const media=current.peer.getState?.().connectionState??'unknown';
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
          media);
      }catch{
        pong?.cancel();
        await release(current);
        return;
      }finally{
        if(!pong)waiting=false;
      }
      try{
        const packet=await pong.promise;
        const code=integer(packet.body.resCode??packet.status??0);
        console.info('[VOICE VOX30] 11015 reply status='+code);
      }catch{
        if(active===current)console.info('[VOICE VOX30] 11015 reply not observed');
      }finally{waiting=false;}
    },PING_INTERVAL_MS);
    current.timer.unref();
    conn.whenClosed?.then(()=>release(current));
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
          ...(transport?{transport}:{}),
        });
        await peer.applyAnswer(session.remoteSdp);
        active={chatId,session,peer,timer:null};
        startKeepalive(active);
        return {requestAccepted:true,verified:false};
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

module.exports={createVox30Adapter,createCodec};
