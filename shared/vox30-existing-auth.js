'use strict';

// A candidate VOX credential source derived from the already-authenticated
// KakaoForge session. Does NOT assert VOX authorization: LOCO login is not
// sufficient proof that a separate VOX server accepts the same OAuth token.
// No auth.json import, QR relogin, disk write, or token logging.
const MAX_I64=9223372036854775807n;
function positiveId(value) {
  if (typeof value==='number' && !Number.isSafeInteger(value))
    throw Error('VOX 사용자/방 ID 정밀도 오류');
  const s=String(value??'');
  if(!/^[1-9]\d{0,18}$/.test(s)||BigInt(s)>MAX_I64)
    throw Error('VOX 사용자/방 ID 오류');
  return s;
}
function validateCandidate(client,expectedActorUserId) {
  if (!client||typeof client!=='object')throw Error('KakaoForge 클라이언트가 필요합니다.');
  const actual=positiveId(client.userId);
  const expected=positiveId(expectedActorUserId);
  if(actual!==expected)throw Error('Railway 봇 계정과 VOX 실행 계정이 일치하지 않습니다.');
  // These are the existing QR-login fields populated by createClient() and
  // refreshed by KakaoForge, not a separate VOX login or guaranteed VOX scope.
  if(typeof client.oauthToken!=='string'||client.oauthToken.length<16||
      /[\r\n]/.test(client.oauthToken)||
      typeof client.deviceUuid!=='string'||client.deviceUuid.length<8||
      /[\r\n]/.test(client.deviceUuid))
    throw Error('기존 카카오톡 계정 OAuth 또는 deviceUuid가 없습니다.');
  return actual;
}

function createVoxCandidateProvider(client,{expectedActorUserId}={}) {
  const userId=positiveId(expectedActorUserId);
  function candidateCredentials() {
    validateCandidate(client,userId);
    // Read on every invocation; KakaoForge may refresh oauthToken at runtime.
    return {oauthToken:client.oauthToken,deviceUuid:client.deviceUuid};
  }
  // Conservative local roster check. A cached roster is not an independent
  // VOX server membership confirmation. No request may be sent based solely
  // on its presence until the actual VOX auth response is validated.
  function localRoomEvidence({actorUserId,chatId}) {
    if(positiveId(actorUserId)!==userId)
      throw Error('VOX 요청 계정 ID가 일치하지 않습니다.');
    const roomId=positiveId(chatId);
    validateCandidate(client,userId);
    const room=client._chatRooms instanceof Map?client._chatRooms.get(roomId):null;
    const memberType=typeof client._getCachedMemberType==='function'
      ?client._getCachedMemberType(roomId,userId):null;
    return {
      roomId,
      isOpenChatInLocalRoster:room?.isOpenChat===true,
      memberTypeCached:Number.isInteger(memberType)&&memberType>=0,
      // Evidence for the same logged-in KakaoForge session only.
      voxServerVerified:false,
    };
  }
  return Object.freeze({
    kind:'kakaoforge-vox-credential-candidate',
    actorUserId:userId,
    getCredentials:candidateCredentials,
    localRoomEvidence,
    diagnostics({chatId}={}) {
      let hasKakaoCredentials=false;
      try{validateCandidate(client,userId);hasKakaoCredentials=true;}catch{}
      let roomEvidence=null;
      if(chatId!=null){
        try{roomEvidence=localRoomEvidence({actorUserId:userId,chatId});}catch{}
      }
      // Safe to display in logs or admin status; never return the token/UUID.
      return {
        hasKakaoCredentials,
        kakaoRoomCached:roomEvidence?.isOpenChatInLocalRoster===true,
        kakaoMemberTypeCached:roomEvidence?.memberTypeCached===true,
        voxServerAuthenticated:false,
        voxCreationReady:false,
      };
    },
  });
}

module.exports={createVoxCandidateProvider,positiveId,validateCandidate};
