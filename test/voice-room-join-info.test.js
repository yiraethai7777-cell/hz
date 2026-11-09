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
