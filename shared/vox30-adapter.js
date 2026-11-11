'use strict';

const {
  createCodec,createVoiceRoom,checkedId,validateTitle,
} = require('./vox30-protocol');

// Adapter for the existing #보룸시작 command. It is NOT installed by default.
// Supply authenticated credentials and real WebRTC peers from a separately
// validated provider. An arbitrary SDP string is not a functioning media peer.
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
        active={chatId,session,peer};
        return {requestAccepted:true,verified:false};
      }catch(e){
        session?.conn.close();
        if(peer)await Promise.resolve(peer.close()).catch(()=>{});
        throw e;
      }finally{running=false;}
    },
    // Local release only. It is NOT the KakaoTalk server's room termination.
    async dispose() {
      const old=active;active=null;
      if(!old)return;
      old.session.conn.close();
      await Promise.resolve(old.peer.close()).catch(()=>{});
    },
  };
}

module.exports={createVox30Adapter,createCodec};
