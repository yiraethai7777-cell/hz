'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {start,receive}=require('../shared/event-reaction-test');

let nextRoom=12000;
const marker=(id,name)=>'\u0002'+id+'\u0003'+name+'\u0004';
function fixture(overrides={}) {
  const roomId=String(++nextRoom),sent=[],mentionCalls=[];
  let currentTime=0;
  const clock={now:()=>currentTime,advance:ms=>{currentTime+=ms;}};
  const client={
    userId:'999',connected:true,
    getCachedMemberProfiles:async()=>[
      {id:'9007199254740993123',name:'𒊮𝐀𝐏𝐄𝐗 정 ᯽'},
      {id:'42',name:'일반'},
      {id:'999',name:'APEX BOT'}],
    refreshMemberProfiles:()=>{throw Error('MEMLIST must not be used')},
    _carriage:{memList:()=>{throw Error('MEMLIST forbidden')},chatOnRoom:()=>{throw Error('CHATONROOM forbidden')}}
  };
  const args={client,roomId,msg:{room:{isOpenChat:true},sender:{type:1}},
    send:async text=>{sent.push(text)},
    mention:(id,name)=>{mentionCalls.push({id,name});return marker(id,name)},
    pickRandom:()=>0,now:clock.now,sleep:async ms=>clock.advance(ms),
    ...overrides};
  return {args,sent,mentionCalls,clock};
}

test('5-second test sends real mention and 5,4,3,2,1 then times out',async()=>{
  const {args,sent,mentionCalls,clock}=fixture();
  await start(args);
  assert.equal(mentionCalls.length,1);
  assert.equal(mentionCalls[0].id,'9007199254740993123');
  assert.ok(sent[0].includes(marker('9007199254740993123','𒊮𝐀𝐏𝐄𝐗 정 ᯽')));
  assert.deepEqual(sent.filter(s=>s.startsWith('⏳ ')),['⏳ 5초','⏳ 4초','⏳ 3초','⏳ 2초','⏳ 1초']);
  assert.match(sent.at(-1),/시간 초과/);
  assert.equal(clock.now(),5000);
});

test('selected user ordinary chat within the deadline wins, countdown stops',async()=>{
  const {args,sent,clock}=fixture();
  args.sleep=async ms=>{
    clock.advance(ms);
    receive({roomId:args.roomId,senderId:'9007199254740993123',text:'참여!',now:clock.now});
  };
  await start(args);
  assert.deepEqual(sent.filter(s=>s.startsWith('⏳ ')),['⏳ 5초']);
  assert.match(sent.at(-1),/반응 성공/);
});

test('another user and commands cannot trigger success',async()=>{
  const {args,sent,clock}=fixture();
  args.sleep=async ms=>{
    clock.advance(ms);
    receive({roomId:args.roomId,senderId:'42',text:'안녕',now:clock.now});
    receive({roomId:args.roomId,senderId:'9007199254740993123',text:'#경고',now:clock.now});
    receive({roomId:'different-room',senderId:'9007199254740993123',text:'안녕',now:clock.now});
    receive({roomId:args.roomId,senderId:'9007199254740993123',text:'안녕',isBotAccount:true,now:clock.now});
  };
  await start(args);
  assert.match(sent.at(-1),/시간 초과/);
});

test('a message delivered at or after five seconds is too late',async()=>{
  const {args,sent,clock}=fixture();
  args.sleep=async ms=>{
    clock.advance(ms);
    if(clock.now()===5000) assert.equal(
      receive({roomId:args.roomId,senderId:'9007199254740993123',text:'늦음',now:clock.now}),false);
  };
  await start(args);
  assert.match(sent.at(-1),/시간 초과/);
});

test('authorization blocks non-managers and non-open chats',async()=>{
  const one=fixture({msg:{room:{isOpenChat:true},sender:{type:2}}});
  await start(one.args);
  assert.match(one.sent[0],/방장 또는 부방장/);
  const two=fixture({msg:{room:{isOpenChat:false},sender:{type:1}}});
  await start(two.args);
  assert.match(two.sent[0],/오픈채팅방/);
});

test('concurrent events and cooldown prevent repeated sends',async()=>{
  const {args,sent,clock}=fixture();
  args.sleep=()=>new Promise(()=>{}); // only the winner signal can end this wait
  const first=start(args);
  // Allow asynchronous cached member and initial text sends to complete.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await start(args);
  assert.ok(sent.some(s=>s.includes('이미 5초 이벤트 테스트')));
  const matched=receive({roomId:args.roomId,senderId:'9007199254740993123',text:'안녕',now:clock.now});
  assert.equal(matched,true);
  await first;
  await start(args);
  assert.match(sent.at(-1),/다시 테스트/);
});

test('connection errors abort without false timeout or success',async()=>{
  const {args,sent,clock}=fixture();
  args.sleep=async ms=>{clock.advance(ms);args.client.connected=false;};
  await start(args);
  assert.equal(sent.some(s=>s.includes('시간 초과')),false);
  assert.equal(sent.some(s=>s.includes('반응 성공')),false);
});

test('router runs event and observes later user message',async()=>{
  const {attachRouter}=require('../shared/router');
  let dispatch; const sent=[];
  const target='9007199254740993123';
  const client={
    connected:true,userId:'999',
    onMessage:callback=>{dispatch=callback},
    getCachedMemberProfiles:async()=>[{id:target,name:'APEX 사람'}],
    chat:{
      mention:(id,name)=>marker(id,name),
      sendText:async(_room,text)=>{sent.push(text);}
    }
  };
  attachRouter(client,{ready:Promise.resolve(),game:{message:async()=>{}},management:{message:async()=>false}});
  const a=dispatch({room:{id:'123456',isOpenChat:true},sender:{id:'5',type:1},text:'#이벤진행테스트'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(sent.some(x=>x.includes('5초 반응 이벤트')));
  const b=dispatch({room:{id:'123456',isOpenChat:true},sender:{id:target,type:2},text:'안녕하세요'});
  await b;
  await a;
  assert.match(sent.at(-1),/반응 성공/);
});
