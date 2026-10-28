'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {createService,excluded}=require('../shared/junggae-ai');
test('PostgreSQL feedback survives restart, is scoped to alert room, and overrides exact AI decisions',async()=>{
 const pg=new PGlite(),pool={query:(s,p)=>pg.query(s,p)};
 const env={JUNGGAE_AI_ENABLED:'true',JUNGGAE_AI_API_KEY:'test',JUNGGAE_AI_MODEL:'test'};
 let calls=0;
 const fetcher=async(url,opts)=>{calls++;assert.equal(url,'https://api.openai.com/v1/chat/completions');const b=JSON.parse(opts.body);assert.equal(b.store,false);assert.equal(b.messages.length,2);return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'{"is_junggae":true,"confidence":0.95}'}}]})};};
 try{
  const a=createService(()=>pool,fetcher,env);
  assert.equal(await a.classify('거래 도와주실 분?',()=>false),true);
  await a.remember('1000','9007199254740993456','거래 도와주실 분?');
  assert.equal(await a.feedback('2000','9007199254740993456',false,'7777'),false);
  assert.equal(await a.feedback('1000','9007199254740993456',false,'7777'),true);
  const b=createService(()=>pool,fetcher,env);
  assert.equal(await b.classify('거래 도와주실 분?',()=>true),false);assert.equal(calls,1);
  await b.feedback('1000','9007199254740993456',true,'8888');
  assert.equal(await b.classify('거래 도와주실 분?',()=>false),true);
  assert.equal((await b.examples('거래'))[0].label,true);
  assert.equal(await b.classify('템 맡 중개 요청',()=>true),false);
 }finally{await pg.close();}
});
test('AI fails closed on malformed responses, API/DB errors, bad thresholds and low confidence',async()=>{
 const pool={query:async()=>({rows:[]})};
 const env={JUNGGAE_AI_ENABLED:'true',JUNGGAE_AI_API_KEY:'secret',JUNGGAE_AI_MODEL:'test'};
 for(const content of ['{}','bad','{"is_junggae":"true","confidence":1}','{"is_junggae":true,"confidence":0.5}','{"is_junggae":true,"confidence":2}']){
  const a=createService(()=>pool,async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content}}]})}),env);
  assert.equal(await a.classify('준개 요청',()=>true),false);
 }
 for(const fetcher of [async()=>{throw Error('timeout')},async()=>({ok:false,status:429})])assert.equal(await createService(()=>pool,fetcher,env).classify('준개 요청',()=>true),false);
 assert.equal(await createService(()=>{throw Error('DB')},()=>{throw Error('must not call')},env).classify('준개 요청',()=>true),false);
 assert.equal(await createService(()=>pool,()=>{throw Error('must not call')},{...env,JUNGGAE_AI_API_KEY:''}).classify('준개 요청',()=>true),false);
 assert.equal(await createService(()=>pool,()=>{throw Error('must not call')},{}).classify('준개 요청',()=>true),true);
 assert.equal(await createService(()=>pool,()=>{throw Error('must not call')},{...env,JUNGGAE_AI_THRESHOLD:'NaN'}).classify('준개 요청',()=>true),false);
 assert.equal(excluded('템맡'),true);
});
test('AI call budget, input exclusions and strict completion validation',async()=>{
 const pool={query:async()=>({rows:[]})},env={JUNGGAE_AI_ENABLED:'true',JUNGGAE_AI_API_KEY:'test',JUNGGAE_AI_MODEL:'test'};
 let calls=0;const resolve=[];
 const a=createService(()=>pool,async(_,opts)=>{calls++;assert.equal(opts.redirect,'error');assert.ok(opts.signal);await new Promise(r=>resolve.push(r));return {ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'{"is_junggae":true,"confidence":1}'}}]})};},env);
 const pending=[a.classify('첫 요청',()=>true),a.classify('둘 요청',()=>true),a.classify('셋 요청',()=>true)];
 assert.equal(await a.classify('넷 요청',()=>true),false);
 await new Promise(r=>setImmediate(r));assert.equal(calls,3);resolve.forEach(r=>r());assert.deepEqual(await Promise.all(pending),[false,false,false]);
 for(const t of ['!준개맞음','템 맡 준개','거래 완료','중개 취소','x'.repeat(4001)])assert.equal(await a.classify(t,()=>true),false);
 assert.equal(calls,3);
});

test('offline PostgreSQL feedback overrides rules without API keys or calls and survives restart',async()=>{
 const pg=new PGlite(),pool={query:(s,p)=>pg.query(s,p)};
 let calls=0;const noAPI=async()=>{calls++;throw Error('offline must not call API');};
 try{
  const a=createService(()=>pool,noAPI,{JUNGGAE_AI_ENABLED:'false'});
  assert.equal(await a.classify('준개 요청',()=>true),true);
  assert.equal(await a.classify('처음 보는 글',()=>false),false);
  await a.remember('1000','10001','준개 요청');
  await a.feedback('1000','10001',false,'7777');
  const b=createService(()=>pool,noAPI,{});
  assert.equal(await b.classify('준개  요청',()=>{throw Error('negative must override rules');}),false);
  await b.remember('1000','10002','원문 Ａ 도움');
  await b.feedback('1000','10002',true,'7777');
  assert.equal(await b.classify('원문 A  도움',()=>false),true);
  assert.equal(await b.classify('원문 A 도움 주세요',()=>false),false);
  await b.feedback('1000','10002',false,'7777');
  assert.equal(await b.classify('원문 A 도움',()=>true),false);
  await b.remember('1000','10003','템맡');await b.feedback('1000','10003',true,'7777');
  assert.equal(await b.classify('템맡',()=>true),false);
  assert.equal(calls,0);
 }finally{await pg.close();}
});
test('offline feedback DB failure skips alert and schema setup retries',async()=>{
 const pg=new PGlite();let fail=true,apiCalls=0;
 const pool={query:(s,p)=>{if(fail){fail=false;throw Error('DB unavailable');}return pg.query(s,p);}};
 const service=createService(()=>pool,async()=>{apiCalls++;},{JUNGGAE_AI_ENABLED:'false'});
 try{
  assert.equal(await service.classify('준개 요청',()=>true),false);
  assert.equal(await service.classify('준개 요청',()=>true),true);
  assert.equal(apiCalls,0);
 }finally{await pg.close();}
});
