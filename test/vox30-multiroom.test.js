'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createMultiRoomAdapter}=require('../shared/vox30-multiroom');

function makeFactory(){
  const all=[];
  const createAdapter=()=>{
    const a={room:'',active:false,created:0,closed:0,rejected:false,
      async status({roomId}){
        return {roomId,verified:false,localSession:true,localActive:this.active,
          stopAvailable:false,joinAvailable:false};
      },
      async create({roomId}){
        this.room=roomId;this.created++;
        if(this.rejected)throw Error('call server rejected this room');
        this.active=true;
        return {requestAccepted:true,verified:false,callId:String(this.created)};
      },
      async stop(){throw Error('unverified server termination must not occur')},
      async dispose(){this.closed++;this.active=false},
    };
    all.push(a);return a;
  };
  return {createAdapter,all};
}
test('default one-room mode protects the existing creator session',async()=>{
  const {createAdapter,all}=makeFactory();
  const multi=createMultiRoomAdapter({createAdapter});
  await multi.create({roomId:'101',title:'first'});
  const first=all[0];
  assert.equal((await multi.status({roomId:'101'})).localActive,true);
  assert.equal((await multi.status({roomId:'202'})).localBusyOtherRoom,true);
  await assert.rejects(multi.create({roomId:'202'}),/이미 활성 음성 세션/);
  assert.equal(first.active,true);
  assert.equal(all.length,1);
  await multi.dispose();
  assert.equal(first.closed,1);
});
test('explicit two-room experiment creates independent per-room transports and cleanup',async()=>{
  const {createAdapter,all}=makeFactory();
  const multi=createMultiRoomAdapter({createAdapter,maxRooms:2});
  await multi.create({roomId:'101'});
  assert.equal((await multi.status({roomId:'202'})).localBusyOtherRoom,false);
  await multi.create({roomId:'202'});
  assert.equal(all.length,2);
  assert.notEqual(all[0],all[1]);
  assert.equal((await multi.status({roomId:'101'})).localActive,true);
  assert.equal((await multi.status({roomId:'202'})).localActive,true);
  assert.equal((await multi.status({roomId:'303'})).localBusyOtherRoom,true);
  await assert.rejects(multi.create({roomId:'303'}),/이미 활성 음성 세션/);
  assert.equal(all[0].active,true);
  assert.equal(all[1].active,true);
  const stop=await multi.stop({roomId:'303'});
  assert.equal(stop.serverStopUnavailable,true);
  await multi.dispose();
  assert.equal(all[0].closed,1);
  assert.equal(all[1].closed,1);
});
test('server rejection of second room cannot destroy first room adapter',async()=>{
  const {createAdapter,all}=makeFactory();
  let count=0;
  const multi=createMultiRoomAdapter({
    maxRooms:2,
    createAdapter(){
      count++;
      const adapter=createAdapter();
      if(count===2)adapter.rejected=true;
      return adapter;
    },
  });
  await multi.create({roomId:'101'});
  await assert.rejects(multi.create({roomId:'202'}),/server rejected/);
  assert.equal(all[0].active,true);
  assert.equal(all[0].closed,0);
  assert.equal(all[1].closed,1);
  assert.equal((await multi.status({roomId:'202'})).localBusyOtherRoom,false);
  await multi.dispose();
});
test('stale disconnected room releases its own capacity for later create',async()=>{
  const {createAdapter,all}=makeFactory();
  const multi=createMultiRoomAdapter({createAdapter,maxRooms:2});
  await multi.create({roomId:'101'});
  await multi.create({roomId:'202'});
  all[0].active=false; // real adapter receives 11009 and releases itself
  const state=await multi.status({roomId:'303'});
  assert.equal(state.localBusyOtherRoom,false);
  assert.equal(all[0].closed,1);
  await multi.create({roomId:'303'});
  assert.equal(all[1].active,true);
  await multi.dispose();
});
test('two concurrent creates serialize negotiation and do not race capacity',async()=>{
  let resolveStart;
  const gate=new Promise(resolve=>{resolveStart=resolve;});
  const instances=[];
  const multi=createMultiRoomAdapter({
    maxRooms:2,
    createAdapter(){
      const item={
        async create(){await gate;item.active=true;return {requestAccepted:true}},
        async status({roomId}){return {roomId,localSession:true,localActive:!!item.active}},
        async dispose(){item.active=false},
      };
      instances.push(item);return item;
    },
  });
  const first=multi.create({roomId:'101'});
  await assert.rejects(multi.create({roomId:'202'}),/다른 VOX 생성 요청/);
  resolveStart();
  await first;
  assert.equal(instances.length,1);
  await multi.create({roomId:'202'});
  assert.equal(instances.length,2);
  await multi.dispose();
});
test('a second create in same room is denied and authenticated role event is routed safely',async()=>{
  const requests=[];
  const multi=createMultiRoomAdapter({maxRooms:2,createAdapter:()=>{
    let active=false;
    return {
      async create(){active=true;return {requestAccepted:true}},
      async status({roomId}){return {roomId,localActive:active,localSession:true}},
      async receiveAuthenticatedRoleInvitation(info){requests.push(info.roomId);return true},
      async dispose(){active=false},
    };
  }});
  await multi.create({roomId:'101'});
  await multi.create({roomId:'202'});
  await assert.rejects(multi.create({roomId:'101'}),/이미 활성 VOX 세션/);
  assert.equal(await multi.receiveAuthenticatedRoleInvitation({roomId:'202'}),true);
  assert.deepEqual(requests,['202']);
  assert.equal(await multi.receiveAuthenticatedRoleInvitation({}),false);
  await multi.dispose();
  await assert.rejects(multi.create({roomId:'303'}),/종료됐습니다/);
});
test('invalid maxRooms and invalid room IDs are rejected',async()=>{
  const {createAdapter}=makeFactory();
  for(const n of [0,11,1.5,NaN])
    assert.throws(()=>createMultiRoomAdapter({createAdapter,maxRooms:n}),/1~10/);
  assert.doesNotThrow(()=>createMultiRoomAdapter({createAdapter,maxRooms:10}));
  const multi=createMultiRoomAdapter({createAdapter});
  await assert.rejects(multi.create({roomId:'bad'}),/ID/);
  await multi.dispose();
});


