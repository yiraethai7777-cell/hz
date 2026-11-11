'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {seedCbcBytes}=require('../experiments/vox30/seed');
const {createWebRtcPeer,unwrapAnswer,waitIceGathering}=
  require('../experiments/vox30/webrtc');
const {createLabAdapter}=require('../experiments/vox30/lab');
const {createCodec,pkcs7Pad}=require('../shared/vox30-protocol');

const USER='418692594';
const ROOM='18496234145974738';
const cfg={userId:USER,model:'test-model',sdkVersion:'35',
  buildId:'test-build',carrierId:'45008'};

test('SEED-CBC matches RFC 4269 known zero-key first block',()=>{
  const seed=seedCbcBytes();
  const key=Buffer.alloc(16),iv=Buffer.alloc(16);
  const input=Buffer.from('000102030405060708090a0b0c0d0e0f','hex');
  const padded=pkcs7Pad(input);
  const cipher=seed.encrypt(padded,key,iv);
  assert.equal(cipher.subarray(0,16).toString('hex'),
    '5ebac6e0054e166819aff1cc6d346cdb');
  assert.deepEqual(seed.decrypt(cipher,key,iv),padded);
});

test('SEED/BSON codec roundtrips binary fields and non-ASCII content',()=>{
  const codec=createCodec({seed:seedCbcBytes()});
  const frame=codec.frame(11028,{
    title:'보이스룸 검증',raw:Buffer.from([0,0x80,0xff]),
    roomId:'18496234145974738',resCode:0,
  });
  const back=codec.parse(frame);
  assert.equal(back.method,11028);
  assert.equal(back.body.title,'보이스룸 검증');
  assert.deepEqual(Buffer.from(back.body.raw.buffer),Buffer.from([0,0x80,0xff]));
});

class FakeRtc extends EventEmitter {
  constructor(config){
    super();this.config=config;
    this.iceGatheringState='new';
    this.connectionState='new';
    this.signalingState='stable';
    this.calls=[];
  }
  addEventListener(name,fn){this.on(name,fn);}
  removeEventListener(name,fn){this.off(name,fn);}
  addTransceiver(kind,opts){this.calls.push(['addTransceiver',kind,opts.direction]);}
  async createOffer(){
    this.calls.push(['createOffer']);
    return {type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'};
  }
  async setLocalDescription(offer){
    this.calls.push(['setLocalDescription']);
    this.localDescription=offer;
    queueMicrotask(()=>{
      this.iceGatheringState='complete';
      this.emit('icegatheringstatechange');
    });
  }
  async setRemoteDescription(answer){
    this.calls.push(['setRemoteDescription',answer.type]);
    this.remoteDescription=answer;
    this.connectionState='connecting';
  }
  close(){this.signalingState='closed';this.connectionState='closed';this.calls.push(['close']);}
}

test('real SDP negotiation interface creates audio offer then applies answer',async()=>{
  const peer=createWebRtcPeer({PeerConnection:FakeRtc,iceTimeoutMs:500});
  const offer=await peer.createOffer();
  assert.match(offer,/m=audio/);
  assert.deepEqual(await peer.applyAnswer({
    sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',sdpType:2,
  }),{answerApplied:true,connectionState:'connecting'});
  assert.equal(peer.getState().answered,true);
  await assert.rejects(()=>peer.createOffer(),/중복/);
  await peer.close();
  assert.equal(peer.getState().closed,true);
});

test('remote SDP must describe an audio answer, no fabricated success',()=>{
  assert.throws(()=>unwrapAnswer({sdp:'v=0\r\nm=video 9 RTP/AVP 100'}),/형식/);
  assert.throws(()=>unwrapAnswer(null),/형식/);
});

test('missing ICE gather completion times out instead of silent success',async()=>{
  const peer=new FakeRtc();
  await assert.rejects(()=>waitIceGathering(peer,20),/시간 초과/);
});

test('composed adapter rejects missing authenticated membership before VOX I/O',async()=>{
  const adapter=createLabAdapter({actorUserId:USER,cfg,entryHost:'entry.example.test',
    credentialsForRoom:async()=>({oauthToken:'none',deviceUuid:'none'}),
    verifyMembership:async()=>false});
  await assert.rejects(()=>adapter.create({roomId:ROOM,title:'실험'}),/참여/);
  await adapter.dispose();
});
