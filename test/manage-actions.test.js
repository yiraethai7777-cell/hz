'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const targets=require('../manage/targets'),action=require('../manage/kick-release'),notice=require('../manage/leave-reply');
const uid='9007199254740993123',log='9007199254740993456';
const db={query:async sql=>({rows:sql.includes('SELECT name')?[{name:'Alice'}]:[]})};
test('ID, actual mention, quoted author and comment root resolve without unsafe guesses',async()=>{
 const base={roomId:'100',client:{userId:'9999'},db};
 assert.equal((await targets.resolve({...base,text:'!내풀 '+uid,msg:{}})).id,uid);
 assert.equal((await targets.resolve({...base,text:'!내풀 @Alice',msg:{attachmentsRaw:[`{"mentions":[{"user_id":${uid}}]}`]}})).id,uid);
 assert.equal((await targets.resolve({...base,text:'!아이디',msg:{message:{type:26},attachmentsRaw:[`{"src_userId":${uid},"src_logId":${log},"src_mentions":[{"user_id":7777}]} `]}})).id,uid);
 assert.equal(await targets.resolve({...base,text:'!내풀 @Alice',msg:{}}),null);
 const comment={message:{type:1},raw:{chatLog:{threadId:log}}};
 const client={userId:'9999',fetchMessage:async()=>({room:{id:'100'},sender:{id:uid,name:'Alice'},message:{logId:log}})};
 assert.equal((await targets.resolve({...base,client,text:'!아이디',msg:comment})).id,uid);
 assert.equal(await targets.resolve({...base,client,roomId:'200',text:'!아이디',msg:comment}),null);
 const noticeDb={query:async()=>({rows:[{target_id:uid,target_name:'퇴장자'}]})};
 assert.equal((await targets.resolve({...base,db:noticeDb,text:'!아이디',msg:comment})).name,'퇴장자');
 assert.equal(targets.exact(Number(uid)),'');
});
test('kick-release orders actions, denies members and reports partial failure honestly',async()=>{
 let calls=[],replies=[];
 const ctx={roomId:'100',userId:'7777',botId:'9999',senderType:1,text:'!내풀 '+uid,
  resolveTarget:async()=>({id:uid,name:'Alice'}),send:async s=>replies.push(s),kick:async()=>calls.push('kick'),unban:async()=>calls.push('unban')};
 await action.handle(ctx,db);assert.deepEqual(calls,['kick','unban']);assert.match(replies.at(-1),/벤한 뒤 해제/);
 calls=[];await action.handle({...ctx,senderType:2},db);assert.deepEqual(calls,[]);
 await action.handle({...ctx,kick:async()=>{throw Error('denied')}},db);assert.deepEqual(calls,[]);assert.match(replies.at(-1),/벤 실패/);
 await action.handle({...ctx,unban:async()=>{throw Error('unban denied')}},db);assert.deepEqual(calls,['kick']);assert.match(replies.at(-1),/벤했지만 해제에 실패/);
 calls=[];await action.handle({...ctx,text:'!벤해제 '+uid},db);assert.deepEqual(calls,['unban']);
 calls=[];await action.handle({...ctx,unban:undefined},db);assert.deepEqual(calls,[]);
});
test('welcome uses real mention markers and folds details; only confirmed basic profile prompts a change',()=>{
 const base={name:'Alice',userId:uid,roomName:'게임방',joins:4,leaves:3,time:'오늘'};
 for(const profileType of [0,16]){
  const text=notice.joinNotice({...base,profileType,profileLink:'https://open.kakao.com/o/example'});
  assert.ok(text.startsWith('\ud83d\udc4b \u0002'+uid+'\u0003Alice\u0004님 안녕하세요!'));
  assert.match(text,/\u200b{1200}/);assert.match(text,/게임방에 오신 걸 환영/);assert.match(text,/입장 4회 · 퇴장 3회/);
  assert.doesNotMatch(text,/변경해주세요/);
  const decoded=require('../src/utils/mention').extractMarkedMentions(text);
  assert.equal(decoded.mentions[0].userId,uid);assert.match(decoded.text,/@Alice님 안녕하세요/);
 }
 assert.match(notice.joinNotice({...base,profileType:1}),/오픈프로필로 변경해주세요/);
 const help=require('../shared/help').formatCommandHelp({manage:true,game:false});
 assert.match(help,/!내풀/);assert.match(help,/!벤해제/);assert.match(help,/답장·댓글/);
 assert.doesNotMatch(help,/!벤등록|!낚시/);assert.match(help,/\u200b{1200}/);
});
test('management routes quoted ID lookup and warning arguments to the resolved user',async()=>{
 const before=process.env.DATABASE_URL;process.env.DATABASE_URL='postgres://localhost/test';
 const {getPool}=require('../shared/db'),pool=getPool(),previous=pool.query,calls=[],replies=[];
 pool.query=async(sql,params)=>{calls.push({sql,params});return {rows:sql.includes('AS enabled')?[{enabled:true}]:sql.includes('count(*)')?[{n:1}]:[],rowCount:0};};
 const manage=require('../manage');
 const ctx={roomId:'100',userId:'7777',botId:'9999',senderType:1,resolveTarget:async()=>({id:uid,name:'Alice'}),send:async s=>replies.push(s)};
 try{
  await manage.message({...ctx,text:'!아이디'});assert.match(replies.at(-1),new RegExp(uid));
  await manage.message({...ctx,text:'!경고 1 테스트'});
  const warning=calls.find(x=>x.sql.startsWith('INSERT INTO gl_manage_warnings'));
  assert.equal(warning.params[1],uid);assert.equal(warning.params[3],'테스트');
  const warningCount=calls.filter(x=>x.sql.startsWith('INSERT INTO gl_manage_warnings')).length;
  await manage.message({...ctx,text:'!경고 1 테스트',resolveTarget:async()=>({id:uid,name:'공식봇',type:8})});
  assert.match(replies.at(-1),/오픈채팅봇에는 경고/);
  assert.equal(calls.filter(x=>x.sql.startsWith('INSERT INTO gl_manage_warnings')).length,warningCount);
  await manage.message({...ctx,text:'!내풀',senderType:2,resolveTarget:async()=>{throw Error('must not resolve');}});
  assert.match(replies.at(-1),/방장·부방장만/);
 }finally{pool.query=previous;if(before===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=before;}
});
test('nickname and profile changes preserve old open links and use a folded plain-text notice',async()=>{
 const {PGlite}=require('@electric-sql/pglite'),storage=new PGlite();
 const pool={query:async(sql,params)=>params?storage.query(sql,params):(await storage.exec(sql)).at(-1)};
 const runtime=require('../shared/runtime').createRuntime({pool,economyEnabled:false});
 try{
  await runtime.initDb();
  assert.equal(await runtime.profileObserve(pool,'100',uid,'Old','https://images/old','https://open.kakao.com/o/old'),null);
  const nameChange=await runtime.profileObserve(pool,'100',uid,'New','https://images/old','https://open.kakao.com/o/old');
  assert.equal(nameChange.profileChanged,false);
  const named=notice.profileNotice(nameChange,'오늘');assert.match(named,/Old → New/);assert.doesNotMatch(named,/###/);assert.match(named,/현재 옾링: https:\/\/open.kakao.com\/o\/old/);assert.match(named,/\u200b{1200}/);
  const profileChange=await runtime.profileObserve(pool,'100',uid,'New','https://images/new','https://open.kakao.com/o/new');
  const changed=notice.profileNotice(profileChange,'오늘');
  assert.match(changed,/New → New/);assert.match(changed,/예전 옾링: https:\/\/open.kakao.com\/o\/old/);assert.match(changed,/현재 옾링: https:\/\/open.kakao.com\/o\/new/);
  assert.equal(await runtime.profileObserve(pool,'100',uid,'New','https://images/new','https://open.kakao.com/o/new'),null);
  assert.equal((await pool.query('SELECT * FROM hz_profiles')).rows.length,2);
  const history=await require('../manage/profile-history').message(pool,'100',{id:uid,name:'New'});
  assert.match(history,/옾링: 2개/);assert.match(history,/https:\/\/open.kakao.com\/o\/old/);assert.match(history,/https:\/\/open.kakao.com\/o\/new/);assert.doesNotMatch(history,/https:\/\/images/);
  const statements=[],exempt=require('../shared/runtime').createRuntime({pool:{query:async sql=>{statements.push(sql);return {rows:[]};}},economyEnabled:false});
  for(let i=0;i<12;i++)await exempt.autoSpamCheck({sender:{type:8}},null,'100',uid,'Official','repeat',false,{manage:true});
  assert.equal(statements.length,0);
 }finally{await storage.close();}
});
test('profile history includes more than 300 unique links with one fold and no image URLs',async()=>{
 const rows=Array.from({length:350},(_,i)=>({link:'https://open.kakao.com/o/link'+i}));
 rows.push(rows[0],{link:'https://images.example/image.jpg'});
 const result=await require('../manage/profile-history').message({query:async(sql,params)=>{assert.doesNotMatch(sql,/LIMIT/i);assert.deepEqual(params,['100',uid]);return {rows};}},'100',{id:uid,name:'Alice'});
 assert.match(result,/옾링: 350개/);assert.match(result,/link349/);assert.equal((result.match(/\u200b{1200}/g)||[]).length,1);
});
test('attendance mentions the attendee and folds details; every full-ranking page folds without dropping users',async()=>{
 const {formatAttendance}=require('../manage/attendance');
 const text=formatAttendance({user:uid,name:'Alice',date:'2026-10-19',time:'01:03:28',position:4,days:1,isNew:true,reward:30000});
 assert.match(text,/\u200b{1200}/);assert.doesNotMatch(text.split('\u200b')[0],/출석 날짜|코인/);assert.match(text,/오늘 4번째/);assert.match(text,/총 획득: 30,000코인/);assert.match(text,/연속 보너스: 0코인/);
 assert.equal(require('../src/utils/mention').extractMarkedMentions(text).mentions[0].userId,uid);
 const rows=Array.from({length:500},(_,i)=>({user_name:'회원'+i,count:1000-i}));
 const rank=require('../manage/chat-ranking');let sql;
 const pages=await rank.messages({query:async q=>{sql=q;return {rows};}},'100',true);
 assert.doesNotMatch(sql,/LIMIT/);assert.ok(pages.length>1);assert.match(pages.join('\n'),/회원499/);
 for(const page of pages){assert.equal((page.match(/\u200b{1200}/g)||[]).length,1);assert.ok(page.length<4500);}
 await rank.messages({query:async q=>{sql=q;return {rows:[]};}},'100',false);assert.match(sql,/LIMIT 10/);
});
require('ts-node/register/transpile-only');
const {KakaoForgeClient}=require('../src/client/client');
test('unban uses exact IDs and verifies server kick list before success',async()=>{
 const client=Object.create(KakaoForgeClient.prototype),requests=[];
 client._resolveChatId=x=>x;client._chatRooms=new Map([['100',{openLinkId:'300'}]]);
 client._carriage={request:async(method,body)=>{requests.push({method,body});return method==='KLSYNC'?{status:0,body:{kickMembers:[]}}:{status:0};}};
 assert.equal((await client.openChatUnkick('100',uid)).verified,true);
 assert.deepEqual(requests.map(x=>x.method),['KLDELITEM','KLSYNC']);
 assert.equal(String(requests[0].body.kid),uid);assert.equal(String(requests[0].body.c),'100');assert.equal(String(requests[0].body.li),'300');
 client._carriage.request=async()=>({status:-1});await assert.rejects(client.openChatUnkick('100',uid),/KLDELITEM failed/);
 client._carriage.request=async method=>method==='KLSYNC'?{status:0,body:{kickMembers:[{userId:uid,c:'100'}]}}:{status:0};
 await assert.rejects(client.openChatUnkick('100',uid),/목록에 남아/);
});
