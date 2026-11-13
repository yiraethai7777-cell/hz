'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const joinInfo = require('../shared/voice-room-join-info');

const ROOM='18495931541358610';
const CALL='9007199254740993123';
const HOST='192.0.2.51';
function makeMessage({
  roomId=ROOM, type='vr_invite', logId='999000', now=Date.now(),
  callId=CALL, ip=HOST, port=12345, override={},
}={}) {
  const attachment=JSON.stringify({
    type, callId, csIP:ip, csIP6:'', csPort:port, ...override,
  });
  return {
    room:{id:roomId,isOpenChat:true},
    message:{type:52,logId,text:'do not store messages'},
    raw:{chatLog:{logId,attachment,sendAt:Math.floor(now/1000)}},
  };
}
test('fresh 52 invite yields an ephemeral validated endpoint but never claims joined',()=>{
  const now=1700000000000;
  assert.equal(joinInfo.observe(makeMessage({now,logId:'900001'}),now),true);
  assert.deepEqual(joinInfo.status(ROOM,now),{
    phase:'invite',endpointReady:true,verifiedJoined:false,protocolReady:false,
  });
  assert.deepEqual(joinInfo.resolve(ROOM,now),{
    roomId:ROOM,callId:CALL,hostV4:HOST,hostV6:'',port:12345,
  });
  const publicState=JSON.stringify(joinInfo.status(ROOM,now));
  for(const secret of [CALL,HOST,'do not store messages','900001']){
    assert.ok(!publicState.includes(secret));
  }
});
test('a bye signal destroys the stored coordinates and a replayed invite cannot reopen it',()=>{
  const now=1700000000000;
  assert.equal(joinInfo.observe(makeMessage({now,logId:'900011'}),now),true);
  assert.equal(joinInfo.observe(makeMessage({now:now+1000,type:'vr_bye',logId:'900012'}),now+1000),true);
  assert.equal(joinInfo.resolve(ROOM,now+1000),null);
  assert.equal(joinInfo.status(ROOM,now+1000).phase,'ended');
  assert.equal(joinInfo.observe(makeMessage({now,logId:'900011'}),now+1200),false);
  assert.equal(joinInfo.resolve(ROOM,now+1200),null);
});
test('other chat types, wrong room, stale log and invalid coordinates never produce a ready endpoint',()=>{
  const now=1700000000000;
  const out=makeMessage({now,roomId:'18495931541358611',logId:'900101'});
  out.room.isOpenChat=false;
  assert.equal(joinInfo.observe(out,now),false);
  const old=makeMessage({now:now-600000,roomId:'18495931541358612',logId:'900102'});
  assert.equal(joinInfo.observe(old,now),false);
  assert.equal(joinInfo.observe(makeMessage({
    now,roomId:'18495931541358613',logId:'900103',callId:'9007199254740993123123',
  }),now),true);
  assert.equal(joinInfo.status('18495931541358613',now).endpointReady,false);
  assert.equal(joinInfo.observe(makeMessage({
    now,roomId:'18495931541358614',logId:'900104',ip:'evil.example',port:22,
  }),now),true);
  assert.equal(joinInfo.resolve('18495931541358614',now),null);
  assert.equal(joinInfo.observe(makeMessage({
    now,roomId:'18495931541358615',logId:'900105',port:0,
  }),now),true);
  assert.equal(joinInfo.resolve('18495931541358615',now),null);
});
test('valid VOX metadata expires after five minutes with no storage',()=>{
  const now=1700000000000;
  assert.equal(joinInfo.observe(makeMessage({now,roomId:'18495931541358616',logId:'900201'}),now),true);
  assert.equal(joinInfo.status('18495931541358616',now+joinInfo.TTL_MS+1).endpointReady,false);
  assert.equal(joinInfo.resolve('18495931541358616',now+joinInfo.TTL_MS+1),null);
});
test('bigint IDs are exact; unsafe numbers and nonnumeric IDs are rejected',()=>{
  assert.equal(joinInfo.positiveId('9223372036854775807'),'9223372036854775807');
  assert.equal(joinInfo.positiveId('9223372036854775808'),'');
  assert.equal(joinInfo.positiveId(9007199254740993),'');
  assert.equal(joinInfo.positiveId('00001'),'');
  assert.equal(joinInfo.positiveId('fake'),'');
  assert.equal(joinInfo.portNumber('65535'),65535);
  assert.equal(joinInfo.portNumber('65536'),0);
});
test('install attaches one passive listener and never makes network requests',()=>{
  const client=new EventEmitter();
  const now=Date.now();
  assert.equal(joinInfo.install(client),true);
  assert.equal(joinInfo.install(client),true);
  assert.equal(client.listenerCount('message'),1);
  client.emit('message',client,{...makeMessage({
    roomId:'18495931541358619',logId:'900300',now,
  })});
  assert.equal(joinInfo.status('18495931541358619').endpointReady,true);
});


