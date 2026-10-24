'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {start,receive,startUntilWinner,stopUntilWinner}=require('../shared/event-reaction-test');

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
    loadSettings:async()=>require('../shared/event-settings').DEFAULTS,
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
  for(let i=0;i<25&&!sent.includes('⏳ 5');i++)
    await new Promise(resolve=>setImmediate(resolve));
  assert.ok(sent.some(x=>x.includes('35ms 카운트 이벤트')));
  assert.ok(sent.includes('⏳ 5'));
  // User reply becomes valid only after the first tick has been delivered.
  await new Promise(resolve=>setImmediate(resolve));
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
  assert.match(sent.at(-1),/탈락!/);
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


test('custom announcement precedes the prominent real mention',async()=>{
  const {args,sent}=fixture();
  args.loadSettings=async()=>({
    speedMs:35,announcement:'🎁 오늘의 특별 이벤트 안내!',
    winMessage:'✅ {멘션}님 대단해요!',
    earlyMessage:'🚫 너무 빠른 답변',timeoutMessage:'⌛ 이벤트 종료'
  });
  await start(args);
  assert.match(sent[0],/📢 APEX 이벤트 공지/);
  assert.match(sent[0],/오늘의 특별 이벤트 안내!/);
  assert.match(sent[1],/📣📣📣/);
  assert.ok(sent[1].includes(marker('9007199254740993123','𒊮𝐀𝐏𝐄𝐗 정 ᯽')));
  assert.match(sent.at(-1),/이벤트 종료/);
});

test('custom 650ms speed is applied after every confirmed countdown send',async()=>{
  const {args,sent,clock}=fixture();
  const calls=[];
  args.loadSettings=async()=>({speedMs:650});
  args.sleep=async ms=>{calls.push(ms);clock.advance(ms);};
  await start(args);
  assert.deepEqual(calls,[650,650,650,650,650]);
  assert.equal(clock.now(),3250);
  assert.match(sent[0],/650ms 카운트 이벤트/);
  assert.equal(sent.filter(x=>x.startsWith('⏳ ')).length,5);
});

test('custom winner message keeps a real mention even without {멘션}',async()=>{
  const {args,sent,clock}=fixture();
  args.loadSettings=async()=>({
    speedMs:35,winMessage:'🥇 {닉네임}님 당첨! 후보 {인원}명'
  });
  args.sleep=async ms=>{
    clock.advance(ms);
    receive({roomId:args.roomId,senderId:'9007199254740993123',
      text:'성공!',now:clock.now});
  };
  await start(args);
  assert.match(sent.at(-1),/당첨! 후보 1명/);
  assert.ok(sent.at(-1).includes(marker('9007199254740993123','𒊮𝐀𝐏𝐄𝐗 정 ᯽')));
});

test('custom early elimination message replaces default text',async()=>{
  const {args,sent,clock}=fixture();
  args.loadSettings=async()=>({earlyMessage:'🚨 {닉네임} 너무 서둘렀어요'});
  args.send=async value=>{
    sent.push(value);
    if(value.includes('35ms 카운트 이벤트'))
      receive({roomId:args.roomId,senderId:'9007199254740993123',
        text:'너무 빨리',now:clock.now});
  };
  await start(args);
  assert.match(sent.at(-1),/너무 서둘렀어요/);
});


test('answer during saved event notice also counts as before countdown',async()=>{
  const {args,sent,clock}=fixture();
  args.loadSettings=async()=>({announcement:'📌 지금부터 이벤트를 시작합니다!'});
  args.send=async message=>{
    sent.push(message);
    if(message.includes('지금부터 이벤트를 시작합니다')) {
      assert.equal(receive({roomId:args.roomId,
        senderId:'9007199254740993123',text:'미리 대답',now:clock.now}),true);
    }
  };
  await start(args);
  assert.match(sent.at(-1),/탈락!/);
  assert.equal(sent.some(x=>x.startsWith('⏳ ')),false);
});


