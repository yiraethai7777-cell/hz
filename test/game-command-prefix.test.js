'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const aliases=require('../game/command-aliases');
const help=require('../shared/help');

function load(relative,deps){
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..',relative),'utf8'),{
  module,exports:module.exports,console,process,Date,Intl,Promise,Set,Map,Number,RegExp,
  setTimeout,clearTimeout,setInterval,clearInterval,
  require(name){
   if(Object.prototype.hasOwnProperty.call(deps,name))return deps[name];
   throw Error('Unexpected dependency in '+relative+': '+name);
  }
 },{filename:relative});
 return module.exports;
}
function createFixture(){
 const calls=[],writes=[];
 let listener;
 const pool={query:async (sql,params)=>{calls.push(['query',String(sql).slice(0,30)]);return {rows:[{data:{game:true,quizEnabled:true,fishEnabled:true}}]};}};
 const client={userId:'9999',onMessage(cb){listener=cb;},connected:true};
 const deps={
  '../shared/db':{getPool:()=>pool,testConnection:async()=>{}},
  './wallet':{initWallet:async()=>{}},
  './members':{initMembers:async()=>{}},
  './coin':{initCoinExtra:async()=>{}},
  './commands':{message:async ctx=>calls.push(['market',ctx.text,ctx.msg.message.text])},
  '../api/schema':{init:async()=>{}},
  './economy':{init:async()=>{},ensureLinked:async()=>{}},
  './farm':{init:async()=>{},handle:async ctx=>{if(ctx.text==='#농장'){calls.push(['farm',ctx.text]);return true;}return false;}},
  '../shared/runtime':{attachModules:async adapter=>adapter.onMessage(async(chat,msg)=>calls.push(['legacy',msg.message.text]))},
  './command-aliases':aliases,
  './info':{handle:async ctx=>{calls.push(['info',ctx.text]);return true;}},
  '../promotion':{handleCommand:async()=>false},
  './privacy':{command:async()=>false},
  './extra':{handle:async()=>false}
 };
 const game=load('game/index.js',deps).createGame(client);
 async function emitGame(text){
  const msg={room:{id:'1849',isOpenChat:true},sender:{id:'5555',name:'Guest'},message:Object.freeze({text})};
  await game.message({
   client,roomId:'1849',text,msg,chat:{sendText:async(id,body)=>writes.push(body)},
   userId:'5555',userName:'Guest',isBotAccount:false,send:async body=>writes.push(body)
  });
  assert.equal(msg.message.text,text,'original KakaoForge event must not be modified');
 }
 return {game,emitGame,calls,writes,client,pool};
}
test('all game help commands use ! prefix and map to real command handlers',()=>{
 const body=help.formatCommandHelp({game:true,manage:false},'게임');
 assert.ok(body.startsWith('📜 명령어 안내 · NEXI\n작동 중인 기능 · 게임'+'\u200b'.repeat(1200)));
 const names=[...new Set([...body.matchAll(/^!(\S+)/gm)].map(v=>v[1]))];
 assert.equal(names.length,52);
 for(const name of names)assert.equal(aliases.isGameCommand('!'+name),true,name);
 assert.doesNotMatch(body,/^#\S+/m);
 assert.match(body,/!낚시\n└─[^\n]+\n\n!낚시정보/);
 assert.match(body,/!물고기판매 \(이름\) \(수량\)/);
 assert.match(body,/!씨앗구매 \(이름\) \(수량\)/);
 assert.doesNotMatch(body,/!게임순위/);
});
test('legacy # inputs are retired without affecting management !',()=>{
 for(const command of ['#낚시','#낚시정보','#게임작동','#퀴즈','#코인순위','#게임순위'])
  assert.equal(aliases.isRetiredLegacyCommand(command),true,command);
 for(const command of ['!관리명령어','!관리on','!경고 5555 1 사유','!게임명령어'])
  assert.equal(aliases.toLegacy(command),command);
 assert.equal(aliases.toLegacy('!물고기판매 송어 3'),'#물고기판매 송어 3');
});
test('readonly message and mentions survive text adaptation',()=>{
 const mention=Object.freeze({id:'5555',name:'Test'});
 const msg={message:Object.freeze({text:'!낚시'}),mentions:[mention]};
 Object.defineProperty(msg,'text',{get(){return '!낚시';}});
 const adapted=aliases.toLegacyMessage(msg,'!낚시','#낚시');
 assert.equal(adapted.text,'#낚시');
 assert.equal(adapted.message.text,'#낚시');
 assert.equal(adapted.mentions[0],mention);
 assert.equal(msg.text,'!낚시');
 assert.equal(msg.message.text,'!낚시');
});
test('! commands reach market, farm and legacy game handlers',async()=>{
 const f=createFixture();await f.game.init();
 for(const cmd of ['!게임가입','!코인순위','!낚시','!낚시정보','!농장','!퀴즈','!정보'])
  await f.emitGame(cmd);
 for(const [layer,text] of [
  ['market','#게임가입'],['market','#코인순위'],
  ['legacy','#낚시'],['legacy','#낚시정보'],
  ['farm','#농장'],['legacy','#퀴즈'],['info','#정보']
 ]){
  assert.equal(f.calls.some(x=>x[0]===layer&&x[1]===text),true,layer+' '+text);
 }
});
test('!게임작동 toggles actual game setting',async()=>{
 const f=createFixture();
 await f.game.toggle({roomId:'1849',text:'!게임작동',isBotAccount:true,send:async m=>f.writes.push(m)});
 assert.match(f.writes.at(-1),/게임 기능이 작동되었습니다/);
});
test('router routes ! game commands but refuses retired # commands',async()=>{
 const emitted=[],calls=[];let handler;
 const client={userId:'9999',onMessage(fn){handler=fn;},chat:{sendText:async(r,x)=>emitted.push(x)}};
 const game={toggle:async ctx=>calls.push(['toggle',ctx.text]),message:async ctx=>calls.push(['game',ctx.text])};
 const management={message:async ctx=>{calls.push(['management',ctx.text]);return false;}};
 const router=load('shared/router.js',{
  './help':{handleExtraMessage:async()=>false},
  '../game/command-aliases':aliases,
  './event-reaction-test':{receive(){}},
  '../manage/commands-v2':{handle:async()=>false},
  './event-notice':{handle:async()=>false},
  './event-settings':{handle:async()=>false}
 });
 router.attachRouter(client,{game,management,ready:Promise.resolve()});
 const emit=async text=>handler({room:{id:'1849',isOpenChat:true},sender:{id:'5555',name:'Guest'},message:{text}});
 await emit('#낚시');assert.equal(calls.length,0);
 await emit('!낚시');assert.equal(calls.some(x=>x[0]==='game'&&x[1]==='!낚시'),true);
 assert.equal(calls.some(x=>x[0]==='management'&&x[1]==='!낚시'),true);
 assert.ok(calls.findIndex(x=>x[0]==='management'&&x[1]==='!낚시')>
   calls.findIndex(x=>x[0]==='game'&&x[1]==='!낚시'));
 await emit('#게임작동');assert.equal(calls.some(x=>x[0]==='toggle'),false);
 await emit('!게임작동');assert.equal(calls.some(x=>x[0]==='toggle'&&x[1]==='!게임작동'),true);
});

test('NEXI brand and official support room appear in both command menus',()=>{
 for(const section of ['게임','관리']){
  const body=help.formatCommandHelp({game:true,manage:true},section);
  assert.ok(body.startsWith('📜 명령어 안내 · NEXI\n작동 중인 기능 · '+section+'\u200b'.repeat(1200)));
  assert.match(body,section==='게임'?/🎮 게임 명령어 · NEXI/:/🛡️ 관리 명령어 · NEXI/);
  assert.ok(body.includes('💬 NEXI 봇 문의방\nhttps://open.kakao.com/o/gK32HUUi'));
  assert.equal(body.split('https://open.kakao.com/o/gK32HUUi').length-1,1);
  assert.match(body,/✦ NEXI · 게임 & 관리 도우미$/);
 }
});

test('!문의방 responds once even when the game database is not ready',async()=>{
 const sent=[],calls=[];
 let handler;
 const client={
  userId:'9999',
  chat:{sendText:async(room,body)=>sent.push([String(room),body])},
  onMessage(fn){handler=fn;}
 };
 const router=load('shared/router.js',{
  './help':help,
  '../game/command-aliases':aliases,
  './unicode-output':{install(){}},
  './reply-delete':{install(){},observe(){}}
 });
 router.attachRouter(client,{
  game:{message:async()=>calls.push('game')},
  management:{message:async()=>calls.push('management')},
  ready:new Promise(()=>{})
 });
 await handler({
  room:{id:'1849',isOpenChat:true},
  sender:{id:'5555',name:'테스트'},
  message:{text:'!문의방'}
 });
 assert.deepEqual(sent,[['1849','💬 NEXI 봇 문의방\nhttps://open.kakao.com/o/gK32HUUi']]);
 assert.deepEqual(calls,[]);
});
