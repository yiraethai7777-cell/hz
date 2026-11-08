'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function game(source,aliases,flags,calls){
 const module={exports:{}};
 const deps={
  '../shared/db':{getPool:()=>({query:async sql=>{assert.match(sql,/^SELECT/);return {rows:[{data:flags}]};}})},
  './wallet':{},'./members':{},'./coin':{},'./commands':{},'./command-aliases':aliases,
  '../promotion':{handleCommand:async()=>false},'./privacy':{command:async()=>false},
  './mining':{handle:async ctx=>{assert.equal(ctx.isArdenClan,String(flags.ardenClan)==='true');calls.push(ctx.text);return true;}},
  './shop':{handle:async ctx=>{calls.push(ctx.text);return true;}}
 };
 vm.runInNewContext(source,{module,exports:module.exports,require:n=>{if(n in deps)return deps[n];throw Error('Unexpected dependency '+n);},console},{filename:'game/index.js'});
 return module.exports.createGame({});
}
test('actual mining routes normalize once and obey game-off and room lock',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../game/index.js'),'utf8'),aliases=require('../game/command-aliases');
 for(const flags of [{game:true},{game:true,ardenClan:true},{game:true,ardenClan:'true'},{game:false},{game:true,locked:true}]){
  const calls=[],sent=[],service=game(source,aliases,flags,calls);
  for(const name of ['광산','채굴','광물인벤','광물판매 전체','곡괭이','곡괭이구매 돌','곡괭이장착 나무','채굴지','상점','상점 씨앗']){
   assert.equal(aliases.isGameCommand('!'+name),true);
   const ctx={roomId:'1000',userId:'2000',text:'!'+name,isBotAccount:false,isArdenClan:true,msg:{text:'!'+name,sender:{id:'2000'}},send:async t=>sent.push(t)};
   await (service.dispatch?service.dispatch(ctx):service.message(ctx));
  }
  assert.equal(calls.length,flags.game&&!flags.locked?10:0);
  if(!flags.game)assert.equal(sent.length,10);
 }
});
