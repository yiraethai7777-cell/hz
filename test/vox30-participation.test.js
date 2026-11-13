'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createParticipationController}=require('../shared/vox30-participation');
const USER='9007199254740993123';
const ROOM='18495931541358610';
const CALL='13299692653040311';
const INVITE={roomId:ROOM,callId:CALL,hostV4:'192.0.2.51',hostV6:'',port:9000};
function roster(group) {
  return {method:12011,memberGroups:{[group]:{own:'present',ownStates:{mic:true}}}};
}
test('unverified VOX methods are never sent and show unsupported capabilities',async()=>{
  const p=createParticipationController({actorUserId:USER});
  assert.deepEqual(p.supports(),{join:false,speaker:false,moderator:false});
  const state=p.status(ROOM);
  assert.equal(state.joinAvailable,false);
  assert.equal(state.localActive,false);
  await assert.rejects(()=>p.join({roomId:ROOM,invitation:INVITE}),/11002 LOGIN/);
  assert.equal(p.status(ROOM).localActive,false);
});
test('a verified join transport can be injected, but request acceptance is not roster proof',async()=>{
  const calls=[];
  const p=createParticipationController({actorUserId:USER,joinTransport:async args=>{
    calls.push(args);return {requestAccepted:true,verified:true};
  }});
  const result=await p.join({roomId:ROOM,invitation:INVITE});
  assert.deepEqual(result,{requestAccepted:true,verified:false});
  assert.equal(calls.length,1);
  assert.equal(calls[0].actorUserId,USER);
  assert.equal(p.status(ROOM).localActive,false);
  await assert.rejects(()=>p.join({roomId:'123',invitation:INVITE}),/초대/);
});
test('fake chat invite never activates speaker or moderator acceptance',async()=>{
  let calls=0;
  const p=createParticipationController({actorUserId:USER,
    acceptSpeakerTransport:async()=>{calls++;return {requestAccepted:true};},
    acceptModeratorTransport:async()=>{calls++;return {requestAccepted:true};},
  });
  p.activate({roomId:ROOM,callId:CALL});
  for(const role of ['speaker','moderator']){
    assert.deepEqual(await p.receiveAuthenticatedInvitation({
      roomId:ROOM,callId:CALL,recipientUserId:USER,role,authenticated:false,
    }),{handled:false});
    assert.deepEqual(await p.receiveAuthenticatedInvitation({
      roomId:ROOM,callId:CALL,recipientUserId:'123456789',role,authenticated:true,
    }),{handled:false});
    assert.deepEqual(await p.receiveAuthenticatedInvitation({
      roomId:ROOM,callId:'11',recipientUserId:USER,role,authenticated:true,
    }),{handled:false});
  }
  assert.equal(calls,0);
});
test('authenticated server invitation is requested once and only VOX roster confirms speaker role',async()=>{
  let calls=0;
  const p=createParticipationController({actorUserId:USER,
    acceptSpeakerTransport:async data=>{
      calls++;assert.deepEqual(data,{roomId:ROOM,callId:CALL,actorUserId:USER});
      return {requestAccepted:true};
    },
  });
  p.activate({roomId:ROOM,callId:CALL});
  const invite={roomId:ROOM,callId:CALL,recipientUserId:USER,role:'speaker',authenticated:true};
  assert.deepEqual(await p.receiveAuthenticatedInvitation(invite),
    {handled:true,verified:false,awaitingRoster:true});
  assert.equal(p.status(ROOM).roleVerified,false);
  assert.deepEqual(p.status(ROOM).pendingRoles,['speaker']);
  assert.deepEqual(await p.receiveAuthenticatedInvitation(invite),{handled:false,reason:'duplicate'});
  assert.equal(calls,1);
  assert.equal(p.onRoster(roster('listeners'),{roomId:ROOM,callId:CALL}),true);
  assert.equal(p.status(ROOM).role,'listener');
  assert.equal(p.onRoster(roster('speakers'),{roomId:ROOM,callId:CALL}),true);
  assert.equal(p.status(ROOM).role,'speaker');
  assert.equal(p.status(ROOM).roleVerified,true);
  assert.deepEqual(p.status(ROOM).pendingRoles,[]);
  assert.deepEqual(await p.receiveAuthenticatedInvitation(invite),{handled:false,reason:'already-granted'});
});
test('moderator upgrade uses separately verified driver and ignores stale sessions',async()=>{
  let calls=0;
  const p=createParticipationController({actorUserId:USER,
    acceptModeratorTransport:async()=>{calls++;return {requestAccepted:true};},
  });
  p.activate({roomId:ROOM,callId:CALL});
  const invite={roomId:ROOM,callId:CALL,recipientUserId:USER,role:'moderator',authenticated:true};
  assert.deepEqual(await p.receiveAuthenticatedInvitation(invite),{handled:true,verified:false,awaitingRoster:true});
  assert.equal(calls,1);
  assert.equal(p.onRoster(roster('moderators'),{roomId:ROOM,callId:'12345'}),false);
  assert.equal(p.status(ROOM).role,null);
  assert.equal(p.onRoster(roster('moderators'),{roomId:ROOM,callId:CALL}),true);
  assert.equal(p.status(ROOM).role,'moderator');
  p.release();
  assert.equal(p.status(ROOM).localActive,false);
  assert.deepEqual(await p.receiveAuthenticatedInvitation(invite),{handled:false});
  assert.equal(calls,1);
});
test('driver denial does not leave a pending accepted role',async()=>{
  const p=createParticipationController({actorUserId:USER,
    acceptModeratorTransport:async()=>({requestAccepted:false}),
  });
  p.activate({roomId:ROOM,callId:CALL});
  assert.deepEqual(await p.receiveAuthenticatedInvitation({
    roomId:ROOM,callId:CALL,recipientUserId:USER,role:'moderator',authenticated:true,
  }),{handled:false,reason:'request-not-accepted'});
  assert.deepEqual(p.status(ROOM).pendingRoles,[]);
});
test('direct adapter exposes fail-closed join capability without changing create driver',async()=>{
  const {createVox30Adapter}=require('../shared/vox30-adapter');
  const driver=createVox30Adapter({
    actorUserId:USER,cfg:{userId:USER},entryHost:'entry.test',codec:{frame(){},parse(){}},
    credentialsForRoom:async()=>({oauthToken:'hidden',deviceUuid:'hidden'}),
    verifyMembership:async()=>true,rtcFactory:()=>{throw Error('create must not run');},
  });
  const state=await driver.status({roomId:ROOM});
  assert.equal(state.joinAvailable,false);
  assert.equal(state.speakerAutoAcceptAvailable,false);
  assert.equal(state.moderatorAutoAcceptAvailable,false);
  await assert.rejects(()=>driver.join({roomId:ROOM,botUserId:USER}),/LOGIN/);
  assert.deepEqual(await driver.receiveAuthenticatedRoleInvitation({
    roomId:ROOM,callId:CALL,recipientUserId:USER,role:'moderator',authenticated:true,
  }),{handled:false});
  await driver.dispose();
});
