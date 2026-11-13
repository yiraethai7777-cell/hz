'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {I32,I64,authenticatedRoleInvitation,getLoginTrialBody,joinVoiceRoomTrial,
  discoverExistingCall,METHODS}=require('../shared/vox30-protocol');
const {createParticipationController}=require('../shared/vox30-participation');
const {createMultiRoomAdapter}=require('../shared/vox30-multiroom');
const USER='9007199254740993123',ROOM='18495931541358610',CALL='13299692653040311';
const cfg={userId:USER},appVer='26.9.2';
const fakeSDP='v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const invitation={roomId:ROOM,callId:CALL,hostV4:'203.133.188.66',
  hostV6:'',port:9000};

function mockTransport({resCode=0,withSdp=true,withResCode=true}={}){
  let serverClosed=0,discoveryClosed=0;
  const sent=[];
  const server={
    wait(...methods){
      if(methods.includes(METHODS.LOGIN)){
        const body={callId:new I64(CALL),
          ...(withResCode?{resCode:new I32(resCode)}:{}),
          ...(withSdp?{sdp:{sdp:fakeSDP}}:{})};
        return {promise:Promise.resolve({method:METHODS.LOGIN,status:0,body}),cancel(){}};
      }
      // This mock has no separate CREATED event; a direct LOGIN reply suffices.
      const promise=new Promise(()=>{}); // cancelled when LOGIN contains SDP
      return {promise,cancel(){}};
    },
    async send(method,body){sent.push({method,body});},
    close(){serverClosed++;},
  };
  const discovery={
    async request(method){
      assert.equal(method,METHODS.DISCOVER);
      return {callable:1,csSslAddr:{ip:0xcb85bc42},csSslPort:995};
    },
    close(){discoveryClosed++;},
  };
  let serverConnects=0;
  const connect=async({host})=>{
    if(host==='entry.test')return discovery;
    assert.equal(host,invitation.hostV4);
    serverConnects++;return server;
  };
  return {connect,sent,get serverConnects(){return serverConnects;},
    get serverClosed(){return serverClosed;},
    get discoveryClosed(){return discoveryClosed;}};
}
test('Android VOX event 21=moderator, 33=speaker; 22=revoke is NEVER invitation',()=>{
  function packet(event,dest=USER,call=CALL){
    return {method:12011,status:0,body:{
      event:new I32(event),destId:new I64(dest),callId:new I64(call),
      oauthToken:'must-never-leak',
    }};
  }
  assert.deepEqual(authenticatedRoleInvitation(packet(21),USER),{
    recipientUserId:USER,callId:CALL,role:'moderator',authenticated:true,
  });
  assert.deepEqual(authenticatedRoleInvitation(packet(33),USER),{
    recipientUserId:USER,callId:CALL,role:'speaker',authenticated:true,
  });
  for(const code of [1,11,14,22,31,32,0]){
    assert.equal(authenticatedRoleInvitation(packet(code),USER),null);
  }
  assert.equal(authenticatedRoleInvitation(packet(21,'123456789'),USER),null);
  assert.equal(authenticatedRoleInvitation({
    ...packet(21),status:1,
  },USER),null);
  assert.equal(authenticatedRoleInvitation({
    ...packet(33),body:{event:new I32(33),callId:new I64(CALL)},
  },USER),null);
  assert.equal(authenticatedRoleInvitation({
    ...packet(21),method:11028,
  },USER),null);
});
test('experimental VOX LOGIN derives authenticated existing-call BSON but not a create title',()=>{
  const b=getLoginTrialBody({
    cfg,chatId:ROOM,callId:CALL,oauthToken:'token',deviceUuid:'uuid',
    sdp:fakeSDP,appVer,userType:1,
  });
  assert.equal(b.callId.toString(),CALL);
  assert.equal(b.chatId.toString(),ROOM);
  assert.equal(b.userId.toString(),USER);
  assert.equal(b.mediaType.toString(),'1');
  assert.equal(b.defaultMicOnOff.toString(),'0');
  assert.equal(b.oauthToken,'token');
  assert.equal(Object.hasOwn(b,'title'),false);
  assert.throws(()=>getLoginTrialBody({...{
    cfg,chatId:ROOM,oauthToken:'secret',deviceUuid:'uuid',
    sdp:fakeSDP,appVer},callId:'bad'}),/ID/);
});
test('11002 trial sends one login and never claims server roster membership from SDP alone',async()=>{
  const t=mockTransport();
  const session=await joinVoiceRoomTrial({
    cfg,chatId:ROOM,callId:CALL,oauthToken:'secret',deviceUuid:'uuid',
    sdp:fakeSDP,appVer,entryHost:'entry.test',codec:{},connect:t.connect,
    invitation,
  });
  assert.equal(session.requestAccepted,true);
  assert.equal(session.verified,false);
  assert.equal(session.callId,CALL);
  assert.equal(session.remoteSdp.sdp,fakeSDP);
  assert.equal(session.signaling.experimentalLogin,true);
  assert.equal(t.sent.length,1);
  assert.equal(t.sent[0].method,METHODS.LOGIN);
  assert.equal(t.sent[0].body.callId.toString(),CALL);
  assert.equal(t.serverClosed,0);
  assert.equal(t.discoveryClosed,1);
});
test('unverified remote endpoints are not contacted even if the invitation contains a public IP',async()=>{
  const t=mockTransport();
  await assert.rejects(joinVoiceRoomTrial({
    cfg,chatId:ROOM,callId:CALL,oauthToken:'secret',deviceUuid:'uuid',
    sdp:fakeSDP,appVer,entryHost:'entry.test',codec:{},connect:t.connect,
    invitation:{...invitation,hostV4:'203.0.113.88'},
  }),/서버.*일치하지/);
  assert.equal(t.serverConnects,0);
  assert.equal(t.sent.length,0);
});
test('LOGIN header status 0 without explicit body resCode is NOT acceptance',async()=>{
  const t=mockTransport({withResCode:false});
  await assert.rejects(joinVoiceRoomTrial({
    cfg,chatId:ROOM,callId:CALL,oauthToken:'secret',deviceUuid:'uuid',
    sdp:fakeSDP,appVer,entryHost:'entry.test',codec:{},connect:t.connect,
    invitation,
  }),/resCode/);
  assert.equal(t.serverClosed,1);
});
test('a server nonzero LOGIN response is rejected with local connection cleanup',async()=>{
  const t=mockTransport({resCode:1013});
  await assert.rejects(joinVoiceRoomTrial({
    cfg,chatId:ROOM,callId:CALL,oauthToken:'secret',deviceUuid:'uuid',
    sdp:fakeSDP,appVer,entryHost:'entry.test',codec:{},connect:t.connect,
    invitation,
  }),/resCode=1013/);
  assert.equal(t.serverClosed,1);
});
test('authenticated moderator/speaker invitations are retained but never guessed into a packet',async()=>{
  let now=100000;
  const p=createParticipationController({actorUserId:USER,now:()=>now});
  p.activate({roomId:ROOM,callId:CALL});
  const item=(role,callId=CALL,recipientUserId=USER)=>({
    role,callId,roomId:ROOM,recipientUserId,authenticated:true});
  const seen=await p.receiveAuthenticatedInvitation(item('moderator'));
  assert.deepEqual(seen,{handled:true,pending:true,reason:'protocol-unverified'});
  assert.deepEqual(p.status(ROOM).invitedRoles,['moderator']);
  assert.deepEqual(await p.acceptRole({roomId:ROOM,role:'moderator'}),
    {handled:false,reason:'protocol-unverified'});
  assert.deepEqual(await p.receiveAuthenticatedInvitation(item('speaker',CALL,'123')),
    {handled:false});
  assert.deepEqual(p.status(ROOM).invitedRoles,['moderator']);
  now+=3*60*1000+1;
  assert.deepEqual(p.status(ROOM).invitedRoles,[]);
  p.release();
});
test('role acceptance can call a separately authenticated driver but requires roster verification',async()=>{
  const calls=[];
  const p=createParticipationController({actorUserId:USER,now:()=>1234,
    acceptModeratorTransport:async req=>{
      calls.push(req);return {requestAccepted:true,verified:true};
    }});
  p.activate({roomId:ROOM,callId:CALL});
  const invitation={
    roomId:ROOM,callId:CALL,recipientUserId:USER,
    role:'moderator',authenticated:true};
  const result=await p.receiveAuthenticatedInvitation(invitation);
  assert.deepEqual(result,{handled:true,verified:false,awaitingRoster:true});
  assert.equal(calls.length,1);
  assert.equal(p.status(ROOM).roleVerified,false);
  assert.deepEqual(await p.acceptRole({roomId:ROOM,role:'moderator'}),
    {handled:false,reason:'already-requested'});
  p.onRoster({method:12011,memberGroups:{
    moderators:{own:'present',ownStates:{mic:false}},
  }},{roomId:ROOM,callId:CALL});
  assert.equal(p.status(ROOM).role,'moderator');
  assert.equal(p.status(ROOM).roleVerified,true);
});
test('multiroom join uses isolated per-room adapters, preserves original creator call',async()=>{
  const instances=[];
  const multi=createMultiRoomAdapter({maxRooms:2,createAdapter:()=>{
    const item={active:false,joins:0,
      async join(){this.active=true;this.joins++;return {requestAccepted:true,verified:false}},
      async create(){this.active=true;return {requestAccepted:true}},
      async status({roomId}){return {roomId,localActive:this.active,localSession:true}},
      async dispose(){this.active=false},
    };
    instances.push(item);return item;
  }});
  await multi.create({roomId:'101'});
  const joined=await multi.join({roomId:'202'});
  assert.equal(joined.requestAccepted,true);
  assert.equal(instances.length,2);
  assert.equal(instances[0].active,true);
  assert.equal(instances[1].active,true);
  await assert.rejects(multi.join({roomId:'303'}),/이미 활성 음성 세션/);
  await multi.dispose();
});


