'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {METHODS}=require('../shared/vox30-protocol');
const {probeSyntheticDiscovery,SYNTHETIC_ID,CANDIDATE,CFG,outcome}=
  require('../experiments/vox30/synthetic-discovery');

const dummyCodec={frame(){throw Error('frame should be handled by mock transport');},
  parse(){throw Error('parse should be handled by mock transport');}};

test('probe is fully offline unless explicitly requested',async()=>{
  let connects=0;
  const result=await probeSyntheticDiscovery({
    connect:async()=>{connects++;throw Error('must never connect');},
    codec:dummyCodec,
  });
  assert.equal(connects,0);
  assert.equal(result.status,'blocked_requires_explicit_execute');
  assert.equal(result.oauthSent,false);
  assert.equal(result.createRequestSent,false);
  assert.equal(result.voiceRoomCreated,false);
});

test('one read-only 30000 request uses synthetic IDs and no OAuth',async()=>{
  let connects=0,requests=0,closed=0;
  let observedTarget;
  const result=await probeSyntheticDiscovery({
    execute:true,codec:dummyCodec,
    connect:async config=>{
      connects++;
      observedTarget=config;
      return {
        request:async(method,body)=>{
          requests++;
          assert.equal(method,METHODS.DISCOVER);
          assert.equal(method,30000);
          assert.equal(body.userId.toString(),SYNTHETIC_ID);
          assert.equal(body.chatId.toString(),SYNTHETIC_ID);
          assert.equal(body.devInfo.model,'SYNTHETIC_VOX_TEST');
          assert.equal(body.devInfo.buildId,'NO_REAL_DEVICE');
          assert.equal(Object.hasOwn(body,'oauthToken'),false);
          assert.equal(Object.hasOwn(body,'duuid'),false);
          assert.equal(Object.hasOwn(body,'deviceUuid'),false);
          assert.equal(Object.hasOwn(body,'sdp'),false);
          assert.equal(Object.hasOwn(body,'title'),false);
          return {callable:0,csSslAddr:null};
        },
        close(){closed++;},
      };
    },
  });
  assert.equal(connects,1);
  assert.equal(requests,1);
  assert.equal(closed,1);
  assert.deepEqual({host:observedTarget.host,port:observedTarget.port,
    servername:observedTarget.servername},CANDIDATE);
  assert.equal(observedTarget.timeoutMs,3500);
  assert.deepEqual(result,{
    status:'matching_bson_frame_received',
    hasCallableField:true,callable:'denied',
    hasServerAddressField:true,serverAddressObject:false,
    hasOuterPortField:false,hasNestedPortField:false,
    hasServerIpv4Field:false,
    validCallServerAddress:false,callServerTlsStatus:'not_checked',
    realAccountUsed:false,oauthSent:false,createRequestSent:false,
    voxServerAuthenticated:false,voiceRoomCreated:false,
  });
  assert.equal(JSON.stringify(result).includes(SYNTHETIC_ID),false);
  assert.equal(JSON.stringify(result).includes(CANDIDATE.host),false);
});

test('a rejected 30000 reply is not called authentication success',async()=>{
  const result=await probeSyntheticDiscovery({
    execute:true,codec:dummyCodec,
    connect:async()=>({
      async request(){throw Error('VOX 응답 거절: method=30000 resCode=17');},
      close(){},
    }),
  });
  assert.equal(result.status,'parsed_bson_rejection');
  assert.equal(result.voxServerAuthenticated,false);
  assert.equal(result.voiceRoomCreated,false);
});

test('connection failure and unexpected errors do not leak sensitive text',async()=>{
  for(const [error,expected] of [
    ['VOX 연결 종료','connection_closed_after_request'],
    ['VOX 서버 응답 시간 초과','no_matching_method_response'],
    ['VOX TLS 인증서 검증 실패','tls_certificate_rejected'],
    ['OAuth token private error string','probe_inconclusive'],
  ]) {
    let closed=0;
    const result=await probeSyntheticDiscovery({
      execute:true,codec:dummyCodec,
      connect:async()=>({
        request:async()=>{throw Error(error);},
        close(){closed++;},
      }),
    });
    assert.equal(result.status,expected);
    assert.equal(closed,1);
    assert.doesNotMatch(JSON.stringify(result),/OAuth token private/);
  }
});

test('config is marked as synthetic, and timeout is bounded',async()=>{
  assert.equal(CFG.userId,SYNTHETIC_ID);
  assert.equal(CFG.carrierId,'00000');
  assert.equal(outcome(Error('VOX 서버 응답 시간 초과')),'no_matching_method_response');
  await assert.rejects(()=>probeSyntheticDiscovery({execute:true,
    codec:dummyCodec,timeoutMs:60000}),/설정/);
});


test('discovered public call server is checked with TLS only, never VOX payload',async()=>{
  let requests=0,handshakes=0,closed=0;
  const result=await probeSyntheticDiscovery({
    execute:true,codec:dummyCodec,
    connect:async()=>({
      request:async method=>{
        assert.equal(method,30000);requests++;
        return {callable:1,csSslAddr:{ip:0x01020304,port:995}};
      },
      close(){closed++;},
    }),
    verifyCallServerTls:async target=>{
      handshakes++;
      assert.deepEqual(target,{
        host:'1.2.3.4',port:995,servername:'kakao.com',timeoutMs:3500,
      });
      return {status:'tls_verified',certificateVerified:true,tlsVersion:'TLSv1.3'};
    },
  });
  assert.equal(requests,1);
  assert.equal(handshakes,1);
  assert.equal(closed,1);
  assert.equal(result.callable,'permitted');
  assert.equal(result.validCallServerAddress,true);
  assert.equal(result.callServerTlsStatus,'tls_verified');
  assert.equal(result.voxServerAuthenticated,false);
  assert.equal(result.voiceRoomCreated,false);
  assert.equal(JSON.stringify(result).includes('1.2.3.4'),false);
});

test('private address in 30000 result is never contacted',async()=>{
  let handshakes=0;
  const result=await probeSyntheticDiscovery({
    execute:true,codec:dummyCodec,
    connect:async()=>({
      request:async()=>({callable:1,csSslAddr:{ip:0x7f000001,port:995}}),
      close(){},
    }),
    verifyCallServerTls:async()=>{handshakes++;throw Error('no private network');},
  });
  assert.equal(handshakes,0);
  assert.equal(result.callServerTlsStatus,'blocked_nonpublic_ipv4');
});

test('certificate failure at discovered endpoint never authenticates VOX',async()=>{
  const result=await probeSyntheticDiscovery({
    execute:true,codec:dummyCodec,
    connect:async()=>({
      request:async()=>({callable:1,csSslAddr:{ip:0x01020304,port:995}}),
      close(){},
    }),
    verifyCallServerTls:async()=>({
      status:'certificate_name_mismatch',certificateVerified:false,
    }),
  });
  assert.equal(result.callServerTlsStatus,'certificate_name_mismatch');
  assert.equal(result.voxServerAuthenticated,false);
});
