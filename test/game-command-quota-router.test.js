'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const limiter=require('../shared/game-rate-limit');

test('live router enforces per-user quota before calling game while keeping bot exempt',async()=>{
 const code=fs.readFileSync(path.join(__dirname,'../shared/router.js'),'utf8');
 let listener,dbQueries=0;
 const sent=[],games=[],errors=[];
 const db={query:async()=>{
  dbQueries++;return {rows:[{enabled:'true',arden_clan:'false'}]};
 }};
 const dependencies={
  './help':{handleExtraMessage:async()=>false},
  '../game/command-aliases':require('../game/command-aliases'),
  './game-rate-limit':limiter,
  './voice-room-permission':{isBotVoiceCommand:()=>false},
  './unicode-output':{install(){}},
  './reply-delete':{install(){},observe(){}},
  './room-subscriptions':{access:async()=>({allowed:true,subscription:null})},
  './db':{getPool:()=>db},
  './command-prefixes':{get:async()=> '!',normalize:text=>({blocked:false,used:false,text})},
  './command-blocks':{blocked:async()=>false,commandLike:()=>true},
  './super-admin':{isSuperAdmin:async()=>false},
  './arden-style':{scope:async(_props,callback)=>callback()},
  './arden-clan':{handle:async()=>false},
  './junggae-notify':{handle:async()=>false},
  './event-reaction-test':{receive(){},shouldBlind:()=>false},
  '../manage/commands-v2':{handle:async()=>false}
 };
 const module={exports:{}};
 vm.runInNewContext(code,{
  module,exports:module.exports,
  require:name=>{
   if(Object.prototype.hasOwnProperty.call(dependencies,name))return dependencies[name];
   throw Error('Unexpected router dependency: '+name);
  },
  console:{log(){},warn(){},error:(...values)=>errors.push(values.map(String).join(' '))},
  process:{env:{}},Date,Promise,global:{__nexiPauseUntil:0}
 },{filename:'shared/router.js'});
 const client={
  userId:'9999',connected:true,
  chat:{sendText:async(room,text)=>sent.push(String(text))},
  onMessage:fn=>{listener=fn;}
 };
 const game={
  message:async ctx=>{games.push({text:ctx.text,userId:String(ctx.userId)});},
  toggle:async()=>{}
 };
 module.exports.attachRouter(client,{game,management:{message:async()=>false},ready:Promise.resolve()});
 const emit=async(user,command,mid)=>listener({
  room:{id:'184900111',isOpenChat:true},
  sender:{id:user,name:'Tester',type:2},
  message:{logId:mid,text:command}
 });
 for(let i=1;i<=5;i++)await emit('5555','!낚시','log-'+i);
 assert.equal(games.length,5);
 await emit('5555','!채굴','log-6');
 assert.equal(games.length,5,'the sixth game command must not reach game processing');
 assert.equal(sent.filter(x=>x.includes('5분 동안')).length,1);
 await emit('5555','!낚시','log-7');
 assert.equal(games.length,5,'blocked repeat remains silent');
 assert.equal(sent.filter(x=>x.includes('5분 동안')).length,1);
 await emit('5555','!핑','log-8');
 assert.match(sent.at(-1),/퐁/,'public ping remains usable');
 await emit('6666','!낚시','log-9');
 await emit('9999','!낚시','log-10');
 assert.equal(errors.length,0,errors.join('\\n'));
 assert.deepEqual(games.slice(-2).map(x=>x.userId),['6666','9999']);
 assert.ok(dbQueries>=5,'the fixture exercises real router authorization flow');
});
