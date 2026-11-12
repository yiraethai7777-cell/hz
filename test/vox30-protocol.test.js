'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const EventEmitter=require('node:events');
const {
  METHODS,I32,I64,integer,pkcs7Pad,pkcs7Unpad,createCodec,
  parseServerAddress,voxConnect,getDiscoveryBody,getCreateBody,
  getCallServer,createVoiceRoom,checkedAppVersion,
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
      if(method!==METHODS.DISCOVER)throw Error('11028 ACK is not required');
      return {callable:1,csSslAddr:{ip:0x01020304},csSslPort:995};
    },
    send:async(method,body)=>{recorded.push(method);},
    wait:(...methods)=>{
      recorded.push(methods.join(','));
      return {promise:Promise.resolve({method:METHODS.CREATED,
        body:{callId:'c1',csId:'s1',sdp:{sdp:'answer',sdpType:2}}}),cancel(){}};
    },
  };
  const connect=async()=>client;
  const address=await getCallServer({cfg,chatId:ROOM,entryHost:'entry.example',
    connect,codec,appVer:'26.3.1'});
  assert.deepEqual(address,{host:'1.2.3.4',port:995});
  const result=await createVoiceRoom({cfg,chatId:ROOM,title:'테스트',
    oauthToken:'test-token',deviceUuid:'device-uuid',sdp,
    entryHost:'entry.example',connect,codec,appVer:'26.3.1'});
  assert.equal(result.requestAccepted,true);
  assert.equal(result.verified,false);
  assert.equal(result.callId,'c1');
  assert.deepEqual(result.remoteSdp,{sdp:'answer',sdpType:2});
  assert.deepEqual(recorded.filter(x=>typeof x==='number'),[
    METHODS.DISCOVER,METHODS.DISCOVER,METHODS.CREATE,METHODS.CREATED]);
  result.conn.close();
});

for(const ackFirst of [true,false]) {
  test('reads session IDs from 11028 with '+(ackFirst?'ACK':'event')+' first',async()=>{
    const waiters=new Map();
    const remoteSdp={sdp:'answer',sdpType:2};
    const client={
      close(){},
      request:async()=>({callable:1,csSslAddr:{ip:0x01020304},csSslPort:995}),
      wait(...methods){
        return {promise:new Promise(resolve=>{
          for(const method of methods)waiters.set(method,resolve);
        }),cancel(){}};
      },
      async send(method,body,requestNonce){
        if(method===METHODS.CREATED){
          assert.equal(integer(body.resCode),0);
          assert.deepEqual(requestNonce,Buffer.from([1,2,3,4]));
          return;
        }
        assert.equal(method,METHODS.CREATE);
        const reply={method:METHODS.CREATE,body:{resCode:0,callId:'c1',csId:'s1'}};
        const event={method:METHODS.CREATED,requestNonce:Buffer.from([1,2,3,4]),body:{sdp:remoteSdp}};
        const packets=ackFirst?[reply,event]:[event,reply];
        for(const packet of packets){
          waiters.get(packet.method)(packet);
          await new Promise(resolve=>setImmediate(resolve));
        }
      },
    };
    const result=await createVoiceRoom({cfg,chatId:ROOM,title:'테스트',
      oauthToken:'token',deviceUuid:'uuid',sdp,entryHost:'entry.example',
      appVer:'26.3.1',connect:async()=>client,codec});
    assert.equal(result.callId,'c1');
    assert.equal(result.csId,'s1');
    assert.deepEqual(result.remoteSdp,remoteSdp);
    assert.equal(result.verified,false);
  });
}

