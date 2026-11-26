'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BANK,CATEGORIES,normalizeAnswer}=require('../game/quiz-bank'),{createQuiz,TIMEOUT,COOLDOWN,HINT_AT}=require('../game/quiz'),{createCore}=require('../core'),{tableFor}=require('../database');
const msg=(text,log='99999',userId='3000',roomId='1000',receivedAt=100)=>({roomId,userId,text,receivedAt,args:[],msg:{room:{id:roomId,isOpenChat:true},sender:{name:'회원'},message:{type:1,logId:log}}});
test('bank has 1600 distinct questions, exactly 200 per category, valid answer keys and difficulties',()=>{
 assert.equal(BANK.length,8);const seen=new Set();for(let c=0;c<8;c++){assert.equal(BANK[c].length,200);for(const q of BANK[c]){assert.equal(q.category,CATEGORIES[c]);assert.ok(q.answerKeys.size);assert.ok(q.hint);assert.ok(!seen.has(q.question.normalize('NFKC').replace(/\s+/g,'').toLowerCase()));seen.add(q.question.normalize('NFKC').replace(/\s+/g,'').toLowerCase());}assert.equal(new Set(BANK[c].map(q=>q.difficulty)).size,3);}
 assert.equal(seen.size,1600);assert.equal(normalizeAnswer(' １,０００! '),'1000');assert.equal(normalizeAnswer('B T S'),'bts');
});
test('balanced no-repeat draw for all 1600 questions, no implicit reset, room isolation',async()=>{
 let at=100;const out=[],send=async(r,t)=>{out.push(t);return {body:{logId:'9000'}};},quiz=createQuiz({send,now:()=>at,pick:n=>0,delay:()=>({unref(){}}),clear:()=>{},logger:{log(){},error(){}}});
 const e=msg('-퀴즈'),seen=new Set();
 for(let i=0;i<1600;i++){await quiz.start(e);const text=out.at(-1);assert.ok(!seen.has(text));seen.add(text);assert.ok(text.includes('분야 : '+CATEGORIES[i%8]));quiz.cancel('1000');at+=COOLDOWN;}
 assert.match(await quiz.start(e),/1,600문제/);assert.equal(seen.size,1600);
 await quiz.start({...e,roomId:'2000',msg:{...e.msg,room:{id:'2000',isOpenChat:true}}});assert.equal(out.at(-1),[...seen][0]);quiz.reset();
});
test('first answer claims synchronously, raw answers, wrong room, stale log, timeout, disabled, durable history and pending ACK',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-quiz-')),out=[],timers=[];let at=100,enabled=true;let quiz;
 const opts={dir,rewardQuiz:()=>({status:'paid',amount:1000}),send:async(r,t)=>{out.push(t);return {body:{logId:'9000'}};},pick:n=>0,now:()=>at,clock:()=>at,delay:(fn,ms)=>{timers.push({fn,ms});return timers.at(-1);},clear:()=>{},isEnabled:()=>enabled,logger:{log(){},error(){}}};
 try{
  quiz=createQuiz(opts);const core=createCore({send:opts.send});quiz.register(core);await core.handle(msg('-퀴즈','8000'));assert.match(out.at(-1),/7 \+ 3 = \?/);assert.equal(timers[0].ms,HINT_AT);assert.equal(timers[1].ms,TIMEOUT);
  assert.equal(quiz.answer(msg('10','8999')),false);assert.equal(quiz.answer(msg('10','9001','3000','2000')),false);assert.equal(quiz.answer(msg('11','9001')),false);
  assert.equal(quiz.answer(msg('１０!','9001')),true);assert.equal(quiz.answer(msg('10','9002','4000')),false);await Promise.resolve();assert.equal(out.at(-1),'회원님 정답을 맞췄습니다!\n+1000코인');
  quiz=createQuiz(opts);await quiz.start(msg('-퀴즈','9002'));assert.ok(out.at(-1).includes('분야 : 일반'));assert.equal(tableFor('quiz-history/1000.json'),'duke_quiz_history');
  await timers.at(-1).fn();await Promise.resolve();assert.match(out.at(-1),/시간 초과/);
  at+=COOLDOWN;await quiz.start(msg('-퀴즈'));enabled=false;assert.equal(quiz.answer(msg('10','9003')),false);quiz.cancel('1000');enabled=true;
  let ack;const pending=createQuiz({...opts,dir:null,send:(r,t)=>{out.push(t);return t.includes('QUIZ')?new Promise(resolve=>ack=resolve):Promise.resolve({});}});const started=pending.start(msg('-퀴즈','8000','3000','1000',at));
  assert.equal(pending.answer(msg('10','9001','3000','1000',at-1)),false);
  assert.equal(pending.answer(msg('10','8999','3000','1000',at)),true);assert.equal(pending.answer(msg('10','9001','3000','1000',at)),true);ack({body:{logId:'9000'}});await started;await Promise.resolve();assert.equal(out.at(-1),'회원님 정답을 맞췄습니다!\n+1000코인');assert.equal(pending.has('1000'),false);
 }finally{quiz?.reset();fs.rmSync(dir,{recursive:true,force:true});}
});

