'use strict';

// Secret-free readiness checks for a future authenticated VOX experiment.
// Crucially this module never attempts VOX login, sends a method 11028/10028,
// reads auth.json, refreshes credentials, or creates a media session.
const {positiveId}=require('./vox30-existing-auth');

const DEV_FIELDS=['model','sdkVersion','buildId'];
// KakaoForge constructor defaults: presence is NOT authenticated device provenance.
const DEFAULT_LOCO_APP_VERSION='26.1.2';
const DEFAULT_LOCO_CARRIER='45005';
function nonempty(value,max=128) {
  return typeof value==='string' && value.trim().length>0 &&
    value.length<=max && !/[\u0000-\u001f\u007f]/.test(value);
}
function validProfile(profile) {
  return !!profile && typeof profile==='object' &&
    DEV_FIELDS.every(key=>nonempty(profile[key])) &&
    profile.source==='verified-vox-device';
}

function assessVoxAuthPreflight(client,{chatId}={}) {
  let roomId='';
  try{roomId=positiveId(chatId);}catch{}
  let exactActorId=false;
  try{positiveId(client?.userId);exactActorId=true;}catch{}
  const provider=client?.voiceRoomAuthCandidate;
  let evidence={};
  if(roomId && typeof provider?.diagnostics==='function'){
    try{evidence=provider.diagnostics({chatId:roomId})||{};}catch{}
  }
  const localRoom=(roomId && client && client._chatRooms instanceof Map)
    ?client._chatRooms.get(roomId):null;
  let cachedRole=null;
  if(roomId&&exactActorId&&typeof client?._getCachedMemberType==='function'){
    try{cachedRole=client._getCachedMemberType(roomId,client.userId);}catch{}
  }
  const cachedModerationRole=Number(cachedRole)===1||Number(cachedRole)===4;
  // A LOCO cached role is useful for UX but is NOT VOX authorization.
  const state={
    sessionConnected:client?.connected===true,
    accountIdExact:exactActorId,
    kakaoCredentialsPresent:evidence.hasKakaoCredentials===true,
    openChatCached:localRoom?.isOpenChat===true && evidence.kakaoRoomCached===true,
    botMemberCached:evidence.kakaoMemberTypeCached===true,
    botModeratorCached:cachedRole!==null && cachedRole!==undefined && cachedModerationRole,
    appVersionPresent:nonempty(client?.appVer,40) &&
      /^\d+\.\d+\.\d+(?:[.-][a-zA-Z0-9.]+)?$/.test(client.appVer),
    carrierPresent:typeof client?.mccmnc==='string' &&
      /^\d{5,6}$/.test(client.mccmnc),
    // The existing bot is created with KakaoForge's default device settings.
    // Values may coincidentally match a real device but must not be upgraded
    // to VOX-verified metadata merely because they are non-empty.
    appVersionMayBeDefault:client?.appVer===DEFAULT_LOCO_APP_VERSION,
    carrierMayBeDefault:client?.mccmnc===DEFAULT_LOCO_CARRIER,
    voxModelFromSession:false,
    voxSdkVersionFromSession:false,
    voxBuildIdFromSession:false,
    deviceProfileVerified:validProfile(client?.voiceRoomDeviceProfile),
    // The hardcoded lab version (26.3.1) must not replace the live client's.
    labVersionMatchesSession:client?.appVer==='26.3.1',
    authenticatedVoxSession:false,
    createMethodVerified:false,
    mediaSessionVerified:false,
    creationEnabled:client?.voiceRoomAdapter?.kind==='vox30-direct-experimental',
  };
  const missing=[];
  for(const [key,ok] of [
    ['kakao_connection',state.sessionConnected],
    ['exact_account_id',state.accountIdExact],
    ['kakao_credentials',state.kakaoCredentialsPresent],
    ['openchat_roster',state.openChatCached],
    ['bot_member_roster',state.botMemberCached],
    ['moderator_roster',state.botModeratorCached],
    ['app_version',state.appVersionPresent],
    ['carrier',state.carrierPresent],
    ['verified_device_profile',state.deviceProfileVerified],
  ])if(!ok)missing.push(key);
  // This is a preparation result, not a VOX server authentication check.
  return Object.freeze({...state,missing});
}

module.exports={assessVoxAuthPreflight,validProfile,DEFAULT_LOCO_APP_VERSION,DEFAULT_LOCO_CARRIER};
