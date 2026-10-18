'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createRuntime}=require('../shared/runtime');
const {plainAnswer}=require('../game/quiz');
test('daily net catches ten fish, preserves normal cooldown, persists quota and resets on a Korean calendar day',async()=>{
 const runtime=createRuntime({economyEnabled:false,pool:{}});let day='2026-10-19';
 const ctx=new Proxy(runtime,{get(t,key){return key==='dayK'?()=>day:Reflect.get(t,key);}});
 const {handleGame}=require('../game/features')(ctx),room=runtime.blankRoom('테스트');
 const p=runtime.player(room,'1001','어망 사용자');p.lastFish=12345;
 const msg={room:{id:'1'},sender:{id:'1001',name:'어망 사용자'},text:'!어망'};
 for(let i=1;i<=5;i++){
  const result=await handleGame(room,{}, {...msg,id:'net-'+i},false);
  assert.equal(p.inventory.length,i*10);assert.equal(p.netUses,i);assert.equal(p.lastFish,12345);
  const [visible,details]=result.split('\u200b'.repeat(1200));
  assert.match(visible,/\u00021001\u0003어망 사용자\u0004님의 어망 결과/);assert.doesNotMatch(visible,/코인|cm/);assert.match(details,/10\./);assert.match(details,/코인 보상/);
 }
 const balance=p.points;assert.match(await handleGame(room,{}, {...msg,id:'net-6'},false),/모두 사용/);assert.equal(p.inventory.length,50);assert.equal(p.points,balance);
 const restored=JSON.parse(JSON.stringify(room));assert.match(await handleGame(restored,{}, {...msg,id:'net-7'},false),/모두 사용/);
 day='2026-10-20';assert.match(await handleGame(restored,{}, {...msg,id:'net-next-day'},false),/오늘 1\/5회/);assert.equal(restored.players['1001'].inventory.length,60);
 restored.fishEnabled=false;assert.match(await handleGame(restored,{}, {...msg,id:'net-disabled'},false),/낚시 기능이 꺼져/);assert.equal(restored.players['1001'].netUses,1);
});
test('fishing returns a mentioned compact result without waiting or sending a separate start message',async()=>{
 const runtime=createRuntime({economyEnabled:false,pool:{}});
 const ctx=new Proxy(runtime,{get(t,key){if(key==='sleep'||key==='send')return ()=>assert.fail('Fishing must not wait or send a start message');return Reflect.get(t,key);}});
 const features=require('../game/features')(ctx),room=runtime.blankRoom('테스트');
 const msg={room:{id:'1'},sender:{id:'1001',name:'낚시 테스트'},text:'!낚시'};
 const result=await features.handleGame(room,{},msg,false),[visible,detail]=result.split('\u200b'.repeat(1200));
 assert.match(visible,/\u00021001\u0003낚시 테스트\u0004님의 낚시 결과/);assert.match(visible,/🐟.*cm/);
 assert.doesNotMatch(visible,/코인|경험치|낚시대|판매 예상가/);assert.match(detail,/낚시 보상 · \+/);assert.match(detail,/경험치/);assert.match(detail,/낚시대/);
 assert.equal(room.players['1001'].inventory.length,1);
 assert.match(await features.handleGame(room,{},msg,false),/아직 낚시 준비/);assert.equal(room.players['1001'].inventory.length,1);
});
test('plain answers ignore ordinary chat, stale quizzes, numeric near misses and commands',()=>{
 const q={kind:'수학',answers:['-3'],expiresAt:200};
 assert.equal(plainAnswer(q,' -3 ',100),true);
 for(const text of ['3','그냥 대화','!정답 -3','!-3',''])assert.equal(plainAnswer(q,text,100),false);
 assert.equal(plainAnswer(q,'-3',200),false);assert.equal(plainAnswer(null,'-3',100),false);
 assert.equal(plainAnswer({...q,kind:'넌센스'},'-3',100),false);
 assert.equal(plainAnswer({...q,answers:['서울']},' 서 울! ',100),true);
});
test('plain quiz answers travel through the real session listener; disabled and expired rounds stay silent',async()=>{
 const room={game:true,manage:false,quizEnabled:true,players:{},quiz:{kind:'수학',answers:['4'],expiresAt:Date.now()+60000}},handlers={},replies=[];
 const query=async sql=>({rows:sql.startsWith('SELECT data')?[{data:room}]:[],rowCount:0});
 const pool={query,connect:async()=>({query,release(){}})};
 const runtime=createRuntime({pool,economyEnabled:false});
 const chat={sendText:async(room,text)=>replies.push(text)};
 const client={userId:'1001',chat,onMessage:fn=>handlers.message=fn,onJoin(){},onLeave(){},onKick(){},onDelete(){}};
 const say=text=>handlers.message(chat,{id:'plain-'+text,room:{id:'1'},sender:{id:'1001',name:'테스트'},text});
 try{
  await runtime.attachHZBot(client);
  await say('일반 대화');await say('5');assert.equal(replies.length,0);
  await say('4');assert.match(replies.at(-1),/정답!/);assert.equal(room.players['1001'].wins,1);assert.equal(room.players['1001'].points,10000);
  await say('4');assert.equal(replies.length,1);
  for(const flags of [{game:false,quizEnabled:true},{game:true,quizEnabled:false},{game:true,quizEnabled:true,locked:true}]){
   Object.assign(room,flags);room.quiz={kind:'수학',answers:['4'],expiresAt:Date.now()+60000};await say('4');assert.equal(replies.length,1);
  }
  Object.assign(room,{game:true,quizEnabled:true,locked:false});room.quiz.expiresAt=Date.now()-1;await say('4');assert.equal(replies.length,1);assert.equal(room.players['1001'].points,10000);
 }finally{clearInterval(runtime.promoTimer);clearInterval(runtime.autoFishTimer);}
});
test('updated bank replaces stale question indices and retires a persisted nonsense round without resetting scores',async()=>{
 const runtime=createRuntime({economyEnabled:false,pool:{}}),room=runtime.blankRoom('테스트');room.game=true;
 room.quiz={kind:'넌센스',answers:['소문'],question:'이전 문제',expiresAt:Date.now()+60000};room.quizQueues={수학:[399],일반상식:[999]};
 const p=runtime.player(room,'1001','테스트');p.wins=7;p.points=123;
 const result=await runtime.handleGame(room,{}, {room:{id:'1'},sender:{id:'1001',name:'테스트'},text:'!퀴즈'},false);
 assert.match(result,/답변: 정답만/);assert.notEqual(room.quiz.kind,'넌센스');assert.equal(p.wins,7);assert.equal(p.points,123);
 assert.equal(room.quizBankVersion,'knowledge-math-v2');assert.ok(room.quizQueues[room.quiz.kind].every(i=>i<370));
 const h=require('../shared/help').formatCommandHelp({game:true,manage:true});assert.match(h,/└─ !퀴즈/);assert.doesNotMatch(h,/홍보|도배방지/);assert.equal([...h].filter(c=>c==='\u200b').length,1200);
});
