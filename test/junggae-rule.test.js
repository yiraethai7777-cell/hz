'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {matches}=require('../shared/junggae-rule');
const msg=(type=2,mentions=[{user_id:'1111',at:[1],len:1},{user_id:'2222',at:[2],len:1}])=>({sender:{id:'7777',type},attachmentsRaw:[JSON.stringify({mentions})]});
test('two distinct real mentions plus text from a non-manager is the entire detection rule',()=>{
 assert.equal(matches('@A @B 크낫 1.3',msg()),true);
 assert.equal(matches('@A\n@B 도움',msg()),true);
 assert.equal(matches('@A @B 1.3',msg()),true);
 assert.equal(matches('@A @B 글',msg(1)),true);
 assert.equal(matches('@A @B 글',msg(4)),false);
 assert.equal(matches('@A @B 글',msg(0)),false);
 assert.equal(matches('@A @B 글',{sender:{type:2}}),false);
 assert.equal(matches('@A @B',msg()),false);
 assert.equal(matches('@A @B !!!',msg()),false);
 assert.equal(matches('@A @B 템 맡',msg()),false);
 assert.equal(matches('!명령 @A @B',msg()),false);
 assert.equal(matches('준개 요청',{sender:{type:2}}),false);
 assert.equal(matches('@A @A 글',msg(2,[{user_id:'1111',at:[1,2],len:1}])),false);
 assert.equal(matches('@A @B 글',msg(2,[{user_id:'1111',at:[1],len:1}])),false);
 assert.equal(matches('@긴 이름 @다른 이름',msg(2,[{user_id:'1111',at:[1],len:4},{user_id:'2222',at:[2],len:5}])),false);
 assert.equal(matches('@긴 이름 @다른 이름 아이템',msg(2,[{user_id:'1111',at:[1],len:4},{user_id:'2222',at:[2],len:5}])),true);
 assert.equal(matches('@A @B 글',{sender:{type:2},mentions:[{userId:'1111',name:'A'},{userId:'2222',name:'B'}]}),true);
});
test('registered-room notifications follow mention rule even with AI enabled; registration, dedupe and feedback remain available',async()=>{
 const {PGlite}=require('@electric-sql/pglite');const pg=new PGlite();
 const pool={query:async(s,p)=>{const r=await pg.query(s,p);return {...r,rowCount:/^SELECT/i.test(s)?r.rows.length:(r.affectedRows??0)};}};
 const dbPath=require.resolve('../shared/db'),notifyPath=require.resolve('../shared/junggae-notify');
 const oldDb=require.cache[dbPath],oldNotify=require.cache[notifyPath];
 require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:{getPool:()=>pool}};delete require.cache[notifyPath];
 const feature=require('../shared/junggae-notify');
 if(oldDb)require.cache[dbPath]=oldDb;else delete require.cache[dbPath];
 if(oldNotify)require.cache[notifyPath]=oldNotify;else delete require.cache[notifyPath];
 const saved=process.env.JUNGGAE_AI_ENABLED,oldFetch=global.fetch;process.env.JUNGGAE_AI_ENABLED='true';
 let apiCalls=0;global.fetch=async()=>{apiCalls++;throw Error('must not call API');};
 let log=10000;const sent=[];
 const client={sendText:async(room,text)=>{sent.push({room:String(room),text,log:String(++log)});return {status:0,body:{logId:String(log)}};}};
 const ctx=(text,roomId='1000',message=msg(1))=>({client,roomId,text,msg:message,isBotAccount:false});
 try{
  await feature.handle(ctx('!봇방등록'));await feature.handle(ctx('!준개방등록 2000'));
  await feature.handle(ctx('!준개알람받기 @A','1000',{sender:{id:'7777'},mentions:[{userId:'8888',name:'A'}]}));
  const m={...msg(),message:{logId:'99000'}};
  await feature.handle(ctx('@A @B 크낫 1.3','2000',m));const alert=sent.at(-1);assert.match(alert.text,/준개감지/);assert.equal(alert.room,'1000');
  await feature.handle(ctx('@A @B 크낫 1.3','2000',m));assert.equal(sent.at(-1),alert);
  const reply={sender:{id:'7777',type:1},message:{type:26,attachment:JSON.stringify({src_logId:alert.log})}};
  await feature.handle(ctx('!준개아님','1000',reply));assert.match(sent.at(-1).text,/저장 완료/);
  // Feedback no longer overrides the user's explicit mention criterion.
  const before=sent.length;
  await feature.handle(ctx('@A @B 크낫 1.3','2000',{...m,message:{logId:'99001'}}));assert.equal(sent.length,before+1);
  const n=sent.length;
  for(const [text,room,message,bot]of [
   ['@A @B 글','2000',msg(4),false],['@A @B 글','3000',msg(),false],
   ['@A @B 템맡','2000',msg(),false],['@A @B','2000',msg(),false],
   ['준개 요청','2000',msg(),false],['@A @B 글','2000',msg(),true]
  ])await feature.handle({...ctx(text,room,message),isBotAccount:bot});
  assert.equal(sent.length,n);assert.equal(apiCalls,0);
  await feature.handle(ctx('!준개방목록'));assert.match(sent.at(-1).text,/2000/);
 }finally{global.fetch=oldFetch;if(saved===undefined)delete process.env.JUNGGAE_AI_ENABLED;else process.env.JUNGGAE_AI_ENABLED=saved;await pg.close();}
});
