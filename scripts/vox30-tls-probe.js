'use strict';

// A VOX *candidate* transport probe. Sends TLS ClientHello ONLY.
// Never sends an OAuth token, BSON, a VOX method, or even application data.
// Not a proof that the endpoint belongs to KakaoTalk's voice-room service.
const tls=require('node:tls');
const net=require('node:net');

function validateTarget({host,port,servername,timeoutMs=6000}) {
  if(typeof host!=='string'||host.length<3||host.length>253||
      !(net.isIP(host) || /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(host)) ||
      host.includes('..'))
    throw Error('VOX 시험 대상은 정확한 IP 또는 DNS 이름이어야 합니다.');
  if(!Number.isInteger(port)||port<1||port>65535)
    throw Error('VOX 시험 포트 범위 오류');
  if(servername!==undefined &&
     (typeof servername!=='string'||net.isIP(servername)||
       !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(servername)||
       servername.includes('..')))
    throw Error('TLS 서버 이름은 유효한 DNS 이름이어야 합니다.');
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>15000)
    throw Error('VOX TLS 시험 제한 시간 오류');
  return {host,port,servername,timeoutMs};
}

function classifyTlsError(error) {
  switch(error?.code){
    case 'ERR_TLS_CERT_ALTNAME_INVALID': return 'certificate_name_mismatch';
    case 'CERT_HAS_EXPIRED': return 'certificate_expired';
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT': return 'certificate_untrusted';
    case 'ECONNREFUSED': return 'connection_refused';
    case 'ENETUNREACH':
    case 'EHOSTUNREACH': return 'network_unreachable';
    case 'ETIMEDOUT': return 'timeout';
    case 'EPROTO':
    case 'ERR_SSL_WRONG_VERSION_NUMBER':
    case 'ERR_SSL_TLSV1_ALERT_PROTOCOL_VERSION': return 'tls_protocol_failure';
    default: return 'tls_connection_failed';
  }
}

function tlsPreflight(options={},tlsConnect=tls.connect){
  const {host,port,servername,timeoutMs}=validateTarget(options);
  if(typeof tlsConnect!=='function')throw Error('TLS 연결 구현이 필요합니다.');
  return new Promise(resolve=>{
    let socket,timer,done=false;
    const finish=(status,tlsVersion=null)=>{
      if(done)return;
      done=true;
      clearTimeout(timer);
      socket?.destroy?.();
      // Do not include certificates, application data, tokens, or network
      // addresses in log records. A valid TLS handshake ≠ VOX login.
      resolve({status,tlsVersion,certificateVerified:status==='tls_verified',
        voxServerAuthenticated:false,voiceRoomCreated:false});
    };
    try{
      socket=tlsConnect({
        host,port,
        // Do not weaken TLS security to accommodate old reverse engineering.
        rejectUnauthorized:true,minVersion:'TLSv1.2',
        ...(servername?{servername}:{}),
      });
      socket.once('secureConnect',()=>{
        if(socket.authorized!==true){
          finish('certificate_untrusted');return;
        }
        finish('tls_verified',typeof socket.getProtocol==='function'?
          socket.getProtocol():null);
      });
      socket.once('error',error=>finish(classifyTlsError(error)));
      socket.once('close',()=>finish('connection_closed'));
      timer=setTimeout(()=>finish('timeout'),timeoutMs);
      // Keep the timeout referenced so a timed-out probe always reports a result.
    }catch(error){finish(classifyTlsError(error));}
  });
}

if(require.main===module){
  // A fixed candidate address from a user-provided sample, NOT a confirmed
  // VOX destination. No credentials or package secrets are ever loaded.
  tlsPreflight({host:'211.242.12.121',port:9282,timeoutMs:6000})
    .then(result=>{
      process.stdout.write('[VOX TLS candidate probe] '+JSON.stringify(result)+'\n');
    })
    .catch(()=>{process.stdout.write('[VOX TLS candidate probe] invalid probe configuration\n');process.exitCode=1;});
}
module.exports={validateTarget,classifyTlsError,tlsPreflight};
