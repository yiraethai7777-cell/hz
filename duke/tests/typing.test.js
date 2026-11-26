'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createTyping,countKeys,protect,BANK,TIMEOUT}=require('../game/typing'),{createCore}=require('../core');
const ev=(text,log='8000',at=100,r='1000',u='3000',args=[])=>({roomId:r,userId:u,text,args,receivedAt:at,msg:{room:{id:r,isOpenChat:true},sender:{name:'회원'},message:{type:1,logId:log}}});
test('60 original sentences and two-set Korean keystroke estimation',()=>{
 const all=Object.values(BANK).flat();assert.equal(all.length,60);assert.equal(new Set(all.map(x=>x.text)).size,60);for(const list of Object.values(BANK))assert.equal(list.length,20);
 assert.equal(countKeys('한글'),6);assert.equal(countKeys('과 값 꽤'),3+1+4+1+3);assert.equal(countKeys('가 A1.'),6);assert.equal(countKeys('까'),2);assert.equal(countKeys('한'),3);
 for(const q of all){assert.notEqual(q.text,q.shown);assert.equal(q.shown.replace(/\u00a0/g,' '),q.text);assert.equal(q.shown.includes(' '),false);assert.equal(q.keys,countKeys(q.text));}
});
test('typing command, raw receive time, literal copy rejection, first winner and independent rooms',async()=>{
 let at=100,enabled=true;const out=[],timers=[],cleared=new Set();const send=async(r,t)=>{out.push([r,t]);return {body:{logId:'9000'}};};
 const g=createTyping({send,clock:()=>at,pick:n=>0,isEnabled:()=>enabled,delay:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clear:t=>cleared.add(t),logger:{log(){},error(){}}});const core=createCore({send});g.register(core);
 await core.handle(ev('-타자게임 쉬움'));const q=BANK.쉬움[0];assert.ok(out.at(-1)[1].includes(q.shown));assert.equal(timers[0].ms,TIMEOUT);
 assert.match(await g.start(ev('-타자게임','8001',at)),/진행 중/);
 at=10100;assert.equal(g.answer(ev(q.shown,'9001',at)),true);assert.ok(g.has('1000'));assert.equal(g.answer(ev(q.text+' ','9002',at)),false);
 assert.equal(g.answer(ev(q.text,'8999',at)),false);assert.equal(g.answer(ev(q.text,'9002',at,'2000')),false);assert.equal(g.answer(ev(q.text,'9003',100)),false);
 at=10300;assert.equal(g.answer(ev(q.text,'9003',10100)),true);assert.equal(g.answer(ev(q.text,'9004',10101,'1000','4000')),false);await Promise.resolve();
 assert.match(out.at(-1)[1],/회원님 타자 성공!/);assert.ok(out.at(-1)[1].includes('타수 : '+Math.round(q.keys*6).toLocaleString('ko-KR')+'타/분'));assert.match(out.at(-1)[1],/10\.000초/);assert.ok(cleared.has(timers[0]));
 await g.start(ev('-타자게임','9010',at,'1000','3000',['쉬움']));assert.ok(out.at(-1)[1].includes(BANK.쉬움[1].shown));
 await g.start(ev('-타자게임','9011',at,'2000','3000',['어려움']));assert.ok(out.at(-1)[1].includes(BANK.어려움[0].shown));enabled=false;assert.equal(g.answer(ev(BANK.어려움[0].text,'9020',at+1000,'2000')),false);g.reset();assert.equal(g.has('1000'),false);
});
test('typing timeout and no score before acknowledgement',async()=>{
 let at=100,ack;const out=[],timers=[];const g=createTyping({send:(r,t)=>{out.push(t);return t.includes('TYPING')?new Promise(resolve=>ack=resolve):Promise.resolve({});},clock:()=>at,pick:n=>0,delay:(fn,ms)=>{timers.push(fn);return {}},clear:()=>{},logger:{log(){},error(){}}});
 const start=g.start(ev('-타자게임'));assert.equal(g.answer(ev(BANK.쉬움[0].text,'9001',at+1)),true);at+=100;ack({body:{logId:'9000'}});await start;assert.ok(g.has('1000'));at+=TIMEOUT;assert.equal(g.answer(ev(BANK.쉬움[0].text,'9002',at)),false);timers[0]();await Promise.resolve();assert.match(out.at(-1),/시간이 초과/);assert.equal(g.has('1000'),false);
});
