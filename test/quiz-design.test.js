'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const design=require('../game/quiz-design');
test('quiz chat shows question, time and rewards without disclosing answers',()=>{
 const text=design.questionText({kind:'과학',difficulty:'도전',question:'태양계에서 가장 큰 행성은?',answers:['SECRET'],expiresAt:61000},{now:1000});
 assert.match(text,/🧩 카카오톡 게임 매니저 \| 퀴즈/);assert.match(text,/60초/);assert.match(text,/10,000코인/);assert.match(text,/!정답/);assert.doesNotMatch(text,/SECRET/);
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

test('quiz question keeps shorter 12-character separators above and below the fold',()=>{
 const text=design.questionText({kind:'상식',question:'문제',expiresAt:61000},{now:1000});
 assert.deepEqual(text.match(/^━+$/gm),['━━━━━━━━━━━━','━━━━━━━━━━━━']);
});
test('correct answer uses unified manager presentation and retains earned rewards',()=>{
 const text=design.correctAnswerText({mention:'@참가자',answer:'목성',reward:10000,xp:30,wins:4,level:3,levelUps:1});
 assert.match(text,/^🧩 카카오톡 게임 매니저 \| 퀴즈 정답/);
 assert.match(text,/🎉 @참가자님, 정답입니다!/);
 assert.match(text,/✅ 정답 : 목성/);
 assert.match(text,/🪙 획득 코인 : \+10,000코인/);
 assert.match(text,/✨ 획득 경험치 : \+30 XP/);
 assert.match(text,/🏆 누적 정답 : 4회/);
 assert.match(text,/🌟 레벨업! Lv\.3/);
 assert.deepEqual(text.match(/^━+$/gm),['━━━━━━━━━━━━','━━━━━━━━━━━━']);
 assert.doesNotMatch(text,/NEXI|KakaoTalk Manager|LEVEL UP|\u200b/);
});
test('correct answer without level up omits promotion line',()=>{
 const text=design.correctAnswerText({mention:'@참가자',answer:'4',reward:10000,xp:30,wins:1,level:1,levelUps:0});
 assert.doesNotMatch(text,/레벨업/);
});

test('fast-path quiz answer uses the same manager design (regression: QUIZ SYSTEM)',()=>{
 const fast=require('../shared/session')({QUIZ_REWARD:10000,QUIZ_XP:30}).fastQuizResult;
 const output=fast({answers:['목성']},'not-numeric','테스터');
 assert.match(output,/^🧩 카카오톡 게임 매니저 \| 퀴즈 정답/);
 assert.match(output,/🎉 @테스터님, 정답입니다!/);
 assert.match(output,/✅ 정답 : 목성/);
 assert.match(output,/🪙 획득 코인 : \+10,000코인/);
 assert.match(output,/✨ 획득 경험치 : \+30 XP/);
 assert.deepEqual(output.match(/^━+$/gm),['━━━━━━━━━━━━','━━━━━━━━━━━━']);
 assert.doesNotMatch(output,/QUIZ SYSTEM|QUIZ RESULT|NEXI|\u200b/);
 assert.doesNotMatch(output,/누적 정답|레벨업/,'fast path must not claim uncommitted totals');
});
test('fast-path KakaoTalk mention token remains native and intact',()=>{
 const fast=require('../shared/session')({QUIZ_REWARD:10000,QUIZ_XP:30}).fastQuizResult;
 const output=fast({answers:['4']},'123456','테스터');
 assert.ok(output.includes('\u0002123456\u0003테스터\u0004'));
});
