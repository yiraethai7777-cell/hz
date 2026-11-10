'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {install,transform}=require('../shared/manager-output');
const ranking=require('../manage/chat-ranking');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('all sent and edited messages use KakaoTalk Manager without changing payloads or DB',async()=>{
 const events=[],client={chat:{
  sendText:async(room,body)=>{events.push({kind:'send',room,body});return {complete:{status:0}};},
  editMessage:async(room,log,body)=>{events.push({kind:'edit',room,log,body});return {status:0};}
 }};
 install(client);install(client);
 await client.chat.sendText('100','🎣 NEXI | 낚시 결과 / 넥시');
 await client.chat.editMessage('100','55','⛏ NEXI | 광질중...');
 assert.equal(events.length,2);
 assert.equal(events[0].body,'🎣 카카오톡 매니저 | 낚시 결과 / 카카오톡 매니저');
 assert.equal(events[1].body,'⛏ 카카오톡 매니저 | 광질중...');
 assert.equal(transform('🧩 NEXI | QUIZ'),'🧩 카카오톡 매니저 | QUIZ');
 assert.equal(transform({text:'NEXI'}).text,'NEXI','non-text payloads are unchanged');
});

test('both chat ranking commands use text; TOP 10 is branded',()=>{
 const command=read('manage/commands-v2.js');
 assert.match(command,/if\(cmd==='!채팅순위'\)\{\s*\/\/ Chat-only TOP 10;/);
 assert.match(command,/for\(const message of await chatRanks\(db,room,false,ctx\.botId\)\)await send\(message\)/);
 assert.match(command,/if\(cmd==='!채팅순위전체'\)/);
 assert.doesNotMatch(command,/sendRankingImage|chat-ranking-image/);
 const formatted=ranking.format([{user_name:'민수',count:'12'}])[0];
 assert.match(formatted,/^💬 카카오톡 관리 매니저 \| 채팅 순위 TOP 10/);
 assert.match(formatted,/1\. 민수: 12회/);
});

test('chat ranking includes proportional text bars without using the image transport',async()=>{
 const db={query:async(sql,args)=>{
  assert.match(sql,/FROM gl_manage_chat_counts/);
  assert.deepEqual(args,['100','9999']);
  return {rows:[
   {user_id:'1001',user_name:'민수',count:'120'},
   {user_id:'1002',user_name:'영희',count:'60'}
  ]};
 }};
 const messages=await ranking.messages(db,'100',false,'9999');
 assert.equal(messages.length,1);
 assert.match(messages[0],/^💬 카카오톡 관리 매니저 \| 채팅 순위 TOP 10/);
 assert.match(messages[0],/1\. 민수 · 120회\n┃ █{16}/);
 assert.match(messages[0],/2\. 영희 · 60회\n┃ █{8}░{8}/);
 const full=await ranking.messages(db,'100',true,'9999');
 assert.equal(full.length,1);
 assert.match(full[0],/전체 채팅 순위/);
});

test('mining output is immediately sent exactly once; no progress sender is linked',()=>{
 const mining=read('game/mining.js');
 assert.match(mining,/await ctx\.send\(result\);console\.log/);
 assert.doesNotMatch(mining,/mining-progress|\.editMessage\(/);
 const cmd=read('game/index.js');
 assert.match(cmd,/require\('\.\/mining'\)\.handle/);
});

test('legacy Valorant commands are not in new help or active game aliases',()=>{
 const help=read('shared/help.js'),aliases=read('game/command-aliases.js');
 for(const token of ['!발로전적','!스킨','!내전예약','!듀오모집','!파티모집']){
  assert.equal(help.includes(token),false,token);
 }
 assert.equal(require('../game/command-aliases').isGameCommand('!발로전적'),false);
 assert.equal(require('../game/command-aliases').isGameCommand('!낚시'),true);
 assert.match(aliases,/const RETIRED=new Set/);
});
