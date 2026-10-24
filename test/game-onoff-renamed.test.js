'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const aliases=require('../game/command-aliases');
const {formatCommandHelp}=require('../shared/help');

test('game toggle aliases recognize !게임on/off and retire old spellings',()=>{
 assert.equal(aliases.isGameCommand('!게임on'),true);
 assert.equal(aliases.isGameCommand('!게임off'),true);
 assert.equal(aliases.isGameCommand('!게임작동'),false);
 assert.equal(aliases.isGameCommand('!게임중지'),false);
 assert.equal(aliases.isRetiredLegacyCommand('#게임작동'),true);
 assert.equal(aliases.isRetiredLegacyCommand('#게임중지'),true);
 assert.equal(aliases.isRetiredLegacyCommand('#게임on'),true);
 assert.equal(aliases.isRetiredLegacyCommand('#게임off'),true);
});

test('game toggle updates only the game flag and only for bot account',async()=>{
 const changes=[],responses=[];
 const gameFile=fs.readFileSync(path.join(__dirname,'../game/index.js'),'utf8');
 const m={exports:{}};
 const mock=(name)=>{
  if(name==='../shared/db')return {
   getPool:()=>({query:async(sql,args)=>{changes.push({sql,args});return {rows:[]};}}),
   testConnection:async()=>{}
  };
  if(name==='./command-aliases')return aliases;
  if(['./wallet','./members','./coin','./commands'].includes(name))return {};
  throw Error('Unexpected import: '+name);
 };
 vm.runInNewContext(gameFile,{module:m,exports:m.exports,require:mock,console});
 const game=m.exports.createGame({});
 for(const [text,isBotAccount] of [
  ['!게임on',true],['!게임off',true],['!게임on',false]
 ]){
  await game.toggle({roomId:'1234',text,isBotAccount,send:async s=>responses.push(s)});
 }
 assert.equal(changes.length,2);
 assert.deepEqual([...changes[0].args],['1234',true]);
 assert.deepEqual([...changes[1].args],['1234',false]);
 assert.match(changes[0].sql,/jsonb_set\(hz_rooms.data/);
 assert.match(responses[0],/작동/);
 assert.match(responses[1],/중지/);
 assert.match(responses[2],/봇 계정만/);
});

test('router routes new game toggles directly, without legacy game handling',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../shared/router.js'),'utf8');
 const outputs=[],toggles=[],legacy=[];
 let handler;
 const client={
  userId:'5678',
  onMessage(fn){handler=fn;},
  chat:{sendText:async(_room,text)=>outputs.push(text)}
 };
 const game={
  toggle:async context=>toggles.push(context.text),
  message:async context=>legacy.push(context.text)
 };
 const management={message:async()=>false};
 const mock=name=>{
  if(name==='./help')return {handleExtraMessage:async()=>false};
  if(name==='../game/command-aliases')return aliases;
  if(name==='./event-reaction-test')return {receive:()=>{}};
  if(name==='../manage/commands-v2')return {handle:async()=>false};
  if(name==='./event-settings')return {handle:async()=>false};
  throw Error('Unexpected import: '+name);
 };
 const m={exports:{}};
 vm.runInNewContext(source,{module:m,exports:m.exports,require:mock,console,Promise,Date,String});
 m.exports.attachRouter(client,{game,management,ready:Promise.resolve()});
 const message=text=>({room:{id:'4321'},sender:{id:'5678',name:'봇'},message:{text}});
 await handler(message('!게임on'));
 await handler(message('!게임off'));
 await handler(message('!게임작동'));
 assert.deepEqual(toggles,['!게임on','!게임off']);
 assert.deepEqual(legacy,[]);
 assert.match(outputs[0],/!게임on \/ !게임off/);
});

test('game command help and disabled state show new controls',()=>{
 const content=formatCommandHelp({game:true},'게임');
 assert.match(content,/!게임on/);
 assert.match(content,/!게임off/);
 assert.doesNotMatch(content,/!게임작동|!게임중지/);
 assert.match(formatCommandHelp({game:false},'게임'),/!게임on/);
});