test('quiz reward updates existing wallet exactly once and persists across reload; no automatic account creation',async()=>{
 const {createGameAccounts}=require('../game/accounts');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-quiz-reward-')),out=[],dirty=[];
 try{
  const send=async(r,t)=>{out.push(t);return {body:{logId:'9000'}};};
  const opts={dir,onPersist:k=>dirty.push(k)},accounts=createGameAccounts(opts),core=createCore({send});accounts.register(core);
  await core.handle(msg('-게임가입','8000'));
  const quiz=createQuiz({dir,send,rewardQuiz:accounts.rewardQuiz,pick:n=>0,logger:{log(){},error(){}}});quiz.register(core);
  await core.handle(msg('-퀴즈','8001'));assert.equal(quiz.answer({...msg('10','9001'),receivedAt:undefined}),true);assert.equal(quiz.answer({...msg('10','9002'),receivedAt:undefined}),false);
  await Promise.resolve();assert.equal(out.at(-1),'회원님 정답을 맞췄습니다!\n+1000코인');
  assert.equal(accounts.get('1000','3000').coins,11000);
  const restored=createGameAccounts(opts);assert.equal(restored.get('1000','3000').coins,11000);
  assert.equal(restored.rewardQuiz('1000','3000',0,'9001','회원').status,'duplicate');
  assert.equal(restored.rewardQuiz('1000','4000',1,'9003','미가입').status,'unregistered');
  assert.equal(restored.get('1000','4000'),null);
  assert.equal(restored.get('1000','3000').coins,11000);
  assert.ok(dirty.includes('game-accounts/1000.json'));
  quiz.reset();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('15 second hint only for unsolved quiz, room cooldown from successful question send, answer cancels timers',async()=>{
 let at=100,enabled=true;const out=[],timers=[],cleared=new Set();
 const send=async(r,t)=>{out.push([r,t]);return {body:{logId:'9000'}};};
 const quiz=createQuiz({send,now:()=>at,clock:()=>at,pick:n=>0,rewardQuiz:()=>({status:'paid'}),isEnabled:()=>enabled,delay:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clear:t=>cleared.add(t),logger:{log(){},error(){}}});
 const e=()=>msg('-퀴즈','8000','3000','1000',at);
 await quiz.start(e());const [hint,timeout]=timers;assert.equal(hint.ms,15000);assert.equal(timeout.ms,60000);
 at+=15000;hint.fn();await Promise.resolve();assert.match(out.at(-1)[1],/^힌트 : /);
 assert.equal(quiz.answer(msg('10','9001','3000','1000',at)),true);await Promise.resolve();assert.equal(out.at(-1)[1],'회원님 정답을 맞췄습니다!\n+1000코인');assert.ok(cleared.has(hint)&&cleared.has(timeout));
 const n=out.length;hint.fn();timeout.fn();await Promise.resolve();assert.equal(out.length,n);
 assert.match(await quiz.start(e()),/15초 후/);
 await quiz.start(msg('-퀴즈','8001','3000','2000',at));assert.ok(quiz.has('2000'));
 at+=14999;assert.match(await quiz.start(e()),/1초 후/);at++;await quiz.start(e());assert.ok(quiz.has('1000'));
 const pendingHint=timers.at(-2);enabled=false;quiz.cancel('1000');const count=out.length;pendingHint.fn();await Promise.resolve();assert.equal(out.length,count);quiz.reset();
});
