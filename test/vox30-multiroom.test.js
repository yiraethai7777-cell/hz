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
  for(const n of [0,-1,1.5,NaN])
    assert.throws(()=>createMultiRoomAdapter({createAdapter,maxRooms:n}),/양의 정수 또는 Infinity/);
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

test('uncapped multi-room mode keeps independent sessions beyond legacy two-room limit',async()=>{
  const {createAdapter,all}=makeFactory();
  const multi=createMultiRoomAdapter({createAdapter,maxRooms:Infinity,joinTrialEnabled:true});
  for(let i=1;i<=12;i++)await multi.create({roomId:String(i*101)});
  assert.equal(all.length,12);
  assert.equal((await multi.status({roomId:'9999'})).localBusyOtherRoom,false);
  assert.equal((await multi.status({roomId:'9999'})).joinAvailable,true);
  assert.equal((await multi.status({roomId:'9999'})).maxLocalRooms,null);
  assert.ok(all.every(x=>x.active));
  await multi.dispose();
  assert.ok(all.every(x=>x.closed===1));
});
test('server rejection in uncapped mode releases only rejected room',async()=>{
  const {createAdapter,all}=makeFactory();
  let n=0;
  const multi=createMultiRoomAdapter({maxRooms:Infinity,createAdapter(){
    const a=createAdapter();
    if(++n===3)a.rejected=true;
    return a;
  }});
  await multi.create({roomId:'101'});
  await multi.create({roomId:'202'});
  await assert.rejects(multi.create({roomId:'303'}),/server rejected/);
  assert.equal(all[0].active,true);
  assert.equal(all[1].active,true);
  assert.equal(all[2].closed,1);
  await multi.create({roomId:'404'});
  assert.equal(all[3].active,true);
  await multi.dispose();
});