test('authenticated VOX 30000 discovery returns call coordinates only with actual callId',async()=>{
  let closes=0,queries=0;
  const connect=async({host})=>{
    assert.equal(host,'entry.test');
    return {
      async request(method,body){
        queries++;assert.equal(method,METHODS.DISCOVER);
        assert.equal(body.chatId.toString(),ROOM);
        return {callable:new I32(1),chatId:new I64(ROOM),
          callId:new I64(CALL),csSslAddr:{ip:0xcb85bc42},csSslPort:new I32(995)};
      },
      close(){closes++;}
    };
  };
  const got=await discoverExistingCall({
    cfg,chatId:ROOM,appVer,entryHost:'entry.test',codec:{},connect
  });
  assert.equal(got.ready,true);
  assert.equal(got.hasCallId,true);
  assert.equal(got.invitation.roomId,ROOM);
  assert.equal(got.invitation.callId,CALL);
  assert.equal(got.invitation.hostV4,'203.133.188.66');
  assert.equal(got.invitation.port,995);
  assert.equal(closes,1);
  assert.equal(queries,1);
});
test('server callable=1 without active callId cannot authorize a guessed 11002 login',async()=>{
  let closes=0;
  const connect=async()=>({
    async request(){return {callable:1,csSslAddr:{ip:0xcb85bc42},csSslPort:995}},
    close(){closes++;}
  });
  const result=await discoverExistingCall({
    cfg,chatId:ROOM,appVer,entryHost:'entry.test',codec:{},connect
  });
  assert.deepEqual(result,{
    ready:false,reason:'missing-call-id',hasCallId:false,callable:true,
  });
  assert.equal(closes,1);
});
test('foreign-room VOX discovery reply is refused without disclosing call details',async()=>{
  const connect=async()=>({
    request:async()=>({callable:1,chatId:new I64('123456789'),
      callId:new I64(CALL),csSslAddr:{ip:0xcb85bc42},csSslPort:995}),
    close(){},
  });
  const result=await discoverExistingCall({
    cfg,chatId:ROOM,appVer,entryHost:'entry.test',codec:{},connect
  });
  assert.equal(result.ready,false);
  assert.equal(result.reason,'room-mismatch');
  assert.equal(Object.hasOwn(result,'invitation'),false);
});
test('VOX discovery refuses server status without callable before examining call IDs',async()=>{
  const connect=async()=>({
    request:async()=>({callable:0,callId:new I64(CALL)}),
    close(){},
  });
  const got=await discoverExistingCall({
    cfg,chatId:ROOM,appVer,entryHost:'entry.test',codec:{},connect
  });
  assert.equal(got.ready,false);
  assert.equal(got.reason,'not-callable');
  assert.equal(got.invitation,undefined);
});


