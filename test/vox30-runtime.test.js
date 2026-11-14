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

test('VOX uses the KakaoForge session carrier unless a valid explicit override is provided',()=>{
  const {profileFromEnv}=require('../shared/vox30-runtime');
  assert.equal(profileFromEnv({},'26.9.2','45005').carrierId,'45005');
  assert.equal(profileFromEnv({NEXI_VOX_CARRIER_ID:'45008'},'26.9.2','45005').carrierId,'45008');
  assert.equal(profileFromEnv({},'26.9.2','unverified').carrierId,undefined);
  assert.equal(profileFromEnv({NEXI_VOX_CARRIER_ID:'bad'},'26.9.2','45005'),null);
  let received;
  const client={mccmnc:'45005',voiceRoomAuthCandidate:{actorUserId:'10',
    getCredentials:()=>({oauthToken:'test',deviceUuid:'test'}),
    localRoomEvidence:()=>({isOpenChatInLocalRoster:true,memberTypeCached:true})}};
  assert.equal(installDirectVoice(client,{env:{},log,
    loadLab:()=>({createLabAdapter(config){received=config.cfg.carrierId;return {create(){}};}})}),true);
  assert.equal(received,'45005');
});
test('silent audio is opt-in and does not change production default',()=>{
  let value;
  const client={voiceRoomAuthCandidate:{actorUserId:'10',getCredentials:()=>({oauthToken:'x',deviceUuid:'x'}),
    localRoomEvidence:()=>({isOpenChatInLocalRoster:true,memberTypeCached:true})}};
  assert.equal(installDirectVoice(client,{env:{NEXI_VOX_TX_SILENCE:'1'},log,
    loadLab:()=>({createLabAdapter(config){value=config.enableSilentAudio;return {create(){}};}})}),true);
  assert.equal(value,true);
});


test('legacy two-room opt-in now creates uncapped independent VOX room adapters',async()=>{
  const instances=[];
  const client={
    connected:true,userId:'10',_getCachedMemberType:()=>4,
    voiceRoomAuthCandidate:{
      actorUserId:'10',
      getCredentials:()=>({oauthToken:'token',deviceUuid:'uuid'}),
      localRoomEvidence:()=>({isOpenChatInLocalRoster:true,memberTypeCached:true}),
    },
  };
  const loadLab=()=>({createLabAdapter(){
    let room=null,active=false;
    const instance={
      async create({roomId}){
        room=roomId;active=true;return {requestAccepted:true,callId:'99'};
      },
      async status({roomId}){
        return {roomId,localSession:true,localActive:active,stopAvailable:false};
      },
      async dispose(){active=false},
    };
    instances.push(instance);
    return instance;
  }});
  assert.equal(installDirectVoice(client,{
    env:{NEXI_VOX_MAX_ACTIVE_ROOMS:'2'},loadLab,log,
  }),true);
  assert.equal(instances.length,0); // room adapters are initialized per request
  const a=client.voiceRoomAdapter;
  assert.equal((await a.status({roomId:'101'})).maxLocalRooms,null);
  await a.create({roomId:'101'});
  assert.equal((await a.status({roomId:'202'})).localBusyOtherRoom,false);
  await a.create({roomId:'202'});
  assert.equal(instances.length,2);
  assert.equal((await a.status({roomId:'101'})).localActive,true);
  assert.equal((await a.status({roomId:'202'})).localActive,true);
  assert.equal((await a.status({roomId:'303'})).localBusyOtherRoom,false);
  await a.create({roomId:'303'});
  assert.equal(instances.length,3);
  assert.equal((await a.status({roomId:'303'})).localActive,true);
  await a.dispose();
});

test('numeric multi-room settings no longer cap room count or instantiate eager sessions',()=>{
  let created=0;
  const client={voiceRoomAuthCandidate:{actorUserId:'10',
    getCredentials:()=>({oauthToken:'a',deviceUuid:'b'}),
    localRoomEvidence:()=>({isOpenChatInLocalRoster:true,memberTypeCached:true})}};
  assert.equal(installDirectVoice(client,{
    env:{NEXI_VOX_MAX_ACTIVE_ROOMS:'3'},log,
    loadLab:()=>({createLabAdapter(){created++;return {create:async()=>true}}}),
  }),true);
  assert.equal(created,0);
  assert.equal(client.voiceRoomAdapter.kind,'vox30-direct-experimental');
});


test('runtime passes a reviewed hangup driver only by explicit injection',()=>{
  const supplied={
    verified:true,appVer:'26.9.2',async hangUp(){
      return {requestAccepted:true};
    },
  };
  const client={
    appVer:'26.9.2',voiceRoomAuthCandidate:{
      actorUserId:'10',getCredentials:()=>({oauthToken:'test',deviceUuid:'test'}),
      localRoomEvidence:()=>({isOpenChatInLocalRoster:true,memberTypeCached:true}),
    },
  };
  let observed;
  assert.equal(installDirectVoice(client,{
    env:{},hangupTransport:supplied,log,
    loadLab:()=>({createLabAdapter(opts){
      observed=opts.hangupTransport;
      return {create:async()=>true};
    }}),
  }),true);
  assert.equal(observed,supplied);
  const other={voiceRoomAuthCandidate:client.voiceRoomAuthCandidate};
  assert.equal(installDirectVoice(other,{
    env:{},log,
    loadLab:()=>({createLabAdapter(opts){
      observed=opts.hangupTransport;return {create:async()=>true};
    }}),
  }),true);
  assert.equal(observed,null); // no runtime default, no env-toggle fallback
});