test('!이벤트시작 repeats after timeout, excludes last candidate, and stops on the first winner',async()=>{
 const {args,sent,mentionCalls,clock}=fixture();
 args.client.getCachedMemberProfiles=async()=>[
  {id:'9007199254740993123',name:'APEX 첫째'},
  {id:'9007199254740993124',name:'APEX 둘째'}
 ];
 let rounds=0;
 args.send=async text=>{sent.push(text);if(text.includes('선택된 도전자'))rounds++;};
 args.betweenRounds=async()=>{};
 args.sleep=async ms=>{
  clock.advance(ms);
  if(rounds===2)receive({roomId:args.roomId,senderId:'9007199254740993124',
    text:'5부터 답변',now:clock.now});
 };
 const result=await startUntilWinner(args);
 assert.equal(result,'success');
 assert.equal(rounds,2);
 assert.deepEqual(mentionCalls.map(c=>c.id),['9007199254740993123','9007199254740993124']);
 assert.deepEqual(sent.filter(t=>t.startsWith('⏳ ')),
  ['⏳ 5','⏳ 4','⏳ 3','⏳ 2','⏳ 1','⏳ 5']);
 assert.equal(sent.filter(t=>t.includes('다음 참가자를 추첨')).length,1);
 assert.equal(sent.filter(t=>t.includes('🎯 이벤트 종료')).length,1);
 assert.match(sent.at(-1),/반응 성공/);
 assert.equal(sent.some(t=>t.includes('테스트 전용')),false);
});

test('!이벤트시작 repeats after early reply without treating it as a win',async()=>{
 const {args,sent,clock}=fixture();
 let rounds=0;
 args.send=async text=>{
  sent.push(text);
  if(text.includes('선택된 도전자')){
   rounds++;
   if(rounds===1)receive({roomId:args.roomId,senderId:'9007199254740993123',
     text:'너무 빨리',now:clock.now});
  }
 };
 args.betweenRounds=async()=>{};
 args.sleep=async ms=>{
  clock.advance(ms);
  if(rounds===2)receive({roomId:args.roomId,senderId:'9007199254740993123',
    text:'성공',now:clock.now});
 };
 assert.equal(await startUntilWinner(args),'success');
 assert.equal(rounds,2);
 assert.equal(sent.filter(t=>t.startsWith('⏳ ')).length,1);
 assert.equal(sent.filter(t=>t.includes('다음 참가자를 추첨')).length,1);
 assert.equal(sent.filter(t=>t.includes('🎯 이벤트 종료')).length,1);
 assert.match(sent.at(-1),/축하합니다/);
});

test('!이벤트중지 interrupts a running countdown and rejects a duplicate start',async()=>{
 const {args,sent}=fixture();
 args.sleep=()=>new Promise(()=>{});
 const first=startUntilWinner(args);
 for(let i=0;i<50&&!sent.includes('⏳ 5');i++)
  await new Promise(resolve=>setImmediate(resolve));
 assert.ok(sent.includes('⏳ 5'));
 assert.equal(await startUntilWinner(args),'busy');
 assert.equal(await stopUntilWinner(args),true);
 assert.equal(await first,'cancelled');
 assert.equal(sent.filter(t=>t.includes('이벤트가 중지되었습니다.')).length,1);
 assert.equal(sent.some(t=>t.includes('🎯 이벤트 종료')),false);
 assert.equal(sent.some(t=>t.includes('반응 성공')),false);
});

test('!이벤트시작 requires room host permissions and valid candidates',async()=>{
 const noAuth=fixture({msg:{room:{isOpenChat:true},sender:{type:2}}});
 assert.equal(await startUntilWinner(noAuth.args),'unauthorized');
 assert.match(noAuth.sent.at(-1),/방장 또는 부방장/);
 const empty=fixture();
 empty.args.client.getCachedMemberProfiles=async()=>[];
 assert.equal(await startUntilWinner(empty.args),'no-candidates');
 assert.match(empty.sent.at(-1),/APEX 참가자가 없습니다/);
});

test('event control commands cannot count as a winning response',async()=>{
 const {args,sent,clock}=fixture();
 args.sleep=async ms=>{
  clock.advance(ms);
  assert.equal(receive({roomId:args.roomId,senderId:'9007199254740993123',
    text:'!이벤트중지',now:clock.now}),false);
 };
 await start(args);
 assert.match(sent.at(-1),/시간 초과/);
});
