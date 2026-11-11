'use strict';

// A one-shot, synthetic, UNAUTHENTICATED method-30000 framing probe.
// The endpoint is a candidate Kakao TLS host, NOT verified as a VOX server.
// This is never loaded by the Railway bot and never reads auth.json/env secrets.
// A command-line --execute-once flag is required for any network I/O.
const {createCodec,voxConnect,getDiscoveryBody,parseServerAddress,METHODS}=require('../../shared/vox30-protocol');
const {tlsPreflight}=require('../../scripts/vox30-tls-probe');
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

const isPublicIpv4=host=>{
  const octets=host.split('.').map(Number);
  if(octets.length!==4||octets.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
  const [a,b,c]=octets;
  return !(a===0||a===10||a===127||a>=224||
    (a===100&&b>=64&&b<=127)||(a===169&&b===254)||
    (a===172&&b>=16&&b<=31)||(a===192&&b===168)||
    (a===192&&b===0)||(a===198&&(b===18||b===19))||
    (a===192&&b===0&&c===2)||(a===198&&b===51&&c===100)||
    (a===203&&b===0&&c===113));
};


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
  execute=false,connect=voxConnect,codec,verifyCallServerTls=tlsPreflight,
  timeoutMs=3500,
}={}) {
  if(execute!==true)return report('blocked_requires_explicit_execute');
  if(typeof connect!=='function'||typeof verifyCallServerTls!=='function'||
     !Number.isInteger(timeoutMs)||
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
    // Follow only a syntactically valid public IPv4 result from the
    // TLS-verified discovery response. The follow-up sends TLS ClientHello
    // ONLY and does not send VOX payloads, IDs, SDP or credentials.
    let callServerTlsStatus='not_checked';
    let validCallServerAddress=false;
    if(callable==='permitted'){
      try{
        const target=parseServerAddress(reply);
        validCallServerAddress=isPublicIpv4(target.host);
        if(validCallServerAddress){
          const tlsResult=await verifyCallServerTls({
            host:target.host,port:target.port,servername:'kakao.com',timeoutMs,
          });
          callServerTlsStatus=tlsResult?.certificateVerified===true?
            'tls_verified':String(tlsResult?.status||'unknown').slice(0,60);
        }else{
          callServerTlsStatus='blocked_nonpublic_ipv4';
        }
      }catch{
        callServerTlsStatus='invalid_or_unverified_call_server';
      }
    }
    return report('matching_bson_frame_received',{
      hasCallableField:reply?.callable!==undefined,
      callable,
      hasServerAddressField:reply?.csSslAddr!==undefined,
      serverAddressObject:reply?.csSslAddr!==null &&
        typeof reply?.csSslAddr==='object',
      hasOuterPortField:reply?.csSslPort!==undefined,
      hasNestedPortField:reply?.csSslAddr?.port!==undefined,
      hasServerIpv4Field:reply?.csSslAddr?.ip!==undefined,
      validCallServerAddress,callServerTlsStatus,
    });
  } catch(error) {
    return report(outcome(error));
  } finally {
    socket?.close?.();
  }
}

// Branch-only differential experiment. Each variant opens a fresh TLS session.
async function runFieldOmissions() {
  const codec=createCodec({seed:seedCbcBytes()});
  const variants=['control-before','model','osver','buildId','carrierId',
    'devInfo','all-four','control-after'];
  for(const [index,variant] of variants.entries()){
    const syntheticId=String(BigInt(SYNTHETIC_ID)-100n-BigInt(index));
    const body=getDiscoveryBody({...CFG,userId:syntheticId},syntheticId,'26.3.1');
    if(['model','osver','buildId'].includes(variant))delete body.devInfo[variant];
    if(variant==='carrierId'||variant==='all-four')delete body.carrierId;
    if(variant==='devInfo')delete body.devInfo;
    if(variant==='all-four'){
      delete body.devInfo.model;
      delete body.devInfo.osver;
      delete body.devInfo.buildId;
    }
    let socket;
    let result;
    try{
      socket=await voxConnect({...CANDIDATE,timeoutMs:5000,codec});
      const reply=await socket.request(METHODS.DISCOVER,body);
      const callable=String(reply.callable??'missing');
      let validServerAddress=false;
      try{validServerAddress=isPublicIpv4(parseServerAddress(reply).host);}catch{}
      result={status:'reply',callable:callable==='0'||callable==='1'?callable:'other',
        validServerAddress};
    }catch(error){
      const match=/^VOX 응답 거절: method=30000 resCode=(-?\d+)$/.exec(error.message);
      result={status:outcome(error),...(match?{resCode:Number(match[1])}:{})};
    }finally{socket?.close();}
    process.stdout.write('[VOX field omission] '+JSON.stringify({variant,...result})+'\n');
    if(index<variants.length-1)await new Promise(resolve=>setTimeout(resolve,2000));
  }
}

if(require.main===module) {
  const execute=process.argv.length===3&&process.argv[2]==='--execute-once';
  if(!execute)process.exitCode=2;
  else runFieldOmissions().catch(()=>{
    process.stdout.write('[VOX synthetic discovery] initialization_error (no credential data logged)\n');
    process.exitCode=1;
  });
}

module.exports={probeSyntheticDiscovery,SYNTHETIC_ID,CANDIDATE,CFG,outcome,isPublicIpv4};