test('VOX join can merge a verified CHATINFO callId with an authenticated discovery endpoint',async()=>{
  const {createVox30Adapter}=require('../shared/vox30-adapter');
  let requested=0,closed=0,observed=null;
  const adapter=createVox30Adapter({
    actorUserId:USER,cfg,entryHost:'entry.test',appVer,
    codec:{frame(){return Buffer.alloc(16)},parse(){}},
    credentialsForRoom:async()=>({oauthToken:'t',deviceUuid:'u'}),
    rtcFactory:async()=>({}),
    verifyMembership:async()=>true,
    connect:async({host})=>{
      assert.equal(host,'entry.test');requested++;
      return {async request(method){
        assert.equal(method,METHODS.DISCOVER);
        return {callable:1,csSslAddr:{ip:0xcb85bc42},csSslPort:995};
      },close(){closed++;}};
    },
    joinTransport:async opts=>{
      observed=opts;return {requestAccepted:true,verified:false};
    },
  });
  const result=await adapter.join({
    roomId:ROOM,botUserId:USER,
    invitation:{roomId:ROOM,callId:CALL,hostV4:'',port:0,
      source:'authenticated-chatinfo'},
  });
  assert.equal(result.requestAccepted,true);
  assert.equal(result.verified,false);
  assert.equal(requested,1);
  assert.equal(closed,1);
  assert.equal(observed.invitation.roomId,ROOM);
  assert.equal(observed.invitation.callId,CALL);
  assert.equal(observed.invitation.hostV4,'203.133.188.66');
  assert.equal(observed.invitation.port,995);
  await adapter.dispose();
});
