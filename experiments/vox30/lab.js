'use strict';

// Shared assembly for the standalone lab and the Railway VOX adapter.
const {createCodec}=require('../../shared/vox30-protocol');
const {createVox30Adapter}=require('../../shared/vox30-adapter');
const {seedCbcBytes}=require('./seed');
const {createWebRtcPeer}=require('./webrtc');

function createLabAdapter({
  actorUserId,cfg,entryHost,entryPort,appVer,
  credentialsForRoom,verifyMembership,
  rtcConfig,iceTimeoutMs,connect,userTypeForRoom,enableSilentAudio=false,
}={}) {
  return createVox30Adapter({
    actorUserId,cfg,entryHost,entryPort,appVer,
    codec:createCodec({seed:seedCbcBytes()}),
    credentialsForRoom,verifyMembership,userTypeForRoom,
    rtcFactory:()=>createWebRtcPeer({rtcConfig,iceTimeoutMs,silentAudio:enableSilentAudio}),
    ...(connect?{connect}:{}),
  });
}

module.exports={createLabAdapter};
