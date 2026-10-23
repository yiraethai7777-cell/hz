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

test('35ms ticks count 5,4,3,2,1 and then time out',async()=>{
  const {args,sent,mentionCalls,clock}=fixture();
  await start(args);
  assert.equal(mentionCalls.length,1);
  assert.equal(mentionCalls[0].id,'9007199254740993123');
  assert.ok(sent[0].includes(marker('9007199254740993123','𒊮𝐀𝐏𝐄𝐗 정 ᯽')));
  assert.deepEqual(sent.filter(s=>s.startsWith('⏳ ')),['⏳ 5','⏳ 4','⏳ 3','⏳ 2','⏳ 1']);
  assert.match(sent.at(-1),/시간 초과/);
  assert.equal(clock.now(),175);
});

test('selected user ordinary chat within the deadline wins, countdown stops',async()=>{
  const {args,sent,clock}=fixture();
  args.sleep=async ms=>{
    clock.advance(ms);
    receive({roomId:args.roomId,senderId:'9007199254740993123',text:'참여!',now:clock.now});
  };
  await start(args);
  assert.deepEqual(sent.filter(s=>s.startsWith('⏳ ')),['⏳ 5']);
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

test('a message delivered at or after 175ms is too late',async()=>{
  const {args,sent,clock}=fixture();
  args.sleep=async ms=>{
    clock.advance(ms);
    if(clock.now()===175) assert.equal(
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

test('concurrent event is blocked but completed event can restart immediately',async()=>{
  const {args,sent,clock}=fixture();
  args.sleep=()=>new Promise(()=>{}); // finish only after the selected user responds
  const first=start(args);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await start(args);
  assert.ok(sent.some(s=>s.includes('이미 카운트 이벤트 테스트')));
  const matched=receive({roomId:args.roomId,senderId:'9007199254740993123',text:'안녕',now:clock.now});
  assert.equal(matched,true);
  await first;
  args.sleep=async ms=>clock.advance(ms);
  const announcementsBefore=sent.filter(s=>s.includes('35ms 카운트 이벤트')).length;
  await start(args);
  assert.equal(sent.filter(s=>s.includes('35ms 카운트 이벤트')).length, announcementsBefore+1);
  assert.match(sent.at(-1),/시간 초과/);
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
  assert.ok(sent.some(x=>x.includes('35ms 카운트 이벤트')));
  const b=dispatch({room:{id:'123456',isOpenChat:true},sender:{id:target,type:2},text:'안녕하세요'});
  await b;
  await a;
  assert.match(sent.at(-1),/반응 성공/);
});


test('selected user answering during announcement is eliminated before countdown',async()=>{
  const {args,sent,clock}=fixture();
  const selected='9007199254740993123';
  args.send=async message=>{
    sent.push(message);
    if(message.includes('35ms 카운트 이벤트')) {
      assert.equal(receive({roomId:args.roomId,senderId:selected,text:'미리 답장',now:clock.now}),true);
    }
  };
  await start(args);
  assert.match(sent.at(-1),/탈락! 카운트다운이 시작되기 전에/);
  assert.equal(sent.some(x=>x.startsWith('⏳ ')),false);
});

test('answer while first 5 tick is sending is still early',async()=>{
  const {args,sent,clock}=fixture();
  args.send=async message=>{
    sent.push(message);
    if(message === '⏳ 5') {
      assert.equal(receive({roomId:args.roomId,senderId:'9007199254740993123',text:'아직 전',now:clock.now}),true);
    }
  };
  await start(args);
  assert.deepEqual(sent.filter(x=>x.startsWith('⏳ ')),['⏳ 5']);
  assert.match(sent.at(-1),/탈락!/);
});

test('winner response at first 5 tick after successful send is accepted',async()=>{
  const {args,sent,clock}=fixture();
  args.sleep=async ms=>{
    assert.equal(ms,35);
    clock.advance(ms);
    assert.equal(receive({roomId:args.roomId,senderId:'9007199254740993123',text:'이제 답장',now:clock.now}),true);
  };
  await start(args);
  assert.deepEqual(sent.filter(x=>x.startsWith('⏳ ')),['⏳ 5']);
  assert.match(sent.at(-1),/반응 성공/);
});

test('other user answering before countdown cannot eliminate selected user',async()=>{
  const {args,sent,clock}=fixture();
  args.send=async message=>{
    sent.push(message);
    if(message.includes('35ms 카운트 이벤트')) {
      assert.equal(receive({roomId:args.roomId,senderId:'42',text:'내 대답',now:clock.now}),false);
    }
  };
  await start(args);
  assert.match(sent.at(-1),/시간 초과/);
});

test('early elimination allows immediate rerun without cooldown',async()=>{
  const {args,sent,clock}=fixture();
  args.send=async message=>{
    sent.push(message);
    if(message.includes('35ms 카운트 이벤트'))
      receive({roomId:args.roomId,senderId:'9007199254740993123',text:'너무 빨리',now:clock.now});
  };
  await start(args);
  await start(args);
  assert.equal(sent.filter(s=>s.includes('35ms 카운트 이벤트')).length,2);
  assert.equal(sent.filter(s=>s.includes('탈락!')).length,2);
});


test('slow 400ms Kakao message queue cannot end at 5 and 4',async()=>{
  const {args,sent,clock}=fixture();
  args.send=async message=>{
    // Simulate LOCO send queue/response latency independently of the 35ms wait.
    clock.advance(400);
    sent.push(message);
  };
  await start(args);
  assert.deepEqual(sent.filter(s=>s.startsWith('⏳ ')),
    ['⏳ 5','⏳ 4','⏳ 3','⏳ 2','⏳ 1']);
  assert.match(sent.at(-1),/시간 초과/);
  assert.ok(clock.now()>=2175);
});

test('selected user can respond after late 4 tick even beyond 175ms absolute time',async()=>{
  const {args,sent,clock}=fixture();
  args.send=async message=>{
    clock.advance(400);
    sent.push(message);
    if(message==='⏳ 4') {
      assert.equal(receive({
        roomId:args.roomId,senderId:'9007199254740993123',
        text:'4에서 답변',now:clock.now
      }),true);
    }
  };
  await start(args);
  assert.deepEqual(sent.filter(s=>s.startsWith('⏳ ')),['⏳ 5','⏳ 4']);
  assert.match(sent.at(-1),/반응 성공/);
});
