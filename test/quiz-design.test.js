'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const design=require('../game/quiz-design');
test('quiz layout hides answer data, escapes markup and wraps long questions',()=>{
 const q={kind:'과학',difficulty:'도전',question:'<태양> & '.repeat(20),answers:['SECRET'],expiresAt:61000};
 const text=design.questionText(q,{now:1000});assert.match(text,/60초/);assert.doesNotMatch(text,/SECRET/);
 const image=design.svg(text);assert.match(image,/#0b1526/);assert.match(image,/&lt;태양&gt;/);assert.doesNotMatch(image,/<태양>/);assert.ok(design.wrap(q.question).length>1);
});
test('quiz issue preserves active round and reward state while using unified design',()=>{
 const runtime=require('../shared/runtime').createRuntime({pool:{},economyEnabled:false});const room=runtime.blankRoom('테스트');
 room.players={owner:{points:123,wins:7}};const text=runtime.issueQuizOnly(room);const q=structuredClone(room.quiz);
 assert.match(text,/NEXI \| QUIZ/);assert.match(text,/10,000코인/);
 assert.match(runtime.issueQuizOnly(room),/진행 중인 퀴즈/);assert.deepEqual(room.quiz,q);assert.deepEqual(room.players.owner,{points:123,wins:7});
});
test('quiz photo failure falls back to text without holding command dispatch',async()=>{
 const calls=[];let fallback;const done=new Promise(r=>fallback=r);
 const send=require('../shared/state')({MORE:'',globalClient:{connected:true,sendPhoto:async()=>{calls.push('photo');throw Error('simulated upload failure');}}}).send;
 const text=design.questionText({kind:'과학',difficulty:'보통',question:'문제',expiresAt:Date.now()+60000});
 await send({sendText:async(room,body)=>{assert.equal(body,text);calls.push('text');fallback();}},'1',text);
 assert.equal(calls.length,0);await done;assert.deepEqual(calls,['photo','text']);
});
test('quiz missing photo capability uses text fallback',async()=>{
 let finish;const done=new Promise(r=>finish=r),calls=[];
 const send=require('../shared/state')({MORE:'',globalClient:{}}).send;
 await send({sendText:async()=>{calls.push('text');finish();}},'1',design.questionText({kind:'과학',question:'문제',expiresAt:Date.now()+60000}));
 await done;assert.deepEqual(calls,['text']);
});
test('quiz successful image delivery does not also send a text question',async()=>{
 let finish;const done=new Promise(r=>finish=r);let texts=0;
 const send=require('../shared/state')({MORE:'',globalClient:{connected:true,sendPhoto:async()=>{finish();return {complete:{status:0}};}}}).send;
 await send({sendText:async()=>{texts++;}},'1',design.questionText({kind:'과학',question:'문제',expiresAt:Date.now()+60000}));
 await done;assert.equal(texts,0);
});