test('live invitation cache follows actual 48-hour room lifetime rather than five minutes',()=>{
  const now=1700000000000;
  const room='18495931541358001';
  assert.equal(joinInfo.TTL_MS,48*60*60*1000);
  assert.equal(joinInfo.observe(makeMessage({now,roomId:room,logId:'901001'}),now),true);
  assert.equal(joinInfo.status(room,now+15*60*1000).endpointReady,true);
  assert.equal(joinInfo.resolve(room,now+15*60*1000).callId,CALL);
  assert.equal(joinInfo.status(room,now+joinInfo.TTL_MS+1).endpointReady,false);
});
test('SYNCMSG history recovery uses bounded read-only source without emitting old commands',async()=>{
  const now=1700000000000;
  const room='18495931541358002';
  let calls=0;
  const client={connected:true,_carriage:{async syncMsg(opts){
    calls++;assert.deepEqual(opts,{chatId:room,cur:0,max:0,cnt:100});
    return {body:{chatLogs:[{
      type:52,logId:'901011',sendAt:Math.floor((now-60*60*1000)/1000),
      attachment:JSON.stringify({type:'vr_invite',callId:CALL,csIP:HOST,csPort:9000}),
    }]}};
  }}};
  const result=await joinInfo.recover(client,room,now);
  assert.deepEqual(result,{recovered:true,reason:'history'});
  assert.equal(calls,1);
  assert.equal(joinInfo.resolve(room,now).hostV4,HOST);
  const repeat=await joinInfo.recover(client,room,now+3000);
  assert.equal(repeat.recovered,true);
  assert.equal(calls,1);
});
test('historical room end event always overrides old invite regardless of unsorted response',async()=>{
  const now=1700000000000,room='18495931541358003';
  const logs=[
    {type:52,logId:'902003',sendAt:Math.floor((now-80000)/1000),
      attachment:JSON.stringify({type:'vr_bye',callId:CALL})},
    {type:52,logId:'902001',sendAt:Math.floor((now-100000)/1000),
      attachment:JSON.stringify({type:'vr_invite',callId:CALL,csIP:HOST,csPort:9000})},
  ];
  const client={connected:true,_carriage:{async syncMsg(){return {body:{chatLogs:logs}}}}};
  const r=await joinInfo.recover(client,room,now);
  assert.equal(r.recovered,false);
  assert.equal(joinInfo.status(room,now).phase,'ended');
  assert.equal(joinInfo.resolve(room,now),null);
  assert.equal((await joinInfo.recover(client,room,now+1000)).reason,'ended');
});
test('history recovery ignores stale 48h records, malformed IDs and unrelated message text',async()=>{
  const now=1700000000000,room='18495931541358004';
  const client={connected:true,_carriage:{async syncMsg(){return {body:{chatLogs:[
    {type:52,logId:'903001',sendAt:Math.floor((now-49*60*60*1000)/1000),
      attachment:JSON.stringify({type:'vr_invite',callId:CALL,csIP:HOST,csPort:9000})},
    {type:1,logId:'903002',sendAt:Math.floor(now/1000),
      message:'#보룸참가',attachment:JSON.stringify({type:'vr_invite',callId:CALL,csIP:HOST,csPort:9000})},
    {type:52,logId:'bad-id',sendAt:Math.floor(now/1000),
      attachment:JSON.stringify({type:'vr_invite',callId:CALL,csIP:HOST,csPort:9000})},
  ]}}}}};
  const r=await joinInfo.recover(client,room,now);
  assert.equal(r.recovered,false);
  assert.equal(joinInfo.resolve(room,now),null);
});
test('missing LOCO history API returns a specific non-success result',async()=>{
  const result=await joinInfo.recover({connected:true},'18495931541358005');
  assert.equal(result.recovered,false);
  assert.equal(result.reason,'history-unavailable');
});

test('LOCO BSON-style Long IDs can be recovered without numeric precision loss',async()=>{
  const now=1700000000000,room='18495931541358007';
  const long={toString(){return '903007'}};
  const client={connected:true,_carriage:{async syncMsg(){return {body:{chatLogs:[
    {type:52,logId:long,sendAt:Math.floor(now/1000),
      attachment:JSON.stringify({type:'vr_invite',callId:CALL,csIP:HOST,csPort:9000})}
  ]}}}}};
  const r=await joinInfo.recover(client,room,now);
  assert.equal(r.recovered,true);
  assert.equal(joinInfo.status(room,now).endpointReady,true);
});
