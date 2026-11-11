'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assessVoxAuthPreflight,validProfile}=
  require('../shared/vox30-auth-preflight');

const ROOM='18496234145974738';
const USER='9007199254740993123';
const OAUTH='PRIVATE_KAKAO_OAUTH_TEST_STRING_DO_NOT_EMIT';
const DUUID='PRIVATE-UUID-TEST-DO-NOT-EMIT';
function session(){
  return {
    connected:true,userId:USER,oauthToken:OAUTH,deviceUuid:DUUID,
    os:'android',appVer:'26.1.2',mccmnc:'45005',
    _chatRooms:new Map([[ROOM,{isOpenChat:true}]]),
    _getCachedMemberType:(room,id)=>room===ROOM&&id===USER?4:null,
    voiceRoomAuthCandidate:{diagnostics:({chatId})=>({
      hasKakaoCredentials:chatId===ROOM,kakaoRoomCached:chatId===ROOM,
      kakaoMemberTypeCached:chatId===ROOM,voxServerAuthenticated:false,
    })},
  };
}
test('live KakaoForge session is local evidence, not VOX server login',()=>{
  const report=assessVoxAuthPreflight(session(),{chatId:ROOM});
  assert.equal(report.sessionConnected,true);
  assert.equal(report.accountIdExact,true);
  assert.equal(report.kakaoCredentialsPresent,true);
  assert.equal(report.openChatCached,true);
  assert.equal(report.botMemberCached,true);
  assert.equal(report.botModeratorCached,true);
  assert.equal(report.appVersionPresent,true);
  assert.equal(report.carrierPresent,true);
  assert.equal(report.deviceProfileVerified,false);
  assert.equal(report.labVersionMatchesSession,false);
  assert.equal(report.authenticatedVoxSession,false);
  assert.equal(report.createMethodVerified,false);
  assert.equal(report.mediaSessionVerified,false);
  assert.equal(report.creationEnabled,false);
  assert.deepEqual(report.missing,['verified_device_profile']);
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE_KAKAO_OAUTH|PRIVATE-UUID|9007199254740993123/);
});
test('bot role cannot be inferred from requester or unknown cached membership',()=>{
  const client=session();
  client._getCachedMemberType=()=>null;
  const report=assessVoxAuthPreflight(client,{chatId:ROOM});
  assert.equal(report.botModeratorCached,false);
  assert.ok(report.missing.includes('moderator_roster'));
});
test('wrong room or missing local evidence is not authorization',()=>{
  const report=assessVoxAuthPreflight(session(),{chatId:'18496234145974739'});
  assert.equal(report.openChatCached,false);
  assert.equal(report.botMemberCached,false);
  assert.equal(report.creationEnabled,false);
});
test('unsafe float account IDs are refused by the preflight',()=>{
  const client=session();client.userId=Number('9007199254740993123');
  const report=assessVoxAuthPreflight(client,{chatId:ROOM});
  assert.equal(report.accountIdExact,false);
  assert.ok(report.missing.includes('exact_account_id'));
});
test('only explicit source-labelled device metadata counts as verified',()=>{
  assert.equal(validProfile({model:'SM-T733',sdkVersion:'35',buildId:'test'}),false);
  assert.equal(validProfile({source:'verified-vox-device',model:'SM-T733',
    sdkVersion:'35',buildId:'example-build'}),true);
  const client=session();
  client.voiceRoomDeviceProfile={
    source:'verified-vox-device',model:'SM-T733',sdkVersion:'35',
    buildId:'example-build',
  };
  const report=assessVoxAuthPreflight(client,{chatId:ROOM});
  assert.equal(report.deviceProfileVerified,true);
  assert.equal(report.authenticatedVoxSession,false);
  assert.equal(report.creationEnabled,false);
});
test('no credentials/metadata/identifiers ever appear in serialized output',()=>{
  const client=session();
  client.appVer='special private build id';
  client.mccmnc='sensitive-data';
  client.voiceRoomDeviceProfile={
    model:OAUTH,sdkVersion:DUUID,buildId:USER,
  };
  const result=JSON.stringify(assessVoxAuthPreflight(client,{chatId:ROOM}));
  for(const secret of [OAUTH,DUUID,USER,'special private build id','sensitive-data'])
    assert.equal(result.includes(secret),false);
});
