'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const EventEmitter=require('node:events');
const {
  METHODS,I32,I64,integer,pkcs7Pad,pkcs7Unpad,createCodec,
  parseServerAddress,voxConnect,getDiscoveryBody,getCreateBody,
  getCallServer,createVoiceRoom,
}=require('../shared/vox30-protocol');
const {createVox30Adapter}=require('../shared/vox30-adapter');

const USER='418692594';
const ROOM='18496234145974738';
const cfg={userId:USER,model:'test-model',sdkVersion:'35',
  buildId:'test-build',carrierId:'45008'};
const sdp='v=0\r\no=- 100 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';

// Identity cipher is for framing tests only. No network traffic is sent.
const testSeed={
  encrypt:(buf)=>Buffer.from(buf),
  decrypt:(buf)=>Buffer.from(buf),
};
const codec=createCodec({seed:testSeed,nonce:()=>Buffer.from('01020304','hex')});

test('BSON/SEED frame parses a complete, fragmented, or paired message',()=>{
  const msg=codec.frame(METHODS.CREATE,{chatId:new I64(ROOM),
    num:new I32(4),resCode:new I32(0)});
  assert.equal(msg.subarray(0,4).toString('hex'),'01020304');
  assert.equal(msg.readUInt16LE(6),METHODS.CREATE);
  assert.equal(msg.length,msg.readUInt32LE(8)+12);
  assert.equal(codec.parse(msg).body.chatId.toString(),ROOM);
  assert.equal(integer(codec.parse(msg).body.num),4);
  assert.equal(pkcs7Unpad(pkcs7Pad(Buffer.from('test'))).toString(),'test');
  assert.throws(()=>pkcs7Unpad(Buffer.alloc(16,0)),/패딩/);
  const broken=Buffer.from(msg);
  broken.writeUInt32LE(0xffffffff,8);
  assert.throws(()=>codec.parse(broken),/길이/);
});

test('supplied VOX messages retain BSON numeric types and device fields',()=>{
  const d=getDiscoveryBody(cfg,ROOM,'26.3.1');
  assert.equal(d.chatId.toString(),ROOM);
  assert.equal(integer(d.devType),4);
  assert.equal(integer(d.voxVer),5);
  const c=getCreateBody({cfg,chatId:ROOM,title:'테스트',oauthToken:'token',
    deviceUuid:'device-uuid',sdp,appVer:'26.3.1'});
  assert.equal(c.sdp.sdp,sdp);
  assert.equal(integer(c.userType),1);
  assert.equal(integer(c.devInfo.devSubType),7);
  assert.equal(c.destId.toString(),'0');
  assert.throws(()=>getCreateBody({cfg,chatId:ROOM,title:'x',oauthToken:'',
    deviceUuid:'device-uuid',sdp,appVer:'26.3.1'}),/토큰/);
});

test('entry address parsing handles signed IPv4 and validates ports',()=>{
  assert.deepEqual(parseServerAddress({callable:1,
    csSslAddr:{ip:-1062731519},csSslPort:995}),{host:'192.168.1.1',port:995});
  assert.throws(()=>parseServerAddress({callable:0,csSslAddr:{ip:123},csSslPort:995}),/거절/);
  assert.throws(()=>parseServerAddress({callable:1,csSslAddr:{ip:0},csSslPort:995}),/주소/);
});

class FakeTls extends EventEmitter {
  constructor(){
    super();this.authorized=true;this.destroyed=false;
  }
  write(bytes,cb){
    this.last=bytes;
    // Emulate TLS fragments arriving across multiple data callbacks.
    const response=codec.frame(bytes.readUInt16LE(6),{resCode:new I32(0),reply:'ok'});
    queueMicrotask(()=>{
      this.emit('data',response.subarray(0,5));
      this.emit('data',response.subarray(5));
    });
    queueMicrotask(()=>cb());
    return true;
  }
  destroy(){
    if(this.destroyed)return;
    this.destroyed=true;this.emit('close');
  }
}

test('VOX TLS transport verifies certificates and handles split response frames',async()=>{
  let seen=null;
  const sock=new FakeTls();
  const ready=voxConnect({host:'127.0.0.1',port:995,codec,timeoutMs:500,
    tlsConnect:opts=>{seen=opts;queueMicrotask(()=>sock.emit('secureConnect'));return sock;}});
  const conn=await ready;
  assert.equal(seen.rejectUnauthorized,true);
  assert.equal((await conn.request(METHODS.DISCOVER,{a:1})).reply,'ok');
  conn.close();
});

test('the discovery and create sequence follows 30000 then 11028 and event 11003',async()=>{
  const recorded=[];
  const client={
    close(){recorded.push('close')},
    request:async(method,body)=>{
      recorded.push(method);
      return method===METHODS.DISCOVER ?
        {callable:1,csSslAddr:{ip:0x01020304},csSslPort:995} :
        {callId:'c1',csId:'s1',resCode:0};
    },
    wait:(...methods)=>{
      recorded.push(methods.join(','));
      return {promise:Promise.resolve({method:METHODS.CREATED,
        body:{sdp:{sdp:'answer',sdpType:2}}}),cancel(){}};
    },
  };
  const connect=async()=>client;
  const address=await getCallServer({cfg,chatId:ROOM,entryHost:'entry.example',
    connect,codec});
  assert.deepEqual(address,{host:'1.2.3.4',port:995});
  const result=await createVoiceRoom({cfg,chatId:ROOM,title:'테스트',
    oauthToken:'test-token',deviceUuid:'device-uuid',sdp,
    entryHost:'entry.example',connect,codec});
  assert.equal(result.requestAccepted,true);
  assert.equal(result.verified,false);
  assert.equal(result.callId,'c1');
  assert.deepEqual(result.remoteSdp,{sdp:'answer',sdpType:2});
  assert.deepEqual(recorded.filter(x=>typeof x==='number'),[
    METHODS.DISCOVER,METHODS.DISCOVER,METHODS.CREATE]);
  result.conn.close();
});

test('VOX refusal closes the connection, never marks verified',async()=>{
  let closed=0;
  const client={
    close(){closed++},
    request:async method=>method===METHODS.DISCOVER?
      {callable:1,csSslAddr:{ip:0x01020304},csSslPort:995}:
      {callId:'no'},
    wait:()=>({promise:Promise.resolve({method:METHODS.REJECTED,body:{reason:7}}),
      cancel(){}}),
  };
  await assert.rejects(()=>createVoiceRoom({cfg,chatId:ROOM,title:'테스트',
    oauthToken:'token',deviceUuid:'uuid',sdp,entryHost:'entry.example',
    connect:async()=>client,codec}),/거절/);
  assert.equal(closed,2);
});

test('VOX adapter fails closed when it lacks real WebRTC or credentials',async()=>{
  assert.throws(()=>createVox30Adapter({actorUserId:USER,cfg,entryHost:'entry.example',codec}),
    /구현체/);
  const adapter=createVox30Adapter({actorUserId:USER,cfg,entryHost:'entry.example',codec,
    credentialsForRoom:async()=>({oauthToken:'token',deviceUuid:'uuid'}),
    verifyMembership:async()=>true,rtcFactory:async()=>({close(){}})});
  await assert.rejects(()=>adapter.create({roomId:ROOM,title:'테스트'}),/WebRTC/);
  assert.equal((await adapter.status({roomId:ROOM})).localActive,false);
  await adapter.dispose();
});
