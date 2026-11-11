'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {tlsPreflight,validateTarget,classifyTlsError}=require('../scripts/vox30-tls-probe');

class FakeSocket extends EventEmitter {
  constructor(){super();this.authorized=false;this.destroyed=false;this.writes=0;}
  getProtocol(){return 'TLSv1.3';}
  write(){this.writes++;throw Error('application data MUST NOT be sent');}
  destroy(){this.destroyed=true;}
}

test('TLS target validation refuses malformed destinations',()=>{
  assert.throws(()=>validateTarget({host:'127.0.0.1:9282',port:9282}),/정확한 IP/);
  assert.throws(()=>validateTarget({host:'test.example',port:0}),/포트/);
  assert.throws(()=>validateTarget({host:'test.example',port:9282,servername:'127.0.0.1'}),/DNS/);
  assert.throws(()=>validateTarget({host:'test.example',port:9282,timeoutMs:99999}),/시간/);
  assert.equal(validateTarget({host:'211.242.12.121',port:9282}).port,9282);
});

test('probe sends ClientHello only, requires certificate validation and >=TLS1.2',async()=>{
  const socket=new FakeSocket();let opts;
  const result=await tlsPreflight({host:'211.242.12.121',port:9282,servername:'vox.example.test'},
    incoming=>{
      opts=incoming;
      queueMicrotask(()=>{socket.authorized=true;socket.emit('secureConnect');});
      return socket;
    });
  assert.equal(opts.rejectUnauthorized,true);
  assert.equal(opts.minVersion,'TLSv1.2');
  assert.equal(opts.servername,'vox.example.test');
  assert.equal(socket.writes,0);
  assert.equal(socket.destroyed,true);
  assert.deepEqual(result,{status:'tls_verified',tlsVersion:'TLSv1.3',
    certificateVerified:true,certificateNames:[],voxServerAuthenticated:false,voiceRoomCreated:false});
});

test('certificate mismatch cannot be counted as successful VOX server verification',async()=>{
  const socket=new FakeSocket();
  const result=await tlsPreflight({host:'211.242.12.121',port:9282},()=>{
    queueMicrotask(()=>{
      const err=Error('certificate subject mismatch; should not appear in output');
      err.code='ERR_TLS_CERT_ALTNAME_INVALID';
      err.cert={subjectaltname:'DNS:vox.kakao.com, DNS:*.kakao.com, IP Address:211.242.12.121'};
      socket.emit('error',err);
    });
    return socket;
  });
  assert.equal(result.status,'certificate_name_mismatch');
  assert.equal(result.certificateVerified,false);
  assert.deepEqual(result.certificateNames,['vox.kakao.com','*.kakao.com']);
  assert.equal(result.voxServerAuthenticated,false);
  assert.doesNotMatch(JSON.stringify(result),/should not appear/);
  assert.equal(socket.writes,0);
});

test('missing verified authorization is not treated as TLS success',async()=>{
  const socket=new FakeSocket();
  const result=await tlsPreflight({host:'211.242.12.121',port:9282},()=>{
    queueMicrotask(()=>socket.emit('secureConnect'));
    return socket;
  });
  assert.equal(result.status,'certificate_untrusted');
  assert.equal(result.certificateVerified,false);
});

test('a non-responsive TLS endpoint terminates within the timeout',async()=>{
  const socket=new FakeSocket();
  const result=await tlsPreflight({host:'211.242.12.121',port:9282,timeoutMs:100},
    ()=>socket);
  assert.equal(result.status,'timeout');
  assert.equal(socket.destroyed,true);
});

test('known handshake errors are classified without printing errors or secrets',()=>{
  assert.equal(classifyTlsError({code:'EPROTO',message:'private sensitive data'}),
    'tls_protocol_failure');
  assert.equal(classifyTlsError({code:'UNABLE_TO_VERIFY_LEAF_SIGNATURE'}),
    'certificate_untrusted');
});
