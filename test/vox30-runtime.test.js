'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {installDirectVoice}=require('../shared/vox30-runtime');

const log={info(){},warn(){}};

test('missing existing login provider does not load the transport',()=>{
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
  assert.equal(installDirectVoice(client,{env:{},log,loadLab:()=>({
    createLabAdapter(options){
      config=options;
      return {async create(){return {requestAccepted:true,verified:false};}};
    },
  })}),true);
  assert.equal(config.appVer,'26.3.1');
  assert.equal(config.enableSilentAudio,false);
  assert.deepEqual(config.cfg,{userId:'10'});
  assert.equal(config.userTypeForRoom({chatId:'20'}),2);
  assert.equal(config.verifyMembership({actorUserId:'10',chatId:'20'}),true);
  assert.equal(config.verifyMembership({actorUserId:'10',chatId:'21'}),false);
  token='rotated-token';
  assert.equal(config.credentialsForRoom().oauthToken,token);
  assert.equal((await client.voiceRoomAdapter.create({roomId:'20'})).verified,false);
  client.connected=false;
  assert.equal(config.verifyMembership({actorUserId:'10',chatId:'20'}),false);
});

test('VOX version uses current authenticated client and explicit env overrides',()=>{
  const {profileFromEnv}=require('../shared/vox30-runtime');
  assert.equal(profileFromEnv({},'26.9.2').appVer,'26.9.2');
  assert.equal(profileFromEnv({NEXI_VOX_APP_VERSION:'26.9.1'},'26.9.2').appVer,'26.9.1');
  assert.equal(profileFromEnv({}).appVer,'26.3.1');
  assert.throws(()=>profileFromEnv({},'not-a-version'),/앱 버전/);
});

test('silent audio is opt-in and does not change production default',()=>{
  let value;
  const client={voiceRoomAuthCandidate:{actorUserId:'10',getCredentials:()=>({oauthToken:'x',deviceUuid:'x'}),
    localRoomEvidence:()=>({isOpenChatInLocalRoster:true,memberTypeCached:true})}};
  assert.equal(installDirectVoice(client,{env:{NEXI_VOX_TX_SILENCE:'1'},log,
    loadLab:()=>({createLabAdapter(config){value=config.enableSilentAudio;return {create(){}};}})}),true);
  assert.equal(value,true);
});
