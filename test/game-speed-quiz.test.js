'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {QUIZZES}=require('../game/data');
const {pools,next}=require('../game/quiz-difficulty');
const createSession=require('../shared/session');

test('quiz bank is split into approachable and challenging questions',()=>{
 const classified=pools(QUIZZES);
 assert.ok(classified['쉬움'].length>=50);
 assert.ok(classified['도전'].length>=50);
 assert.equal(classified['쉬움'].length+classified['도전'].length,QUIZZES.length);
});

test('quiz shuffles 3 easy and 2 challenging questions per five rounds',()=>{
 const d={},shuffle=a=>a.slice().reverse();
 const picks=Array.from({length:50},()=>next(d,QUIZZES,shuffle));
 assert.equal(picks.filter(x=>x.difficulty==='쉬움').length,30);
 assert.equal(picks.filter(x=>x.difficulty==='도전').length,20);
 for(let i=0;i<picks.length;i+=5){
  const segment=picks.slice(i,i+5);
  assert.equal(segment.filter(x=>x.difficulty==='쉬움').length,3);
  assert.equal(segment.filter(x=>x.difficulty==='도전').length,2);
 }
 assert.ok(picks.every(x=>QUIZZES[x.i]===x.q));
 for(let i=1;i<picks.length;i++)assert.notEqual(picks[i].i,picks[i-1].i);
});

test('game command result is sent before slow Kakao profile API lookup',async()=>{
 let callback,releaseProfile,requested=false,gameCalls=0,statCalls=0;
 const responses=[];
 const ctx={
  OWNER_IDS:new Set(),
  pool:{query:async()=>({rows:[]})},
  id:v=>String(v??''),
  initDb:async()=>{},promoTick:async()=>{},autoFishTick:async()=>{},
  roomFlags:async()=>({manage:true,game:true,locked:false,quizEnabled:true}),
  senderExactId:msg=>String(msg.sender.id),
  processMentionAlerts:async()=>{},
  addChatCount:async()=>{statCalls++;},
  saveOpenProfileLink:async()=>{},
  extractProfile:()=>null,findOpenProfileLink:()=>null,
  profileObserve:async()=>null,
  withRoom:async(room,name,fn)=>fn({game:true,locked:false},{}),
  handleGame:async()=>{gameCalls++;return '🎣 낚시 완료';},
  send:async(chat,room,text)=>responses.push(String(text))
 };
 const client={
  userId:'9999',chat:{sendText:async()=>{}},
  onMessage:fn=>{callback=fn;},onJoin(){},onLeave(){},onKick(){},
  getUserProfileSnapshot:()=>({profileLinkId:'present'}),
  getUserOpenProfileLink:async()=>{requested=true;await new Promise(resolve=>releaseProfile=resolve);return 'https://open.kakao.com/o/abc123';}
 };
 const instance=createSession(ctx);
 await instance.attachHZBot(client);
 const event={__nexusGameCommand:true,
  room:{id:'1849',name:'Test'},sender:{id:'5555',name:'Tester',type:2},
  message:{text:'#낚시'}};
 const running=callback(event);
 for(let i=0;i<30&&!requested;i++)await Promise.resolve();
 assert.equal(requested,true,'slow profile lookup must eventually be reached');
 assert.deepEqual(responses,['🎣 낚시 완료'],'game output must precede Kakao API completion');
 assert.equal(gameCalls,1);
 releaseProfile();
 await running;
 assert.equal(gameCalls,1,'game message must never execute twice');
 assert.equal(statCalls,1,'chat stats are still maintained after the early reply');
});

test('!정보 shows saved profile link without slow real-time Kakao API',async()=>{
 const {handle}=require('../game/info');
 let kakaoCalls=0;
 const requests=[],responses=[];
 const db={query:async sql=>{
  requests.push(sql);
  if(sql.includes('SELECT data FROM hz_rooms'))return {rows:[{data:{players:{'5555':{level:5,pets:{}}}}}]};
  if(sql.includes('SELECT balance FROM hz_wallets'))return {rows:[{balance:12345}]};
  if(sql.includes('SELECT count,'))return {rows:[{count:7,rank:2}]};
  if(sql.includes('SELECT open_profile_link FROM hz_members'))return {rows:[{open_profile_link:'https://open.kakao.com/o/abc123'}]};
  return {rows:[]};
 }};
 const context={text:'#정보',roomId:'1849',userId:'5555',userName:'Tester',
  msg:{sender:{id:'5555'}},isBotAccount:true,
  send:async response=>responses.push(response)};
 // Replace the imported pool in the module's dependency graph for the test.
 const original=require.cache[require.resolve('../shared/db')];
 require.cache[require.resolve('../shared/db')]={id:require.resolve('../shared/db'),
  filename:require.resolve('../shared/db'),loaded:true,exports:{getPool:()=>db}};
 delete require.cache[require.resolve('../game/info')];
 try{
  const info=require('../game/info');
  await info.handle(context,{getUserOpenProfileLink:async()=>{kakaoCalls++;return null;}});
 }finally{
  delete require.cache[require.resolve('../game/info')];
  if(original)require.cache[require.resolve('../shared/db')]=original;
  else delete require.cache[require.resolve('../shared/db')];
 }
 assert.equal(kakaoCalls,0);
 assert.equal(requests.length,4);
 assert.ok(responses[0].includes('코인 · ∞'));
 assert.ok(responses[0].includes('https://open.kakao.com/o/abc123'));
});
