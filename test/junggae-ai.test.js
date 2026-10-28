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
test('existing commands, reply authorization, unalerted samples, duplicate messages and bot filtering',async()=>{
 const pg=new PGlite(),pool={query:async(s,p)=>{const r=await pg.query(s,p);return {...r,rowCount:/^SELECT/i.test(s)?r.rows.length:(r.affectedRows??0)};}};
 const dbPath=require.resolve('../shared/db'),notifyPath=require.resolve('../shared/junggae-notify');
 const oldDb=require.cache[dbPath],oldNotify=require.cache[notifyPath];
 require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{getPool:()=>pool}};delete require.cache[notifyPath];
 const feature=require('../shared/junggae-notify');
 if(oldDb)require.cache[dbPath]=oldDb;else delete require.cache[dbPath];
 if(oldNotify)require.cache[notifyPath]=oldNotify;else delete require.cache[notifyPath];
 const saved=process.env.JUNGGAE_AI_ENABLED;process.env.JUNGGAE_AI_ENABLED='false';
 let log=10000;const sent=[];
 const client={sendText:async(room,text)=>{sent.push({room:String(room),text,log:String(++log)});return {status:0,body:{logId:String(log)}};}};
 const ctx=(text,roomId='1000',msg={sender:{id:'7777',type:1}})=>({client,roomId,text,msg,isBotAccount:false});
 try{
  await feature.handle(ctx('!봇방등록'));
  await feature.handle(ctx('!준개방등록 2000'));
  await feature.handle(ctx('!준개알람받기 @A','1000',{sender:{id:'7777'},mentions:[{userId:'8888',name:'A'}]}));
  const m={sender:{id:'7777'},message:{logId:'99000'}};
  await feature.handle(ctx('준개 요청','2000',m));const alert=sent.at(-1);assert.match(alert.text,/준개감지/);assert.equal(alert.room,'1000');
  await feature.handle(ctx('준개 요청','2000',m));assert.equal(sent.at(-1),alert);
  const reply={sender:{id:'7777',type:1},message:{type:26,attachment:JSON.stringify({src_logId:alert.log})}};
  await feature.handle(ctx('!준개아님','1000',reply));assert.match(sent.at(-1).text,/저장 완료/);
  reply.sender.type=2;reply.sender.id='9999';
  await pool.query('CREATE TABLE gl_manage_admins(room_id TEXT,user_id TEXT)');
  await feature.handle(ctx('!준개맞음','1000',reply));assert.match(sent.at(-1).text,/관리자만/);
  reply.sender.type=1;reply.message.attachment='{"src_logId":"55555"}';
  await feature.handle(ctx('!준개맞음','1000',reply));assert.match(sent.at(-1).text,/답장해/);
  await feature.handle(ctx('키워드 없는 놓친 원문','1000',{sender:{id:'7777'},message:{logId:'54321'}}));
  reply.message.attachment='{"src_logId":"54321"}';
  await feature.handle(ctx('!준개맞음','1000',reply));assert.match(sent.at(-1).text,/저장 완료/);
  await feature.handle(ctx('!준개학습검색 놓친'));assert.match(sent.at(-1).text,/놓친 원문/);
  const n=sent.length;
  await feature.handle({...ctx('준개 요청','2000',{sender:{id:'7777'},message:{logId:'99001'}}),isBotAccount:true});
  await feature.handle(ctx('템맡 준개 요청','2000'));assert.equal(sent.length,n);
  await feature.handle(ctx('!준개방목록'));assert.match(sent.at(-1).text,/2000/);
 }finally{if(saved===undefined)delete process.env.JUNGGAE_AI_ENABLED;else process.env.JUNGGAE_AI_ENABLED=saved;await pg.close();}
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