test('VOX refusal closes the connection, never marks verified',async()=>{
  let closed=0;
  const client={
    close(){closed++},
    request:async method=>method===METHODS.DISCOVER?
      {callable:1,csSslAddr:{ip:0x01020304},csSslPort:995}:
      Promise.reject(Error('Unexpected request')), 
    send:async()=>{},
    wait:()=>({promise:Promise.resolve({method:METHODS.REJECTED,body:{reason:7}}),
      cancel(){}}),
  };
  await assert.rejects(()=>createVoiceRoom({cfg,chatId:ROOM,title:'테스트',
    oauthToken:'token',deviceUuid:'uuid',sdp,entryHost:'entry.example',appVer:'26.3.1',
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

test('create and discovery fail before any network when app version is implicit',async()=>{
  let attempts=0;
  const neverConnect=async()=>{attempts++;throw Error('must not connect');};
  assert.throws(()=>getDiscoveryBody(cfg,ROOM),/앱 버전/);
  assert.throws(()=>getCreateBody({cfg,chatId:ROOM,title:'x',oauthToken:'token',
    deviceUuid:'uuid',sdp}),/앱 버전/);
  await assert.rejects(()=>getCallServer({cfg,chatId:ROOM,entryHost:'entry.example',
    connect:neverConnect,codec}),/앱 버전/);
  await assert.rejects(()=>createVoiceRoom({cfg,chatId:ROOM,title:'x',
    oauthToken:'token',deviceUuid:'uuid',sdp,entryHost:'entry.example',
    connect:neverConnect,codec}),/앱 버전/);
  assert.equal(attempts,0);
  assert.throws(()=>checkedAppVersion('26.1.2\nOAuth'),/앱 버전/);
});

test('profile-free discovery and create omit device and carrier fields on the wire',()=>{
  const cfg={userId:USER};
  const discovery=codec.parse(codec.frame(METHODS.DISCOVER,getDiscoveryBody(cfg,ROOM,'26.3.1'))).body;
  assert.equal(Object.hasOwn(discovery,'devInfo'),false);
  assert.equal(Object.hasOwn(discovery,'carrierId'),false);
  const create=codec.parse(codec.frame(METHODS.CREATE,getCreateBody({
    cfg,chatId:ROOM,title:'테스트',oauthToken:'token',deviceUuid:'uuid',sdp,appVer:'26.3.1',
  }))).body;
  assert.equal(Object.hasOwn(create,'carrierId'),false);
  assert.equal(Object.hasOwn(create,'simOperator'),false);
  assert.deepEqual(Object.keys(create.devInfo).sort(),['devSubType','os']);
});

test('VOX session sends keepalive and releases on signalling disconnect',async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const messages=[];
  let socketClosed;
  let terminalCallback;
  let mediaCloses=0;
  const whenClosed=new Promise(resolve=>{socketClosed=resolve;});
  const signalling={
    whenClosed,
    close:socketClosed,
    wait(...methods){
      const method=methods[0];
      const body=method===METHODS.CREATED?
        {callId:'1',csId:'2',sdp:{sdp:'answer'}}:{resCode:0};
      return {promise:Promise.resolve({method,body}),cancel(){}};
    },
    async send(method,body){messages.push({method,body});},
  };
  const adapter=createVox30Adapter({
    actorUserId:USER,cfg,codec,entryHost:'entry.example',appVer:'26.3.1',
    credentialsForRoom:async()=>({oauthToken:'token',deviceUuid:'uuid'}),
    verifyMembership:async()=>true,
    rtcFactory:async()=>({
      createOffer:async()=>sdp,applyAnswer:async()=>{},close:async()=>{mediaCloses++;},
    }),
    connect:async({host,onPacket})=>host==='entry.example'?{
      request:async()=>({callable:1,csSslAddr:{ip:0x01020304},csSslPort:995}),close(){},
    }:(terminalCallback=onPacket,signalling),
  });
  await adapter.create({roomId:ROOM,title:'테스트'});
  assert.equal((await adapter.status({roomId:ROOM})).localActive,true);
  t.mock.timers.tick(5000);
  await new Promise(resolve=>setImmediate(resolve));
  t.mock.timers.tick(5000);
  await new Promise(resolve=>setImmediate(resolve));
  for(const {method,body} of messages.slice(2)){
    assert.equal(method,METHODS.PING);
    const wire=codec.parse(codec.frame(method,body)).body;
    assert.deepEqual(Object.keys(wire),[
      'userId','csId','callId','devType','voiceFilter','audioState','videoState','recInfo',
    ]);
    for(const [key,value] of Object.entries({userId:USER,csId:'2',callId:'1'})){
      assert.equal(wire[key]._bsontype,'Long');
      assert.equal(wire[key].toString(),value);
    }
    for(const [key,value] of Object.entries({devType:4,voiceFilter:0,audioState:0,videoState:0})){
      assert.equal(wire[key]._bsontype,'Int32');
      assert.equal(integer(wire[key]),value);
    }
    assert.equal(wire.recInfo.recSessionId._bsontype,'Long');
    assert.equal(wire.recInfo.recordCount._bsontype,'Int32');
    assert.equal(wire.recInfo.recordDuration._bsontype,'Long');
    assert.deepEqual(wire.recInfo.recordIds,[]);
  }
  // The initial keepalive is sent immediately, followed by two scheduled pings.
  assert.equal(messages.length,5);
  assert.equal(typeof terminalCallback,'function');
  terminalCallback({method:11009,status:0,codes:{reason:1002}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(mediaCloses,1);
  assert.equal((await adapter.status({roomId:ROOM})).localActive,false);
  socketClosed(); // Late TCP close must not release the media session twice.
  await new Promise(resolve=>setImmediate(resolve));
  t.mock.timers.tick(30000);
  assert.equal(messages.length,5);
});

test('a VOX response can echo the received nonce without changing the encrypted payload',()=>{
  const requestNonce=Buffer.from([7,8,9,10]);
  const bytes=codec.frame(METHODS.CREATED,{resCode:new I32(0)},requestNonce);
  const packet=codec.parse(bytes);
  assert.deepEqual(bytes.subarray(0,4),requestNonce);
  assert.deepEqual(packet.requestNonce,requestNonce);
  assert.equal(integer(packet.body.resCode),0);
});

test('creation and role events log bounded structures and own member role only',()=>{
  const {packetSummary}=require('../shared/vox30-protocol');
  const personalUserId='123456789012345678';
  const sensitive={
    event:new I32(1),
    members:[
      {userId:'998877665544332211',role:new I32(1),nickname:'private-one'},
      {userId:personalUserId,userType:new I32(3),role:new I32(2),
        isModerator:true,oauthToken:'nested-private-token'},
    ],
    vrInfo:{hostId:personalUserId,mode:new I32(1),
      roomTitle:'very-private-room-name',speakerRequestor:[]},
    speakerRequestor:[{userId:'998877665544332211',nickname:'hidden'}],
    oauthToken:'top-private-token',
  };
  const created=packetSummary({method:11028,status:0,body:sensitive},
    {actorUserId:personalUserId});
  assert.deepEqual(created.structures.members.elementKeys,['role','userType','isModerator']);
  assert.equal(created.structures.members.count,2);
  assert.equal(created.structures.vrInfo.kind,'object');
  assert.deepEqual(created.structures.vrInfo.fieldKeys,
    ['mode','speakerRequestor']);
  assert.deepEqual(created.ownMember,{present:true,states:{userType:3,role:2,isModerator:true}});
  const event=packetSummary({method:12011,status:0,body:sensitive},
    {actorUserId:personalUserId});
  assert.equal(event.codes.event,1);
  assert.deepEqual(event.ownMember,created.ownMember);
  for(const result of [created,event]){
    const output=JSON.stringify(result);
    for(const secret of [personalUserId,'998877665544332211','private-one',
        'nested-private-token','very-private-room-name','top-private-token'])
      assert.ok(!output.includes(secret),secret+' leaked');
  }
  assert.equal(packetSummary({method:11028,status:0,
    body:{members:[],vrInfo:{}}}).ownMember,undefined);
});

test('terminal packet summaries expose safe reason codes without IDs or SDP',async()=>{
  const sock=new FakeTls();
  const seen=[];
  const ready=voxConnect({host:'127.0.0.1',port:995,codec,timeoutMs:500,
    onPacket:packet=>seen.push(packet),
    tlsConnect:()=>{queueMicrotask(()=>sock.emit('secureConnect'));return sock;}});
  const conn=await ready;
  sock.emit('data',codec.frame(11009,{reason:new I32(4),callId:'private-id',
    sdp:'private-sdp',token:'private-token'}));
  assert.deepEqual(seen,[{method:11009,status:0,fields:['reason','callId','sdp'],
    codes:{reason:4},otherFields:1}]);
  conn.close();
});

test('VOX role event reports bounded enum codes and field names, never private content',()=>{
  const {packetSummary}=require('../shared/vox30-protocol');
  const data={event:new I32(7),role:new I32(3),
    title:'sensitive title',oauthToken:'super-private-token',
    callId:'123456789',isSpeaker:true,moderatorState:new I32(2),
    userId:'987654',sdp:'private-sdp'};
  const actual=packetSummary({method:12011,status:0,body:data});
  assert.equal(actual.codes.event,7);
  assert.equal(actual.codes.role,3);
  assert.equal(actual.eventValueType,'object');
  assert.deepEqual(actual.safeOtherKeys,['role','isSpeaker','moderatorState']);
  const json=JSON.stringify(actual);
  assert.ok(!json.includes('super-private-token'));
  assert.ok(!json.includes('sensitive title'));
  assert.ok(!json.includes('987654'));
  assert.ok(!json.includes('private-sdp'));
  assert.equal(packetSummary({method:11015,status:0,body:{secret:'bad'}}).fields,undefined);
  assert.equal(packetSummary({method:11009,status:0,body:{reason:new I32(1002)}}).codes.reason,1002);
});
