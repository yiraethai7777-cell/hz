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

test('game reply does not wait for Kakao profile lookup or room profile lock',async()=>{
 let callback,requested=false,gameCalls=0,statCalls=0,profileCalls=0,roomCalls=0;
 const responses=[];
 const pool={query:async()=>({rows:[]})};
 const ctx={
  OWNER_IDS:new Set(),pool,
  id:v=>String(v??''),
  initDb:async()=>{},promoTick:async()=>{},autoFishTick:async()=>{},
  roomFlags:async()=>({manage:true,game:true,locked:false,quizEnabled:true}),
  senderExactId:msg=>String(msg.sender.id),
  processMentionAlerts:async()=>{},
  addChatCount:async()=>{statCalls++;},
  saveOpenProfileLink:async()=>{},
  extractProfile:()=>null,findOpenProfileLink:()=>null,
  profileObserve:async db=>{assert.equal(db,pool);profileCalls++;return null;},
  withRoom:async(room,name,fn)=>{roomCalls++;return fn({game:true,locked:false},{});},
  handleGame:async()=>{gameCalls++;return '🎣 낚시 완료';},
  send:async(chat,room,text)=>responses.push(String(text))
 };
 const client={
  userId:'9999',chat:{sendText:async()=>{}},
  onMessage:fn=>{callback=fn;},onJoin(){},onLeave(){},onKick(){},
  getUserProfileSnapshot:()=>({profileLinkId:'present'}),
  getUserOpenProfileLink:async()=>{requested=true;return 'https://open.kakao.com/o/abc123';}
 };
 await createSession(ctx).attachHZBot(client);
 const event={__nexusGameCommand:true,
  room:{id:'1849',name:'Test'},sender:{id:'5555',name:'Tester',type:2},
  message:{text:'#낚시'}};
 await callback(event);
 assert.deepEqual(responses,['🎣 낚시 완료']);
 assert.equal(gameCalls,1,'do not execute the game command twice');
 assert.equal(statCalls,1,'preserve chat counts');
 assert.equal(profileCalls,1,'preserve profile checks');
 assert.equal(roomCalls,1,'profile tracking must not lock the game room again');
 assert.equal(requested,false,'game command must never invoke the slow Kakao profile API');
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

test('fast game handler never intercepts game reset or quiz control commands',async()=>{
 let callback,gameCalls=0;
 const responses=[],room={game:true,manage:false,locked:false,quizEnabled:false};
 const ctx={
  OWNER_IDS:new Set(['7777']),pool:{query:async()=>({rows:[]})},
  id:v=>String(v??''),initDb:async()=>{},promoTick:async()=>{},autoFishTick:async()=>{},
  roomFlags:async()=>({...room}),senderExactId:msg=>String(msg.sender.id),
  processMentionAlerts:async()=>{},addChatCount:async()=>{},saveOpenProfileLink:async()=>{},
  extractProfile:()=>null,findOpenProfileLink:()=>null,
  withRoom:async(rid,name,fn)=>fn(room,{}),
  handleGame:async()=>{gameCalls++;return 'Should not run';},
  send:async(chat,roomId,text)=>responses.push(String(text))
 };
 const client={
  userId:'9999',chat:{},onMessage:cb=>{callback=cb},
  onJoin(){},onLeave(){},onKick(){}
 };
 await createSession(ctx).attachHZBot(client);
 const send=async text=>callback({
  __nexusGameCommand:true,room:{id:'1849'},sender:{id:'7777',name:'Owner'},
  message:{text}
 });
 await send('#초기화');
 assert.equal(gameCalls,0);
 assert.ok(room.gameResetRequest);
 assert.match(responses.at(-1),/!초기화확인/);
 await send('#퀴즈작동');
 assert.equal(gameCalls,0);
 assert.equal(room.quizEnabled,true);
 assert.match(responses.at(-1),/퀴즈 ON/);
});
