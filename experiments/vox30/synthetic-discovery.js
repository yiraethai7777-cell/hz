'use strict';

// A one-shot, synthetic, UNAUTHENTICATED method-30000 framing probe.
// The endpoint is a candidate Kakao TLS host, NOT verified as a VOX server.
// This is never loaded by the Railway bot and never reads auth.json/env secrets.
// A command-line --execute-once flag is required for any network I/O.
const {createCodec,voxConnect,getDiscoveryBody,METHODS}=require('../../shared/vox30-protocol');
const {seedCbcBytes}=require('./seed');

const SYNTHETIC_ID='9223372036854775806';
const CANDIDATE=Object.freeze({
  host:'211.242.12.121',
  port:9282,
  servername:'kakao.com',
});
const CFG=Object.freeze({
  userId:SYNTHETIC_ID,
  carrierId:'00000',
  model:'SYNTHETIC_VOX_TEST',
  sdkVersion:'0',
  buildId:'NO_REAL_DEVICE',
});
const MAX_PROBE_TIMEOUT_MS=5000;

function outcome(error) {
  const message=String(error?.message||'');
  if(message.startsWith('VOX 응답 거절:'))return 'parsed_bson_rejection';
  if(message.includes('VOX 서버 응답 시간 초과'))return 'no_matching_method_response';
  if(message.includes('VOX 연결 종료'))return 'connection_closed_after_request';
  if(message.includes('VOX TLS 인증서 검증 실패'))return 'tls_certificate_rejected';
  if(message.includes('VOX TLS 연결 시간 초과'))return 'tls_timeout';
  if(message.includes('VOX TLS 연결 실패'))return 'tls_connect_failed';
  if(message.includes('VOX 수신')||message.includes('BSON')||
      message.includes('복호화'))return 'unrecognized_protocol_frame';
  return 'probe_inconclusive';
}

function report(status,detail={}) {
  // Never include raw server replies, tokens, IPs, user IDs, or device data.
  return Object.freeze({
    status,
    ...detail,
    realAccountUsed:false,
    oauthSent:false,
    createRequestSent:false,
    voxServerAuthenticated:false,
    voiceRoomCreated:false,
  });
}

async function probeSyntheticDiscovery({
  execute=false,connect=voxConnect,codec,
  timeoutMs=3500,
}={}) {
  if(execute!==true)return report('blocked_requires_explicit_execute');
  if(typeof connect!=='function'||!Number.isInteger(timeoutMs)||
     timeoutMs<100||timeoutMs>MAX_PROBE_TIMEOUT_MS)
    throw Error('잘못된 실험 연결 설정입니다.');
  const encryptedCodec=codec||createCodec({seed:seedCbcBytes()});
  let socket;
  try {
    socket=await connect({
      ...CANDIDATE,timeoutMs,
      codec:encryptedCodec,
    });
    const requestBody=getDiscoveryBody(CFG,SYNTHETIC_ID,'26.3.1');
    const reply=await socket.request(METHODS.DISCOVER,requestBody);
    let callable='unknown';
    try {
      const number=Number(reply?.callable?.toString());
      callable=number===1?'permitted':number===0?'denied':'unexpected';
    }catch {}
    return report('matching_bson_frame_received',{
      hasCallableField:reply?.callable!==undefined,
      callable,
      hasServerAddressField:reply?.csSslAddr!==undefined,
      serverAddressObject:reply?.csSslAddr!==null &&
        typeof reply?.csSslAddr==='object',
      hasOuterPortField:reply?.csSslPort!==undefined,
      hasNestedPortField:reply?.csSslAddr?.port!==undefined,
      hasServerIpv4Field:reply?.csSslAddr?.ip!==undefined,
    });
  } catch(error) {
    return report(outcome(error));
  } finally {
    socket?.close?.();
  }
}

if(require.main===module) {
  const execute=process.argv.length===3&&process.argv[2]==='--execute-once';
  probeSyntheticDiscovery({execute}).then(result=>{
    process.stdout.write('[VOX synthetic discovery] '+JSON.stringify(result)+'\n');
    if(!execute)process.exitCode=2;
  }).catch(()=>{
    process.stdout.write('[VOX synthetic discovery] initialization_error (no credential data logged)\n');
    process.exitCode=1;
  });
}

module.exports={probeSyntheticDiscovery,SYNTHETIC_ID,CANDIDATE,CFG,outcome};
