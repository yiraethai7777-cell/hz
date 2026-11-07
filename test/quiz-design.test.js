'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const design=require('../game/quiz-design');
test('quiz chat shows question, time and rewards without disclosing answers',()=>{
 const text=design.questionText({kind:'과학',difficulty:'도전',question:'태양계에서 가장 큰 행성은?',answers:['SECRET'],expiresAt:61000},{now:1000});
 assert.match(text,/🧩 NEXI \| QUIZ/);assert.match(text,/60초/);assert.match(text,/10,000코인/);assert.match(text,/!정답/);assert.doesNotMatch(text,/SECRET/);
});
test('reopening quiz preserves question, scores and balance',()=>{
 const runtime=require('../shared/runtime').createRuntime({pool:{},economyEnabled:false}),room=runtime.blankRoom('테스트');
 room.players={owner:{points:123,wins:7}};runtime.issueQuizOnly(room);const q=structuredClone(room.quiz);
 assert.match(runtime.issueQuizOnly(room),/진행 중인 문제/);assert.deepEqual(room.quiz,q);assert.deepEqual(room.players.owner,{points:123,wins:7});
});
test('quiz question sends exactly one chat message and never invokes photo transport',async()=>{
 const calls=[],send=require('../shared/state')({MORE:'',globalClient:{connected:true,sendPhoto:()=>assert.fail('Quiz must use chat only')}}).send;
 const text=design.questionText({kind:'과학',question:'문제',expiresAt:Date.now()+60000});
 await send({sendText:async(room,body)=>calls.push({room,body})},'1',text);assert.deepEqual(calls,[{room:'1',body:text}]);
});