test('two-slot empty-room status exposes opt-in VOX join capability without pre-opening a socket',async()=>{
  let created=0;
  const m=createMultiRoomAdapter({
    maxRooms:2,joinTrialEnabled:true,
    createAdapter(){
      created++;
      return {async create(){return {requestAccepted:true}},
        async join(){return {requestAccepted:false}},
        async status({roomId}){return {roomId,localActive:false}},
        async dispose(){}};
    },
  });
  assert.equal((await m.status({roomId:'123'})).joinAvailable,true);
  assert.equal((await m.status({roomId:'123'})).joinTrialAvailable,true);
  assert.equal(created,0);
  await m.join({roomId:'123'});
  assert.equal(created,1);
  assert.equal((await m.status({roomId:'123'})).joinAvailable,true);
  await m.dispose();
});

test('ten independent room slots preserve other sessions when capacity is reached',async()=>{
  const {createAdapter,all}=makeFactory();
  const multi=createMultiRoomAdapter({createAdapter,maxRooms:10});
  for(let i=1;i<=10;i++)await multi.create({roomId:String(100+i)});
  assert.equal(all.length,10);
  assert.equal((await multi.status({roomId:'111'})).maxLocalRooms,10);
  assert.equal((await multi.status({roomId:'111'})).localBusyOtherRoom,true);
  await assert.rejects(multi.create({roomId:'111'}),/이미 활성 음성 세션/);
  assert.equal(all.every(item=>item.active),true);
  all[4].active=false;
  assert.equal((await multi.status({roomId:'111'})).localBusyOtherRoom,false);
  await multi.create({roomId:'111'});
  assert.equal(all.length,11);
  assert.equal(all[0].active,true);
  assert.equal(all[4].closed,1);
  await multi.dispose();
  assert.equal(all[0].closed,1);
});

test('verified stop releases only the matching room and keeps other live rooms',async()=>{
  const instances=[];
  const multi=createMultiRoomAdapter({maxRooms:2,createAdapter(){
    const a={
      active:false,disposed:0,
      async create(){this.active=true;return {requestAccepted:true}},
      async status({roomId}){return {roomId,localActive:this.active}},
      async stop({roomId}){return {roomId,closed:true,verified:true}},
      async dispose(){this.active=false;this.disposed++}
    };
    instances.push(a);return a;
  }});
  await multi.create({roomId:'101'});
  await multi.create({roomId:'202'});
  assert.equal((await multi.stop({roomId:'101'})).verified,true);
  assert.equal(instances[0].disposed,1);
  assert.equal(instances[1].active,true);
  assert.equal((await multi.status({roomId:'202'})).localActive,true);
  assert.equal((await multi.status({roomId:'303'})).localBusyOtherRoom,false);
  await multi.dispose();
  assert.equal(instances[1].disposed,1);
});

test('unverified stop response cannot evict the current session',async()=>{
  let stopCalls=0,disposed=0;
  const multi=createMultiRoomAdapter({maxRooms:1,createAdapter:()=>({
    async create(){return {requestAccepted:true}},
    async status({roomId}){return {roomId,localActive:true}},
    async stop({roomId}){stopCalls++;return {roomId,requestAccepted:true,closed:false,verified:false}},
    async dispose(){disposed++}
  })});
  await multi.create({roomId:'101'});
  const stopped=await multi.stop({roomId:'101'});
  assert.equal(stopped.closed,false);
  assert.equal(stopCalls,1);
  assert.equal(disposed,0);
  assert.equal((await multi.status({roomId:'202'})).localBusyOtherRoom,true);
  await multi.dispose();
  assert.equal(disposed,1);
});
