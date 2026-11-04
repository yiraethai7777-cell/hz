'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {QUIZZES}=require('../game/data');
const {pools,next}=require('../game/quiz-difficulty');

test('quiz bank contains 500 unique valid questions with explicit categories',()=>{
 assert.equal(QUIZZES.length,500);
 const normalized=new Set();
 for(const [kind,question,answers] of QUIZZES){
  assert.ok(['수학','일반상식'].includes(kind),'invalid type: '+kind);
  assert.equal(typeof question,'string');
  assert.ok(question.length>0);
  assert.ok(Array.isArray(answers)&&answers.length>0,'missing answer for '+question);
  const key=question.normalize('NFKC').replace(/\s+/g,'').toLowerCase();
  assert.ok(!normalized.has(key),'duplicate question '+question);
  normalized.add(key);
  if(/^\d+\s*[+×x*\-÷/]\s*\d+\s*=\s*\?$/.test(question))assert.equal(kind,'수학',question);
 }
});
test('available quizzes include both subjects at both difficulty levels',()=>{
 const available=pools(QUIZZES);
 for(const tier of ['쉬움','도전'])for(const subject of ['수학','일반상식'])
  assert.ok(available[tier].some(i=>QUIZZES[i][0]===subject),tier+':'+subject);
});
test('each completed 10-question cycle contains exactly 2 math and 8 general-knowledge questions',()=>{
 const shuffle=a=>[...a].reverse();
 for(let trial=0;trial<3;trial++){
  const d={};
  for(let cycle=0;cycle<5;cycle++){
   const kinds=Array.from({length:10},()=>next(d,QUIZZES,shuffle).q[0]);
   assert.equal(kinds.filter(x=>x==='수학').length,2);
   assert.equal(kinds.filter(x=>x==='일반상식').length,8);
  }
 }
});
