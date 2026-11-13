'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const EventEmitter=require('node:events');
const {
  METHODS,I32,I64,integer,pkcs7Pad,pkcs7Unpad,createCodec,
  parseServerAddress,voxConnect,getDiscoveryBody,getCreateBody,
  getCallServer,createVoiceRoom,getEventAckBody,checkedAppVersion,
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

test('VOX carrier and network fields survive BSON serialization',()=>{
  const discovery=codec.parse(codec.frame(METHODS.DISCOVER,
    getDiscoveryBody(cfg,ROOM,'26.3.1'))).body;
  assert.equal(discovery.carrierId,cfg.carrierId);
  assert.equal(discovery.netType._bsontype,'Int32');
  assert.equal(integer(discovery.netType),2);
  const creation=codec.parse(codec.frame(METHODS.CREATE,getCreateBody({
    cfg,chatId:ROOM,title:'테스트',oauthToken:'test-token',
    deviceUuid:'device-uuid',sdp,appVer:'26.3.1',
  }))).body;
  assert.equal(creation.carrierId,cfg.carrierId);
  assert.equal(creation.simOperator,cfg.carrierId);
  assert.equal(creation.netType._bsontype,'Int32');
  assert.equal(integer(creation.netType),2);
  assert.equal(creation.mobileNetType._bsontype,'Int32');
  assert.equal(integer(creation.mobileNetType),13);
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
        body:{callId:'100',csId:'200',sdp:{sdp:'answer',sdpType:2}}}),cancel(){}};
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
  assert.equal(result.callId,'100');
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
        const reply={method:METHODS.CREATE,body:{resCode:0,callId:'100',csId:'200',
          interval:new I32(30),connTimeout:new I32(20),respTimeout:new I32(15)}};
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
    assert.equal(result.callId,'100');
    assert.equal(result.csId,'200');
    assert.deepEqual(result.serverTiming,{interval:30,connTimeout:20,respTimeout:15});
    assert.deepEqual(result.remoteSdp,remoteSdp);
    assert.equal(result.verified,false);
  });
}

test('VOX 11003-first creation requires independent 11028 acceptance',async()=>{
  const methods=[];
  const waiters=new Map();
  let closed=0;
  const session={
    close(){closed++;},
    request:async()=>({callable:1,csSslAddr:{ip:0x01020304},csSslPort:995}),
    wait(...names){
      let resolve;
      const promise=new Promise(done=>{resolve=done;});
      for(const name of names)waiters.set(name,resolve);
      return {promise,cancel(){}};
    },
    async send(method,body,requestNonce){
      methods.push(method);
      if(method===METHODS.CREATE){
        queueMicrotask(()=>waiters.get(METHODS.CREATED)({
          method:METHODS.CREATED,status:0,
          requestNonce:Buffer.from([1,2,3,4]),
          body:{callId:'1',csId:'2',sdp:{sdp:'v=0\\r\\n'}},
        }));
      }else if(method===METHODS.CREATED){
        assert.equal(integer(body.resCode),0);
        assert.deepEqual(requestNonce,Buffer.from([1,2,3,4]));
        queueMicrotask(()=>waiters.get(METHODS.CREATE)({
          method:METHODS.CREATE,status:0,
          body:{resCode:new I32(63),callId:'1',csId:'2'},
        }));
      }
    },
  };
  await assert.rejects(createVoiceRoom({cfg,chatId:ROOM,title:'테스트',
    oauthToken:'private-auth',deviceUuid:'private-device',sdp,
    entryHost:'entry.example',appVer:'26.3.1',
    connect:async()=>session,codec}),/resCode=63/);
  assert.deepEqual(methods,[METHODS.CREATE,METHODS.CREATED]);
  assert.equal(closed,2);
});

