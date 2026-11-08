'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('removed Pokemon commands are unregistered and produce no disabled notice or writes',async()=>{
 const aliases=require('../game/command-aliases'),sent=[],module={exports:{}};
 const falseHandler={handle:async()=>false};
 const deps={
  '../shared/db':{getPool:()=>({query:async sql=>{assert.match(sql,/^SELECT /);return {rows:[{data:{game:true}}]};}})},
  './wallet':{},'./members':{},'./coin':{},'./commands':{},'./command-aliases':aliases,
  '../promotion':{handleCommand:async()=>false},'./privacy':{command:async()=>false},
  './typing':falseHandler,'./farm':falseHandler,'./extra':falseHandler,'./game2-admin':falseHandler,'./fishing-battle':falseHandler
 };
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../game/index.js'),'utf8'),{module,exports:module.exports,console,require:name=>{assert.ok(!name.includes('pokemon'));if(name in deps)return deps[name];throw Error('Unexpected module: '+name);}});
 const game=module.exports.createGame({});
 for(const name of ['탐색','포획','포켓봇정보','포켓몬정보','포켓몬구매','포켓몬사용','배틀','기술','배틀상태','도망']){
  const text='!'+name;assert.equal(aliases.isGameCommand(text),false);assert.equal(aliases.toLegacy(text),text);
  await game.message({text,roomId:'1000',userId:'2000',msg:{text,sender:{id:'2000'}},send:async body=>sent.push(body)});
 }
 assert.deepEqual(sent,[]);
 for(const name of ['채굴','광물판매','곡괭이구매','낚시','농장','퀴즈','인벤','상점'])assert.equal(aliases.isGameCommand('!'+name),true);
});
