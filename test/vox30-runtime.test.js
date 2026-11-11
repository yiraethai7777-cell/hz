'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {installDirectVoice}=require('../shared/vox30-runtime');

const env={
  NEXI_VOX_MODEL:'test-device',
  NEXI_VOX_SDK_VERSION:'35',
  NEXI_VOX_BUILD_ID:'test-build',
  NEXI_VOX_CARRIER_ID:'45005',
};
const log={info(){},warn(){}};

test('missing device profile does not load the transport',()=>{
  const client={};
  let loaded=false;
  assert.equal(installDirectVoice(client,{env:{},log,loadLab(){loaded=true;}}),false);
  assert.equal(loaded,false);
  assert.equal(client.voiceRoomAdapter,undefined);
});

test('runtime uses the current bot credentials and checks the target room',async()=>{
  let config;
  let token='first-token';
  const client={
    userId:'10',connected:true,_getCachedMemberType:()=>4,
    voiceRoomAuthCandidate:{
      actorUserId:'10',
      getCredentials:()=>({oauthToken:token,deviceUuid:'test-uuid'}),
      localRoomEvidence:({chatId})=>({isOpenChatInLocalRoster:chatId==='20',memberTypeCached:true}),
    },
  };
  assert.equal(installDirectVoice(client,{env,log,loadLab:()=>({
    createLabAdapter(options){
      config=options;
      return {async create(){return {requestAccepted:true,verified:false};}};
    },
  })}),true);
  assert.equal(config.appVer,'26.3.1');
  assert.equal(config.userTypeForRoom({chatId:'20'}),2);
  assert.equal(config.verifyMembership({actorUserId:'10',chatId:'20'}),true);
  assert.equal(config.verifyMembership({actorUserId:'10',chatId:'21'}),false);
  token='rotated-token';
  assert.equal(config.credentialsForRoom().oauthToken,token);
  assert.equal((await client.voiceRoomAdapter.create({roomId:'20'})).verified,false);
  client.connected=false;
  assert.equal(config.verifyMembership({actorUserId:'10',chatId:'20'}),false);
});