test('VOX 11028 and 11003 must refer to the same call before success',async()=>{
  let closed=0;
  const waiters=new Map();
  const session={
    close(){closed++;},
    request:async()=>({callable:1,csSslAddr:{ip:0x01020304},csSslPort:995}),
    wait(...names){
      let resolve;
      const promise=new Promise(done=>{resolve=done;});
      for(const name of names)waiters.set(name,resolve);
      return {promise,cancel(){}};
    },
    async send(method){
      if(method===METHODS.CREATE)queueMicrotask(()=>{
        waiters.get(METHODS.CREATE)({method:METHODS.CREATE,status:0,
          body:{resCode:new I32(0),callId:'100',csId:'2'}});
        waiters.get(METHODS.CREATED)({method:METHODS.CREATED,status:0,
          requestNonce:Buffer.from([1,2,3,4]),
          body:{callId:'101',csId:'2',sdp:{sdp:'v=0\\r\\n'}}});
      });
    },
  };
  await assert.rejects(createVoiceRoom({cfg,chatId:ROOM,title:'테스트',
    oauthToken:'private-auth',deviceUuid:'private-device',sdp,
    entryHost:'entry.example',appVer:'26.3.1',
    connect:async()=>session,codec}),/식별자가 일치하지 않습니다/);
  assert.equal(closed,2);
});

test('successful VOX creation reports bounded 11003/11028 chronology only',async()=>{
  const waiters=new Map();
  const session={
    close(){},
    request:async()=>({callable:1,csSslAddr:{ip:0x01020304},csSslPort:995}),
    wait(...names){
      let resolve;
      const promise=new Promise(done=>{resolve=done;});
      for(const name of names)waiters.set(name,resolve);
      return {promise,cancel(){}};
    },
    async send(method){
      if(method===METHODS.CREATE)queueMicrotask(()=>{
        waiters.get(METHODS.CREATE)({method:METHODS.CREATE,status:0,
          body:{resCode:new I32(0),callId:'100',csId:'2'}});
        waiters.get(METHODS.CREATED)({method:METHODS.CREATED,status:0,
          requestNonce:Buffer.from([1,2,3,4]),
          body:{callId:'100',csId:'2',sdp:{sdp:'v=0\\r\\n'}}});
      });
    },
  };
  const result=await createVoiceRoom({cfg,chatId:ROOM,title:'테스트',
    oauthToken:'private-auth',deviceUuid:'private-device',sdp,
    entryHost:'entry.example',appVer:'26.3.1',
    connect:async()=>session,codec});
  assert.equal(result.signaling.replyVerified,true);
  assert.equal(result.signaling.idsConsistent,true);
  assert.equal(result.signaling.ackUsesServerNonce,true);
  for(const key of ['createReplyMs','createdEventMs','createdAckSentMs'])
    assert.ok(Number.isSafeInteger(result.signaling[key]) &&
      result.signaling[key]>=0 && result.signaling[key]<60000);
  const output=JSON.stringify(result.signaling);
  for(const secret of ['private-auth','private-device',ROOM,'100','v=0'])
    assert.ok(!output.includes('"'+secret+'"'));
  result.conn.close();
});


