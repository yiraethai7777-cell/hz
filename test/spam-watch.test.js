'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createRuntime}=require('../shared/runtime');
const spam=require('../manage/spam');
test('authorized spam toggles persist the setting even for a legacy room without a settings row',async()=>{
 const oldEnv=process.env.DATABASE_URL;process.env.DATABASE_URL='postgres://localhost/test';
 const pool=require('../shared/db').getPool(),oldQuery=pool.query,queries=[],sent=[];
 pool.query=async(sql,params)=>{queries.push({sql,params});return {rows:sql.includes('AS enabled')?[{enabled:true}]:[],rowCount:0};};
 try{
  const manage=require('../manage'),base={roomId:'102',userId:'1001',userName:'방장',senderType:1,send:async t=>sent.push(t)};
  await manage.message({...base,text:'!도배감지켜기'});assert.match(sent.at(-1),/4회 → 경고 1개/);
  await manage.message({...base,text:'!도배감지끄기'});assert.match(sent.at(-1),/껐습니다/);
  const writes=queries.filter(q=>q.sql.includes('spam_enabled=EXCLUDED'));assert.equal(writes.length,2);assert.deepEqual(writes.map(q=>q.params),[['102',true],['102',false]]);
 }finally{pool.query=oldQuery;if(oldEnv===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldEnv;}
});
test('same text or emoji warns once at four and bans at ten; settings, changed content and duplicates reset safely',async()=>{
 let enabled=true,kicks=0,warnings=0;const sent=[];
 const pool={query:async sql=>{if(sql.includes('SELECT spam_enabled'))return {rows:[{spam_enabled:enabled}]};if(sql.includes('INSERT INTO gl_manage_warnings'))warnings++;return {rows:[]};}};
 const runtime=createRuntime({pool,economyEnabled:false});runtime.globalBotId='9999';
 runtime.globalChat={sendText:async(room,text)=>sent.push(text),openChatKick:async()=>{kicks++;return {status:0};}};
 const run=async(i,text='같은 글',type=1,attachment)=>runtime.autoSpamCheck({id:String(i),room:{id:'100'},sender:{id:'2002',type:0},message:{id:String(i),type,text},attachmentsRaw:attachment},runtime.globalChat,'100','2002','사용자',text,false,{manage:true});
 for(let i=1;i<=4;i++)await run(i);assert.equal(warnings,1);assert.equal(kicks,0);
 await run(4);assert.equal(warnings,1);
 for(let i=5;i<=10;i++)await run(i);assert.equal(warnings,1);assert.equal(kicks,1);assert.match(sent.at(-1),/벤했습니다/);
 for(let i=20;i<24;i++)await run(i,'(이모티콘)',20,[{path:'pack/item',timestamp:i}]);assert.equal(warnings,2);
 await run(24,'(이모티콘)',20,[{path:'pack/other'}]);
 for(let i=25;i<28;i++)await run(i,'(이모티콘)',20,[{path:'pack/item',timestamp:i}]);assert.equal(warnings,2);
 enabled=false;await run(28,'(이모티콘)',20,[{path:'pack/item'}]);enabled=true;
 for(let i=30;i<33;i++)await run(i);assert.equal(warnings,2);
 spam.reset('100');await run(33);assert.equal(warnings,2);
 assert.notEqual(spam.fingerprint({message:{type:20},attachmentsRaw:[{path:'one'}]},'(이모티콘)'),spam.fingerprint({message:{type:20},attachmentsRaw:[{path:'two'}]},'(이모티콘)'));
 assert.equal(spam.fingerprint({message:{type:2}},'(사진)'), '');
 for(const type of [1,8])for(let i=0;i<10;i++)await runtime.autoSpamCheck({sender:{type}},null,'100','3003','제외','글',false,{manage:true});assert.equal(kicks,1);
});
test('failed ban status never announces success',async()=>{
 const messages=[],runtime=createRuntime({economyEnabled:false,pool:{query:async()=>({rows:[]})}});runtime.globalBotId='9999';runtime.globalChat={sendText:async(r,s)=>messages.push(s),openChatKick:async()=>({status:-1})};
 for(let i=1;i<=10;i++)await runtime.autoSpamCheck({id:String(i),room:{id:'101'},sender:{id:'2002',type:0}},runtime.globalChat,'101','2002','실패테스트','같음',false,{manage:true});
 assert.match(messages.at(-1),/벤에 실패/);assert.doesNotMatch(messages.at(-1),/벤했습니다/);
});
test('silent profile refresh records nickname, photo and open-link changes without incoming chat',async()=>{
 const {PGlite}=require('@electric-sql/pglite'),storage=new PGlite();
 const query=async(sql,params)=>params?.length?storage.query(sql,params):(await storage.exec(sql)).at(-1);
 const pool={query,connect:async()=>({query,release(){}})},runtime=createRuntime({pool,economyEnabled:false});
 runtime.globalBotId='9999';const sent=[];runtime.globalChat={sendText:async(r,s)=>sent.push(s)};
 try{
  await runtime.initDb();await query('INSERT INTO hz_rooms(room_id,data) VALUES($1,$2::jsonb)',['100',JSON.stringify({manage:true,game:false,players:{}})]);
  let member={id:'9007199254740993123',name:'이전',imageUrl:'old-image',profileType:16,profileLinkId:'11',type:0},link='https://open.kakao.com/o/old';
  const client={getKnownChatRooms:()=>[{id:'100'}],refreshMemberProfiles:async()=>[member],getUserOpenProfileLink:async()=>link};
  const watcher=require('../manage/profile-watch').createWatcher(runtime,client);
  await watcher.tick();assert.equal(sent.length,0);
  member={...member,name:'새 이름',imageUrl:'new-image',profileLinkId:'22'};link='https://open.kakao.com/o/new';
  await watcher.tick();assert.equal(sent.length,1);assert.match(sent[0],/이전 → 새 이름/);assert.match(sent[0],/예전 옾링: https:\/\/open.kakao.com\/o\/old/);assert.match(sent[0],/현재 옾링: https:\/\/open.kakao.com\/o\/new/);
  await watcher.tick();assert.equal(sent.length,1);
  const history=(await query('SELECT * FROM hz_profiles')).rows;assert.equal(history.length,1);assert.equal(history[0].new_open_profile_link,link);
  await query("UPDATE hz_rooms SET data=jsonb_set(data,'{manage}','false') WHERE room_id='100'");member={...member,name:'감지 끈 뒤'};await watcher.tick();assert.equal(sent.length,1);
 }finally{await storage.close();}
});
require('ts-node/register/transpile-only');
test('profile refresh obtains exact live member IDs and profile details from server, ignoring stale cache',async()=>{
 const {KakaoForgeClient}=require('../src/client/client'),client=Object.create(KakaoForgeClient.prototype),id='9007199254740993123',requests=[];
 client._resolveChatId=x=>x;client._cacheMembers=(room,members)=>{assert.equal(String(members[0].userId),id);};
 client.getUserProfileSnapshot=()=>({name:'새 프로필',imageUrl:'new-image',profileType:16,profileLinkId:'22'});client._getCachedMemberType=()=>0;
 client._carriage={memList:async()=>({status:0,body:{members:[{userId:id}]}}),member:async(room,ids)=>{requests.push(ids);return {status:0,body:{members:[{userId:id}]}};}};
 const members=await client.refreshMemberProfiles('100');assert.equal(members[0].id,id);assert.equal(members[0].name,'새 프로필');assert.deepEqual(requests,[[id]]);
 client._carriage.member=async()=>({status:-1});await assert.rejects(client.refreshMemberProfiles('100'),/MEMBER failed/);
});
