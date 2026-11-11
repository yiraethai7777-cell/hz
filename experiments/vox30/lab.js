'use strict';

// Optional experiment entrypoint; NOT wired into the live Railway bot.
// Do not import user secrets from Railway's auth.json or the Noa login.
const {createCodec}=require('../../shared/vox30-protocol');
const {createVox30Adapter}=require('../../shared/vox30-adapter');
const {seedCbcBytes}=require('./seed');
const {createWebRtcPeer}=require('./webrtc');

function createLabAdapter({
  actorUserId,cfg,entryHost,entryPort,
  credentialsForRoom,verifyMembership,
  rtcConfig,iceTimeoutMs,connect,
}={}) {
  return createVox30Adapter({
    actorUserId,cfg,entryHost,entryPort,
    codec:createCodec({seed:seedCbcBytes()}),
    credentialsForRoom,verifyMembership,
    rtcFactory:()=>createWebRtcPeer({rtcConfig,iceTimeoutMs}),
    ...(connect?{connect}:{}),
  });
}

module.exports={createLabAdapter};