test('reference VOX event acknowledgements include actor and call identity for 11003 and 12011',async()=>{
  const waiters=new Map(),messages=[];
  let incoming;
  const callServer={
    close(){},
    wait(...methods){
      let resolve;const promise=new Promise(done=>{resolve=done;});
      for(const method of methods)waiters.set(method,resolve);
      return {promise,cancel(){}};
    },
    async send(method,body,nonce){
      messages.push({method,body,nonce});
      if(method!==METHODS.CREATE)return;
      queueMicrotask(()=>{
        // An early room event may arrive before the creation ACK.
        incoming({method:METHODS.ROOM_EVENT,status:0,fields:['event'],
          codes:{event:1},memberGroups:{listeners:{own:'present'}}});
        waiters.get(METHODS.CREATE)({method:METHODS.CREATE,status:0,
          body:{resCode:new I32(0),callId:'100',csId:'2'}});
        waiters.get(METHODS.CREATED)({method:METHODS.CREATED,status:0,
          requestNonce:Buffer.from([9,8,7,6]),
          body:{callId:'100',csId:'2',sdp:{sdp:'v=0\r\n'}}});
      });
    },
  };
  const connect=async ({host,onPacket})=>{
    if(host==='entry.example')return {
      close(){},request:async()=>({callable:1,csSslAddr:{ip:0x01020304},csSslPort:995}),
    };
    incoming=onPacket;return callServer;
  };
  const result=await createVoiceRoom({cfg,chatId:ROOM,title:'테스트',
    oauthToken:'private',deviceUuid:'private-uuid',sdp,
    entryHost:'entry.example',appVer:'26.3.1',codec,connect});
  const acks=messages.filter(x=>x.method===METHODS.CREATED||x.method===METHODS.ROOM_EVENT);
  assert.deepEqual(acks.map(x=>x.method),[METHODS.CREATED,METHODS.ROOM_EVENT]);
  for(const ack of acks){
    const wire=codec.parse(codec.frame(ack.method,ack.body)).body;
    assert.deepEqual(Object.keys(wire),['userId','callId','resCode','devType']);
    assert.equal(wire.userId.toString(),USER);
    assert.equal(wire.callId.toString(),'100');
    assert.equal(integer(wire.devType),4);
    assert.equal(integer(wire.resCode),0);
  }
  assert.deepEqual(acks[0].nonce,Buffer.from([9,8,7,6]));
  // A late server roster is also acknowledged.
  incoming({method:METHODS.ROOM_EVENT,status:0,fields:['event'],codes:{event:2}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(messages.filter(x=>x.method===METHODS.ROOM_EVENT).length,2);
  // But a reply with just a resCode must NOT trigger endless ACK loops.
  incoming({method:METHODS.ROOM_EVENT,status:0,fields:['resCode'],codes:{resCode:0}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(messages.filter(x=>x.method===METHODS.ROOM_EVENT).length,2);
  assert.equal(result.signaling.eventAckIdentityFields,true);
  assert.equal(result.signaling.roomEventAcksAtCreate,1);
});

test('VOX event ACK identity rejects missing call ID',()=>{
  assert.throws(()=>getEventAckBody(cfg,'0'),/ID/);
  const packet=codec.parse(codec.frame(METHODS.CREATED,getEventAckBody(cfg,'100')));
  assert.equal(packet.body.userId.toString(),USER);
  assert.equal(packet.body.callId.toString(),'100');
});

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
  assert.deepEqual(created.structures.members.elementKeys,['role','isModerator']);
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

test('VOX 12011 type/full envelope reveals bounded format without guessing roles',()=>{
  const {packetSummary}=require('../shared/vox30-protocol');
  const actor='123456789012345678';
  const outsider='923456789012345678';
  const list={type:new I32(2),full:[
    {userId:outsider,role:new I32(1),name:'some private name'},
    {userId:actor,role:new I32(3),isHost:true,oauthToken:'private-token'},
  ]};
  const decoded=codec.parse(codec.frame(12011,{
    event:new I32(1),members:list,
  })).body;
  const summary=packetSummary({method:12011,status:0,body:decoded},
    {actorUserId:actor});
  assert.deepEqual(summary.memberEnvelope,{
    kind:'type-full',full:{kind:'array',count:2,
      elementKeys:['role','isHost']},typeCode:2,
  });
  assert.deepEqual(summary.ownMember,{
    present:true,states:{role:3,isHost:true},
  });
  // A type/full event can be just a flag; never mislabel it as a roster.
  const flag=packetSummary({method:12011,status:0,body:{
    members:{type:new I32(1),full:true},
  }},{actorUserId:actor});
  assert.deepEqual(flag.memberEnvelope,{
    kind:'type-full',full:{kind:'boolean'},typeCode:1,fullFlag:true,
  });
  assert.equal(flag.ownMember,undefined);
  const nested=packetSummary({method:12011,status:0,body:{
    members:{type:new I32(4),full:{speakers:{[actor]:{
      userType:new I32(3),isModerator:true,name:'private',
    }}}},
  }},{actorUserId:actor});
  assert.deepEqual(nested.ownMember,{
    present:true,states:{userType:3,isModerator:true},
  });
  const absent=packetSummary({method:12011,status:0,body:{
    members:{type:new I32(4),full:{speakers:{[outsider]:{
      role:new I32(1)}}}},
  }},{actorUserId:actor});
  assert.equal(absent.ownMember,undefined);
  for(const obj of [summary,flag,nested,absent]){
    const serialized=JSON.stringify(obj);
    for(const sensitive of [actor,outsider,'private-token','some private name',
      'private'])assert.ok(!serialized.includes(sensitive),'sensitive VOX data leaked');
  }
});

test('VOX moderator/speaker/listener groups expose only own placement',()=>{
  const {packetSummary}=require('../shared/vox30-protocol');
  const actor='123456789012345678',other='923456789012345678';
  const event={
    event:new I32(1),
    members:{type:new I32(1),full:{
      currRevision:new I64('32'),
      moderators:[{userId:actor,userType:new I32(2),isModerator:true,
        nickname:'private-admin'}],
      speakers:[{userId:other,userType:new I32(1)}],
      listeners:[new I64(other)],
    }},
  };
  const wire=codec.parse(codec.frame(12011,event)).body;
  const actual=packetSummary({method:12011,status:0,body:wire},
    {actorUserId:actor});
  assert.equal(actual.memberGroups.moderators.own,'present');
  assert.deepEqual(actual.memberGroups.moderators.ownStates,
    {userType:2,isModerator:true});
  assert.equal(actual.memberGroups.speakers.own,'not_observed');
  assert.equal(actual.memberGroups.listeners.own,'not_observed');
  assert.equal(actual.memberGroups.listeners.shape.kind,'array');
  const log=JSON.stringify(actual);
  for(const privateValue of [actor,other,'private-admin'])
    assert.ok(!log.includes(privateValue));
});
test('VOX role detection handles ID-keyed maps, bare Long IDs and incomplete rosters',()=>{
  const {packetSummary}=require('../shared/vox30-protocol');
  const actor='123456789012345678',other='923456789012345678';
  const packet={method:12011,status:0,body:{members:{
    type:new I32(1),
    full:{
      moderators:{[other]:{userType:new I32(3)}},
      speakers:[new I64(actor)],
      listeners:{members:{[actor]:{userType:new I32(1),role:new I32(9)}}},
    },
  }}};
  const actual=packetSummary(packet,{actorUserId:actor});
  assert.equal(actual.memberGroups.moderators.own,'not_observed');
  assert.equal(actual.memberGroups.speakers.own,'present');
  assert.equal(actual.memberGroups.listeners.own,'present');
  assert.deepEqual(actual.memberGroups.listeners.ownStates,{userType:1,role:9});
  assert.ok(!JSON.stringify(actual).includes(actor));
  assert.ok(!JSON.stringify(actual).includes(other));
  const noGroups=packetSummary({method:12011,status:0,body:{
    members:{type:new I32(1),full:true},
  }},{actorUserId:actor});
  assert.equal(noGroups.memberGroups,undefined);
  const missingActor=packetSummary(packet);
  assert.equal(missingActor.memberGroups.speakers.own,'not_checked');
  const untrustworthy=packetSummary({method:12011,status:0,body:{
    members:{type:new I32(1),full:{
      moderators:{startedAt:new I64(actor),count:new I64(actor)},
    }},
  }},{actorUserId:actor});
  assert.equal(untrustworthy.memberGroups.moderators.own,'not_observed');
});
test('VOX group diagnostics never equate userType=2 with confirmed moderator',()=>{
  const {packetSummary}=require('../shared/vox30-protocol');
  const actor='123456789012345678';
  const summary=packetSummary({method:12011,status:0,body:{
    members:{type:new I32(1),full:{
      moderators:[],
      listeners:[{userId:actor,userType:new I32(2)}],
    }},
  }},{actorUserId:actor});
  assert.equal(summary.ownMember.states.userType,2);
  assert.equal(summary.memberGroups.moderators.own,'not_observed');
  assert.equal(summary.memberGroups.listeners.own,'present');
});

test('VOX server termination correlation reports only bounded media and own moderator state',()=>{
  const {sessionTerminationEvidence}=require('../shared/vox30-adapter');
  const summary=sessionTerminationEvidence({
    elapsedMs:30001,lastPongAgeMs:4512,pingReplies:6,
    heartbeat:{replyReceived:true,headerStatus:0,resCodePresent:false,
      acceptance:'unverified',oauthToken:'private-token'},
    moderator:{own:'present',ownStates:{userType:2,mic:new I32(1),
      nickname:'private-name',chatId:'123456789012345678'}},
    media:{connectionState:'connected',audioTxMode:'opus-silence',
      audioTxFailed:false,remoteAddress:'10.0.0.1'},
    rtp:{available:true,outboundPackets:1250,outboundBytes:3750,inboundPackets:0,
      otherSecret:'private-rtp'},
  });
  // The BSON Int32 is normalized as an untrusted object: don't guess its mic value.
  assert.deepEqual(summary.moderator,{own:'present',mic:null});
  assert.deepEqual(summary.heartbeat,{replyReceived:true,headerStatus:0,
    resCodePresent:false,acceptance:'unverified'});
  assert.equal(summary.elapsedMs,30001);
  assert.equal(summary.lastPongAgeMs,4512);
  assert.equal(summary.declared.heartbeatAudioState,0);
  assert.equal(summary.declared.createDefaultMicOnOff,1);
  assert.equal(summary.media.connectionState,'connected');
  assert.equal(summary.rtp.outboundPackets,1250);
  const json=JSON.stringify(summary);
  for(const secret of ['private-token','private-name',
      '123456789012345678','10.0.0.1','private-rtp'])
    assert.equal(json.includes(secret),false);
  const unknown=sessionTerminationEvidence({
    elapsedMs:-999,pingReplies:9999999999,
    moderator:{own:'listener',ownStates:{mic:100000,other:'private'}},
    heartbeat:{acceptance:'secret',headerStatus:9999999},
    media:{connectionState:'secret',audioTxMode:'secret'},
  });
  assert.equal(unknown.elapsedMs,null);
  assert.equal(unknown.pingReplies,null);
  assert.deepEqual(unknown.moderator,{own:'unknown',mic:null});
  assert.equal(unknown.media.connectionState,'unknown');
  assert.equal(unknown.heartbeat.acceptance,'unverified');
});
test('VOX server termination correlation accepts bounded integer moderator mic',()=>{
  const {sessionTerminationEvidence}=require('../shared/vox30-adapter');
  const state=sessionTerminationEvidence({moderator:{own:'present',ownStates:{mic:1}}});
  assert.deepEqual(state.moderator,{own:'present',mic:1});
});

test('VOX 11015 header-only response is not mistaken for explicit keepalive acceptance',()=>{
  const {heartbeatReplySummary}=require('../shared/vox30-protocol');
  const headerOnly=heartbeatReplySummary({method:11015,status:0,body:{
    userId:'123456789012345678',oauthToken:'private-token',
  }});
  assert.deepEqual(headerOnly,{
    replyReceived:true,headerStatus:0,responseFields:[],
    resCodePresent:false,acceptance:'unverified',
  });
  const explicit=heartbeatReplySummary({method:11015,status:0,body:{
    resCode:new I32(0),interval:new I32(30),deviceUuid:'private-uuid',
  }});
  assert.equal(explicit.resCode,0);
  assert.equal(explicit.acceptance,'body-resCode-zero');
  assert.deepEqual(explicit.responseFields,['resCode','interval']);
  assert.deepEqual(explicit.serverTiming,{interval:30});
  const refused=heartbeatReplySummary({method:11015,status:0,body:{
    resCode:new I32(1002),
  }});
  assert.equal(refused.acceptance,'body-resCode-nonzero');
  assert.equal(refused.resCode,1002);
  const leaked=JSON.stringify([headerOnly,explicit,refused]);
  for(const secret of ['123456789012345678','private-token','private-uuid'])
    assert.ok(!leaked.includes(secret));
});

test('VOX moderator own mic camera and filter states are bounded and private',()=>{
  const {packetSummary}=require('../shared/vox30-protocol');
  const actor='123456789012345678';
  const summary=packetSummary({method:12011,status:0,body:{
    members:{type:new I32(1),full:{moderators:[{
      userId:actor,userType:new I32(2),mic:new I32(1),
      cam:new I32(0),voiceFilter:new I32(0),nickname:'private-name',
    }]}},
  }},{actorUserId:actor});
  assert.deepEqual(summary.memberGroups.moderators.ownStates,{
    userType:2,mic:1,cam:0,voiceFilter:0,
  });
  assert.equal(JSON.stringify(summary).includes(actor),false);
  assert.equal(JSON.stringify(summary).includes('private-name'),false);
  const outlier=packetSummary({method:12011,status:0,body:{
    members:{type:new I32(1),full:{moderators:[{
      userId:actor,mic:new I32(99999),cam:'private',voiceFilter:new I32(2),
    }]}},
  }},{actorUserId:actor});
  assert.deepEqual(outlier.memberGroups.moderators.ownStates,{voiceFilter:2});
});

test('server timing and voice role flags remain bounded and omit sensitive data',()=>{
  const {packetSummary}=require('../shared/vox30-protocol');
  const result=packetSummary({
    method:11028,status:0,body:{
      interval:new I32(30000),connTimeout:new I32(30),
      respTimeout:new I32(12000),oauthToken:'dont-log-this',
      callId:'123456789012345678',csIP:'203.0.113.123'
    }
  });
  assert.deepEqual(result.serverTiming,{
    interval:30000,connTimeout:30,respTimeout:12000
  });
  assert.ok(!JSON.stringify(result).includes('dont-log-this'));
  assert.ok(!JSON.stringify(result).includes('123456789012345678'));
  assert.ok(!JSON.stringify(result).includes('203.0.113.123'));
  const event=packetSummary({method:11003,status:0,body:{
    vrInfo:{enableReqSpkPermit:new I32(1),shareMode:false,
      hostId:'some-private-id',shareTimeStamp:'private'},
  }});
  assert.deepEqual(event.voiceFlags,{enableReqSpkPermit:1,shareMode:false});
  assert.ok(!JSON.stringify(event).includes('some-private-id'));
  assert.equal(packetSummary({method:11028,status:0,
    body:{connTimeout:new I32(5000000),interval:'not-int'}}).serverTiming,undefined);
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

test('VOX server timers and media termination evidence are safe, never guess time units',()=>{
  const {heartbeatReplySummary}=require('../shared/vox30-protocol');
  const {sessionTerminationEvidence}=require('../shared/vox30-adapter');
  const pong=heartbeatReplySummary({status:0,body:{
    resCode:new I32(0),interval:new I32(30),
    connTimeout:new I32(20),respTimeout:new I32(15),
    oauthToken:'private-token',callId:'123456789012345678',
  }});
  assert.deepEqual(pong.serverTiming,{interval:30,connTimeout:20,respTimeout:15});
  const result=sessionTerminationEvidence({
    elapsedMs:29990,pingReplies:6,heartbeat:pong,
    createTiming:{interval:30,connTimeout:20,respTimeout:15,
      oauthToken:'private-auth',callId:'123456789012345678'},
    rtp:{available:true,outboundPackets:1225,outboundBytes:3675,
      inboundPackets:0,remoteInboundReports:2,
      network:{selectedPairObserved:true,selectedPairState:'succeeded',
        selectedPairResponsesReceived:6,transportBytesReceived:1500,
        remoteAddress:'10.3.1.11'}},
  });
  assert.equal(result.serverTimers.createInterval,30);
  assert.equal(result.serverTimers.pingInterval,30);
  assert.equal(result.serverTimers.configuredPingIntervalMs,5000);
  assert.equal(result.serverTimers.serverTimerUnitsVerified,false);
  assert.equal(result.rtp.networkObserved,true);
  assert.equal(result.rtp.remoteInboundReports,2);
  assert.equal(result.rtp.transportBytesReceived,1500);
  assert.equal(result.rtp.selectedPairResponsesReceived,6);
  for(const secret of ['private-token','private-auth',
    '123456789012345678','10.3.1.11'])
    assert.ok(!JSON.stringify(result).includes(secret));
  const malformed=heartbeatReplySummary({status:0,body:{
    resCode:0,interval:new I32(-100),connTimeout:'secret',
    respTimeout:new I32(9000000),oauthToken:'private',
  }});
  assert.equal(malformed.serverTiming,undefined);
});


test('direct VOX adapter refuses unverified hangUp and retains active creator session',async()=>{
  const messages=[];
  let graceful=0,closed=0,peerClosed=0;
  const callConn={
    close(){closed++;},
    async closeGracefully(){graceful++;},
    whenClosed:new Promise(()=>{}),
    wait(...methods){
      const method=methods[0];
      const packet=method===METHODS.CREATED?
        {method,body:{callId:'100',csId:'200',sdp:{sdp:'answer'}}}:
        {method,body:{resCode:0,callId:'100',csId:'200'}};
      return {promise:Promise.resolve(packet),cancel(){}};
    },
    async send(method,body){messages.push({method,body});},
  };
  const adapter=createVox30Adapter({
    actorUserId:USER,cfg,codec,entryHost:'entry.example',appVer:'26.3.1',
    credentialsForRoom:async()=>({oauthToken:'token',deviceUuid:'uuid'}),
    verifyMembership:async()=>true,
    rtcFactory:async()=>({
      createOffer:async()=>sdp,applyAnswer:async()=>{},
      close:async()=>{peerClosed++;},
    }),
    connect:async({host})=>host==='entry.example'?
      {request:async()=>({callable:1,csSslAddr:{ip:0x01020304},csSslPort:995}),close(){}}:
      callConn,
  });
  await adapter.create({roomId:ROOM,title:'테스트'});
  assert.equal((await adapter.status({roomId:ROOM})).localCallId,'100');
  const foreign=await adapter.stop({roomId:'9007199254740993123'});
  assert.equal(foreign.localReleased,false);
  assert.equal(graceful,0);
  const stopped=await adapter.stop({roomId:ROOM});
  assert.deepEqual(stopped,{roomId:ROOM,closed:false,verified:false,
    localReleased:false,serverStopUnavailable:true});
  assert.equal(graceful,0);
  assert.equal(closed,0);
  assert.equal(peerClosed,0);
  const stillAlive=await adapter.status({roomId:ROOM});
  assert.equal(stillAlive.localActive,true);
  assert.equal(stillAlive.stopAvailable,false);
  await adapter.dispose();
  assert.equal(closed,1);
  assert.equal(peerClosed,1);
});


test('VOX local creator shutdown requests a graceful TLS close instead of blind packet',async()=>{
  class EndableTls extends FakeTls {
    end(){this.ended=true;queueMicrotask(()=>this.emit('close'));}
  }
  const sock=new EndableTls();
  const conn=await voxConnect({
    host:'127.0.0.1',port:995,codec,timeoutMs:500,
    tlsConnect:()=>{queueMicrotask(()=>sock.emit('secureConnect'));return sock;},
  });
  await conn.closeGracefully();
  assert.equal(sock.ended,true);
  await conn.whenClosed;
  await assert.rejects(()=>conn.send(METHODS.PING,{a:1}),/종료/);
});
