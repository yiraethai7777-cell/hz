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
  hangupTransport=null,unsafeStopExperiment=false,hangup10008Trial=false,
  experimentalJoin=false,acceptSpeakerTransport=null,acceptModeratorTransport=null,
}={}) {
  return createVox30Adapter({
    actorUserId,cfg,entryHost,entryPort,appVer,
    codec:createCodec({seed:seedCbcBytes()}),
    credentialsForRoom,verifyMembership,userTypeForRoom,hangupTransport,
    unsafeStopExperiment,hangup10008Trial,experimentalJoin,
    acceptSpeakerTransport,acceptModeratorTransport,
    rtcFactory:({role}={})=>createWebRtcPeer({
      rtcConfig,iceTimeoutMs,silentAudio:role==='listener'?false:enableSilentAudio,
    }),
    ...(connect?{connect}:{}),
  });
}

module.exports={createLabAdapter};
