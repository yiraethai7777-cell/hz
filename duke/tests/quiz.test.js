'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BANK,CATEGORIES,normalizeAnswer}=require('../game/quiz-bank'),{createQuiz,TIMEOUT}=require('../game/quiz'),{createCore}=require('../core'),{tableFor}=require('../database');
const msg=(text,log='99999',userId='3000',roomId='1000',receivedAt=100)=>({roomId,userId,text,receivedAt,args:[],msg:{room:{id:roomId,isOpenChat:true},sender:{name:'회원'},message:{type:1,logId:log}}});
test('bank has 1600 distinct questions, exactly 200 per category, valid answer keys and difficulties',()=>{
 assert.equal(BANK.length,8);const seen=new Set();for(let c=0;c<8;c++){assert.equal(BANK[c].length,200);for(const q of BANK[c]){assert.equal(q.category,CATEGORIES[c]);assert.ok(q.answerKeys.size);assert.ok(!seen.has(q.question.normalize('NFKC').replace(/\s+/g,'').toLowerCase()));seen.add(q.question.normalize('NFKC').replace(/\s+/g,'').toLowerCase());}assert.equal(new Set(BANK[c].map(q=>q.difficulty)).size,3);}
 assert.equal(seen.size,1600);assert.equal(normalizeAnswer(' １,０００! '),'1000');assert.equal(normalizeAnswer('B T S'),'bts');
});
test('balanced no-repeat draw for all 1600 questions, no implicit reset, room isolation',async()=>{
 const out=[],send=async(r,t)=>{out.push(t);return {body:{logId:'9000'}};},quiz=createQuiz({send,pick:n=>0,delay:()=>({unref(){}}),clear:()=>{},logger:{log(){},error(){}}});
 const e=msg('-퀴즈'),seen=new Set();
 for(let i=0;i<1600;i++){await quiz.start(e);const text=out.at(-1);assert.ok(!seen.has(text));seen.add(text);assert.ok(text.includes('분야 : '+CATEGORIES[i%8]));quiz.cancel('1000');}
 assert.match(await quiz.start(e),/1,600문제/);assert.equal(seen.size,1600);
 await quiz.start({...e,roomId:'2000',msg:{...e.msg,room:{id:'2000',isOpenChat:true}}});assert.equal(out.at(-1),[...seen][0]);quiz.reset();
});
test('first answer claims synchronously, raw answers, wrong room, stale log, timeout, disabled, durable history and pending ACK',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-quiz-')),out=[],timers=[];let at=100,enabled=true;let quiz;
 const opts={dir,send:async(r,t)=>{out.push(t);return {body:{logId:'9000'}};},pick:n=>0,now:()=>at,clock:()=>at,delay:(fn,ms)=>{timers.push({fn,ms});return timers.at(-1);},clear:()=>{},isEnabled:()=>enabled,logger:{log(){},error(){}}};
 try{
  quiz=createQuiz(opts);const core=createCore({send:opts.send});quiz.register(core);await core.handle(msg('-퀴즈','8000'));assert.match(out.at(-1),/7 \+ 3 = \?/);assert.equal(timers[0].ms,TIMEOUT);
  assert.equal(quiz.answer(msg('10','8999')),false);assert.equal(quiz.answer(msg('10','9001','3000','2000')),false);assert.equal(quiz.answer(msg('11','9001')),false);
  assert.equal(quiz.answer(msg('１０!','9001')),true);assert.equal(quiz.answer(msg('10','9002','4000')),false);await Promise.resolve();assert.equal(out.at(-1),'회원님 정답입니다!');
  quiz=createQuiz(opts);await quiz.start(msg('-퀴즈','9002'));assert.ok(out.at(-1).includes('분야 : 일반'));assert.equal(tableFor('quiz-history/1000.json'),'duke_quiz_history');
  await timers.at(-1).fn();await Promise.resolve();assert.match(out.at(-1),/시간 초과/);
  await quiz.start(msg('-퀴즈'));enabled=false;assert.equal(quiz.answer(msg('10','9003')),false);quiz.cancel('1000');enabled=true;
  let ack;const pending=createQuiz({...opts,dir:null,send:(r,t)=>{out.push(t);return t.includes('QUIZ')?new Promise(resolve=>ack=resolve):Promise.resolve({});}});const started=pending.start(msg('-퀴즈','8000'));
  assert.equal(pending.answer(msg('10','8999')),true);assert.equal(pending.answer(msg('10','9001')),true);ack({body:{logId:'9000'}});await started;await Promise.resolve();assert.equal(out.at(-1),'회원님 정답입니다!');assert.equal(pending.has('1000'),false);
 }finally{quiz?.reset();fs.rmSync(dir,{recursive:true,force:true});}
});
