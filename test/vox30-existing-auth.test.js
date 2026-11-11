'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createVoxCandidateProvider}=require('../shared/vox30-existing-auth');

const USER='418692594',ROOM='18496234145974738';
function fakeClient(){
 const client={
  userId:Number(USER),
  oauthToken:'TEST_KAKAO_OAUTH_ACCESS_TOKEN_DO_NOT_SHARE',
  deviceUuid:'test-device-uuid',
  _chatRooms:new Map([[ROOM,{isOpenChat:true}]]),
  _getCachedMemberType:(room,id)=>(room===ROOM&&String(id)===USER?0:null),
 };
 return client;
}

test('KakaoForge session candidate uses existing in-memory credentials only',()=>{
 const client=fakeClient();
 const provider=createVoxCandidateProvider(client,{expectedActorUserId:USER});
 assert.deepEqual(provider.getCredentials(),{
  oauthToken:client.oauthToken,deviceUuid:client.deviceUuid,
 });
 assert.equal(provider.actorUserId,USER);
 assert.deepEqual(provider.localRoomEvidence({actorUserId:USER,chatId:ROOM}),{
  roomId:ROOM,isOpenChatInLocalRoster:true,memberTypeCached:true,voxServerVerified:false,
 });
 assert.deepEqual(provider.diagnostics({chatId:ROOM}),{
  hasKakaoCredentials:true,kakaoRoomCached:true,
  kakaoMemberTypeCached:true,voxServerAuthenticated:false,voxCreationReady:false,
 });
});

test('token refresh is read lazily and does not require QR re-login',()=>{
 const client=fakeClient();
 const provider=createVoxCandidateProvider(client,{expectedActorUserId:USER});
 client.oauthToken='RENEWED_KAKAO_ACCESS_TOKEN_FRESH_VALUE';
 assert.equal(provider.getCredentials().oauthToken,client.oauthToken);
});

test('wrong account or absent token fails closed',()=>{
 const client=fakeClient();
 assert.throws(()=>createVoxCandidateProvider(client,{expectedActorUserId:'42424242'}).getCredentials(),
  /일치하지/);
 const provider=createVoxCandidateProvider(client,{expectedActorUserId:USER});
 client.oauthToken='';
 assert.throws(()=>provider.getCredentials(),/OAuth/);
 assert.equal(provider.diagnostics({chatId:ROOM}).hasKakaoCredentials,false);
});

test('local roster is never equivalent to VOX server membership',()=>{
 const client=fakeClient();
 const provider=createVoxCandidateProvider(client,{expectedActorUserId:USER});
 assert.equal(provider.localRoomEvidence({actorUserId:USER,chatId:ROOM}).voxServerVerified,false);
 client._chatRooms.delete(ROOM);
 assert.equal(provider.diagnostics({chatId:ROOM}).kakaoRoomCached,false);
 assert.throws(()=>provider.localRoomEvidence({actorUserId:'12345678',chatId:ROOM}),/일치/);
});

test('diagnostics never exposes OAuth token or device UUID',()=>{
 const client=fakeClient();
 const provider=createVoxCandidateProvider(client,{expectedActorUserId:USER});
 const result=JSON.stringify(provider.diagnostics({chatId:ROOM}));
 assert.doesNotMatch(result,/TEST_KAKAO_OAUTH|device-uuid/);
 assert.match(result,/voxServerAuthenticated/);
});

test('IDs beyond JS safe integer cannot be silently rounded',()=>{
 const client=fakeClient();client.userId=Number('9223372036854775807');
 const provider=createVoxCandidateProvider(client,{expectedActorUserId:USER});
 assert.throws(()=>provider.getCredentials(),/정밀도/);
});
