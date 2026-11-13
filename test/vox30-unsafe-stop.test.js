'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const voice=require('../shared/voice-room');
const {createVox30Adapter}=require('../shared/vox30-adapter');
const {createCodec,METHODS,integer}=require('../shared/vox30-protocol');
const {createMultiRoomAdapter}=require('../shared/vox30-multiroom');
const {installDirectVoice}=require('../shared/vox30-runtime');
const USER='418692594',ROOM='18496234145974738';
const cfg={userId:USER};
const codec=createCodec({seed:{
  encrypt:b=>Buffer.from(b),decrypt:b=>Buffer.from(b)
},nonce:()=>Buffer.from('01020304','hex')});
const sdp='v=0\r\no=- 100 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n';

function fixture(text){
  const sent=[];
  const client={
    connected:true,userId:USER,_activeChatId:ROOM,type:1,
    _getCachedMemberType(){return 1;}
  };
  const args={client,roomId:ROOM,
    msg:{room:{id:ROOM,isOpenChat:true},sender:{id:'11',type:1}},
    text,send:async t=>sent.push(t)};
  return {sent,client,args};
}
function liveAdapter(enabled=true){
  const sends=[];
  let socketClosed=0,peerClosed=0,serverPacket=null;
  const conn={
    close(){socketClosed++;},whenClosed:new Promise(()=>{}),
    wait(method){
      return {promise:Promise.resolve({method,body:method===METHODS.CREATED?
        {callId:'100',csId:'200',sdp:{sdp:'answer'}}:
        {resCode:0,callId:'100',csId:'200'}}),cancel(){}};
    },
    async send(method,body){sends.push({method,body});}
  };
  const adapter=createVox30Adapter({
    actorUserId:USER,cfg,codec,entryHost:'entry.example',appVer:'26.3.1',
    unsafeStopExperiment:enabled,
    credentialsForRoom:async()=>({oauthToken:'token',deviceUuid:'uuid'}),
    verifyMembership:async()=>true,
    rtcFactory:async()=>({createOffer:async()=>sdp,
      applyAnswer:async()=>{},close:async()=>{peerClosed++;}}),
    connect:async({host,onPacket})=>host==='entry.example'?
      {request:async()=>({callable:1,csSslAddr:{ip:0x01020304},csSslPort:995}),close(){}}:
      (serverPacket=onPacket,conn),
  });
  return {adapter,sends,serverReply:p=>serverPacket?.(p),
    closed:()=>socketClosed,peersClosed:()=>peerClosed};
}
test('the 11009 experiment sends once only for same active room, without closing session',async()=>{
  const instance=liveAdapter();
  const {adapter,sends}=instance;
  await adapter.create({roomId:ROOM,title:'테스트'});
  const before=sends.length;
  assert.equal((await adapter.status({roomId:ROOM})).unsafeStopExperimentAvailable,true);
  assert.equal((await adapter.experimentalStop({roomId:'111',mode:'11009'})).noLocalSession,true);
  await assert.rejects(adapter.experimentalStop({roomId:ROOM,mode:'invalid'}),/허용되지 않은/);
  const answer=await adapter.experimentalStop({roomId:ROOM,mode:'11009'});
  assert.equal(answer.packetSent,true);
  assert.equal(answer.serverEnded,false);
  const matches=sends.filter(x=>x.method===11009);
  assert.equal(matches.length,1);
  assert.equal(matches[0].body.callId.toString(),'100');
  assert.equal(matches[0].body.csId.toString(),'200');
  assert.equal(matches[0].body.userId.toString(),USER);
  assert.equal(integer(matches[0].body.reason),0);
  assert.equal((await adapter.experimentalStop({roomId:ROOM,mode:'11009'})).alreadyTried,true);
  assert.equal(sends.filter(x=>x.method===11009).length,1);
  assert.equal(instance.closed(),0);
  // An ACK without the terminal reason must not release the live voice session.
  instance.serverReply({method:11009,status:0,codes:{}});
  assert.equal((await adapter.status({roomId:ROOM})).localActive,true);
  assert.equal(sends.length,before+1);
  await adapter.dispose();
});
test('experimental force disconnect releases ONLY current VOX audio and signaling',async()=>{
  const x=liveAdapter();await x.adapter.create({roomId:ROOM,title:'테스트'});
  const r=await x.adapter.experimentalStop({roomId:ROOM,mode:'disconnect'});
  assert.equal(r.localReleased,true);
  assert.equal(r.serverEnded,false);
  assert.equal(x.closed(),1);
  assert.equal(x.peersClosed(),1);
  assert.equal((await x.adapter.status({roomId:ROOM})).localActive,false);
  assert.equal((await x.adapter.experimentalStop({roomId:ROOM,mode:'disconnect'})).noLocalSession,true);
});
test('experimental commands are disabled unless explicitly opted in',async()=>{
  const x=liveAdapter(false);await x.adapter.create({roomId:ROOM,title:'테스트'});
  assert.equal((await x.adapter.status({roomId:ROOM})).unsafeStopExperimentAvailable,false);
  assert.equal((await x.adapter.experimentalStop({roomId:ROOM,mode:'11009'})).disabled,true);
  assert.equal(x.sends.some(v=>v.method===11009),false);
  assert.equal((await x.adapter.status({roomId:ROOM})).localActive,true);
  await x.adapter.dispose();
});
test('chat command reports 11009 transmission but never claims server room closure',async()=>{
  const {args,sent}=fixture('#보룸종료시험 11009');
  const received=[];
  args.adapter={
    async status(){return {roomId:ROOM,localSession:true,localActive:true,
      unsafeStopExperimentAvailable:true,localCallId:'13299692653040311'}},
    async experimentalStop(req){received.push(req);return {packetSent:true};},
  };
  assert.equal(await voice.handle(args),true);
  assert.deepEqual(received,[{roomId:ROOM,mode:'11009'}]);
  assert.match(sent[0],/패킷을 1회 송신했습니다/);
  assert.match(sent[0],/서버 종료 이벤트.*확인되지 않았습니다/);
});
test('chat command keeps force-close and packet-send results distinct',async()=>{
  const {args,sent}=fixture('#보룸종료시험 연결해제');
  args.adapter={
    async status(){return {roomId:ROOM,localSession:true,localActive:true,
      unsafeStopExperimentAvailable:true,localCallId:'13299692653040311'}},
    async experimentalStop(req){
      assert.equal(req.mode,'disconnect');return {localReleased:true};
    },
  };
  await voice.handle(args);
  assert.match(sent[0],/VOX 연결만 강제로 해제했습니다/);
  assert.match(sent[0],/실제 보룸은 남아 있을 수 있습니다/);
});
test('chat denies experiments from ordinary sender despite bot moderator rights',async()=>{
  const {args,sent}=fixture('#보룸종료시험 11009');
  args.msg.sender.type=2;
  let calls=0;
  args.adapter={experimentalStop(){calls++;}};
  await voice.handle(args);
  assert.equal(calls,0);
  assert.match(sent[0],/방장·부방장 또는 봇 계정만/);
});
test('chat denies experiments in foreign room or without opt-in, no send',async()=>{
  for(const state of [
    {roomId:'999',localActive:true,localSession:true,unsafeStopExperimentAvailable:true},
    {roomId:ROOM,localActive:true,localSession:true,unsafeStopExperimentAvailable:false},
  ]){
    const {args,sent}=fixture('#보룸종료시험 11009');
    let count=0;
    args.adapter={
      async status(){return state},
      async experimentalStop(){count++;return {packetSent:true}},
    };
    await voice.handle(args);
    assert.equal(count,0);
    assert.match(sent[0],/활성 VOX 연결이 없습니다|비활성화되어 있습니다/);
  }
});
test('invalid or unspecified experiment mode never calls transport',async()=>{
  for(const text of ['#보룸종료시험','#보룸종료시험 11009 반복','#보룸종료시험 임의']){
    const {args,sent}=fixture(text);
    let count=0;
    args.adapter={experimentalStop(){count++}};
    await voice.handle(args);
    assert.equal(count,0);
    assert.match(sent[0],/정확한 실험 명령어/);
  }
});
test('multiroom experiment dispatches to matching adapter and preserves other room',async()=>{
  const all=[];
  const m=createMultiRoomAdapter({maxRooms:2,createAdapter(){
    const a={active:false,calls:[],
      async create(){this.active=true;return {requestAccepted:true}},
      async status({roomId}){return {roomId,localActive:this.active,localSession:true,
        unsafeStopExperimentAvailable:true}},
      async experimentalStop(req){
        this.calls.push(req);
        if(req.mode==='disconnect')this.active=false;
        return req.mode==='disconnect'?{localReleased:true}:{packetSent:true};
      },
      async dispose(){this.active=false},
    };
    all.push(a);return a;
  }});
  await m.create({roomId:'101'});
  await m.create({roomId:'202'});
  assert.equal((await m.experimentalStop({roomId:'101',mode:'11009'})).packetSent,true);
  assert.equal(all[0].calls.length,1);
  assert.equal(all[1].calls.length,0);
  assert.equal((await m.experimentalStop({roomId:'202',mode:'disconnect'})).localReleased,true);
  assert.equal(all[0].active,true);
  assert.equal(all[1].active,false);
  await m.dispose();
});
test('runtime enables unsafe stop only by explicit setting',()=>{
  const client={voiceRoomAuthCandidate:{
    actorUserId:'10',getCredentials:()=>({oauthToken:'test',deviceUuid:'test'}),
    localRoomEvidence:()=>({isOpenChatInLocalRoster:true,memberTypeCached:true}),
  }};
  const seen=[];
  const loadLab=()=>({createLabAdapter(opts){
    seen.push(opts.unsafeStopExperiment);
    return {async create(){},async status(){}};
  }});
  const log={info(){},warn(){}};
  assert.equal(installDirectVoice(client,{env:{},loadLab,log}),true);
  assert.equal(installDirectVoice(client,{
    env:{NEXI_VOX_UNSAFE_STOP_TEST:'1'},loadLab,log,
  }),true);
  assert.deepEqual(seen,[false,true]);
});
