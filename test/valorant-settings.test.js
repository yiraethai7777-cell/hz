'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const settings=require('../shared/valorant-settings');

function fakeDb(initial={}){
 const rooms=new Map(Object.entries(initial).map(([room,data])=>[room,{...data}]));
 const calls=[];
 return {
  rooms,calls,
  async query(sql,params){
   calls.push({sql,params});
   const [room,value]=params;
   if(/^SELECT COALESCE/.test(sql)){
    return {rows:[{enabled:rooms.get(room)?.valorant===true}]};
   }
   if(/^INSERT INTO hz_rooms/.test(sql)){
    rooms.set(room,{...(rooms.get(room)||{}),valorant:value});
    return {rows:[],rowCount:1};
   }
   throw Error('Unexpected SQL: '+sql);
  }
 };
}
test('All rooms start with the Valorant feature turned off',async()=>{
 const db=fakeDb();
 assert.equal(await settings.isEnabled('room-A',db),false);
 assert.equal(await settings.isEnabled('room-B',db),false);
 assert.equal(db.rooms.size,0,'read-only checks must not create rooms');
 assert.equal(settings.FLAG,'valorant');
});
test('Only the connected Kakao bot account may toggle the Valorant feature',async()=>{
 const db=fakeDb(),messages=[];
 const send=async msg=>messages.push(msg);
 assert.equal(await settings.handle({text:'!발로on',roomId:'room-A',isBotAccount:false,send,db}),true);
 assert.equal(await settings.isEnabled('room-A',db),false);
 assert.equal(db.rooms.size,0);
 assert.match(messages[0],/봇 계정만/);
 assert.equal(await settings.handle({text:'!발로off',roomId:'room-A',isBotAccount:false,send,db}),true);
 assert.equal(db.rooms.size,0);
 assert.equal(await settings.handle({text:'!게임on',roomId:'room-A',isBotAccount:true,send,db}),false);
 assert.equal(db.rooms.size,0);
});
test('!발로on enables only the current room, retaining other room settings',async()=>{
 const db=fakeDb({
  'room-A':{game:false,manage:true,fishEnabled:true},
  'room-B':{game:true,manage:false}
 });
 const messages=[];
 await settings.handle({text:'!발로on',roomId:'room-A',isBotAccount:true,db,send:async x=>messages.push(x)});
 assert.equal(await settings.isEnabled('room-A',db),true);
 assert.equal(await settings.isEnabled('room-B',db),false);
 assert.deepEqual(db.rooms.get('room-A'),{game:false,manage:true,fishEnabled:true,valorant:true});
 assert.deepEqual(db.rooms.get('room-B'),{game:true,manage:false});
 assert.match(messages[0],/발로란트 기능이 켜졌습니다/);
 const update=db.calls.find(c=>c.sql.startsWith('INSERT INTO hz_rooms'));
 assert.deepEqual(update.params,['room-A',true]);
 assert.match(update.sql,/jsonb_set\(/);
 assert.match(update.sql,/\{valorant\}/);
 assert.doesNotMatch(update.sql,/\{game\}|\{manage\}/);
});
test('!발로off persists, even when code reloads, while other rooms remain enabled',async()=>{
 const db=fakeDb();
 const send=async()=>{};
 await settings.handle({text:'!발로on',roomId:'room-A',isBotAccount:true,db,send});
 await settings.handle({text:'!발로on',roomId:'room-B',isBotAccount:true,db,send});
 await settings.handle({text:'!발로off',roomId:'room-A',isBotAccount:true,db,send});
 assert.equal(await settings.isEnabled('room-A',db),false);
 assert.equal(await settings.isEnabled('room-B',db),true);
 const script=fs.readFileSync(path.join(__dirname,'../shared/valorant-settings.js'),'utf8');
 const mod={exports:{}};
 vm.runInNewContext(script,{
  module:mod,exports:mod.exports,
  require(name){if(name==='./db')return {getPool:()=>db};throw Error('Unexpected require '+name);}
 });
 assert.equal(await mod.exports.isEnabled('room-A'),false);
 assert.equal(await mod.exports.isEnabled('room-B'),true);
});
test('Database errors never turn on access by default',async()=>{
 const db={query:async()=>{throw Error('Database unavailable')}};
 await assert.rejects(settings.isEnabled('room-A',db),/Database unavailable/);
});
test('Router gates every Valorant command, independently of normal game flags',async()=>{
 const code=fs.readFileSync(path.join(__dirname,'../shared/router.js'),'utf8');
 const db=fakeDb();
 const messages=[],handled=[],lookups=[];
 let onMessage;
 const client={
  userId:'9999',onMessage(fn){onMessage=fn;},
  chat:{sendText:async(room,body)=>messages.push([String(room),body])}
 };
 const router={exports:{}};
 vm.runInNewContext(code,{
  module:router,exports:router.exports,console,Promise,Date,
  require(name){
   if(name==='./help')return {handleExtraMessage:async()=>false};
   if(name==='../game/command-aliases')return {isGameCommand:()=>false,isRetiredLegacyCommand:()=>false};
   if(name==='./unicode-output'||name==='./reply-delete')return {install(){}};
   if(name==='./valorant-settings')return {
    handle:args=>settings.handle({...args,db}),
    isEnabled:async id=>{lookups.push(id);return settings.isEnabled(id,db);}
   };
   if(name==='./valorant-skin')return {handle:async args=>{
    handled.push(['skin',String(args.roomId)]);await args.send('스킨 정보');return true;
   }};
   if(name==='./valorant-stats')return {handle:async args=>{
    handled.push(['stats',String(args.roomId)]);await args.send('전적 정보');return true;
   }};
   throw Error('Unexpected require '+name);
  }
 },{filename:'shared/router.js'});
 const game={message:async()=>{throw Error('Valorant may not require !게임on')}};
 router.exports.attachRouter(client,{game,management:{message:async()=>false},ready:new Promise(()=>{})});
 const emit=async(room,text,author='1234')=>onMessage({
  room:{id:room,isOpenChat:true},sender:{id:author},message:{text}
 });
 const related=[
  '!스킨 싱귤 밴달','!발로전적 Demo#KR1','!전적 Demo#KR1',
  '!티어 Demo#KR1','!최근전적 Demo#KR1','!승률 Demo#KR1',
  '!헤드샷 Demo#KR1'
 ];
 for(const command of related)await emit('room-A',command);
 assert.equal(handled.length,0,'off-by-default must suppress all Valorant lookups');
 assert.equal(messages.length,0,'disabled commands must not generate replies');
 assert.equal(lookups.length,related.length);
 await emit('room-A','!발로on');
 assert.equal(await settings.isEnabled('room-A',db),false,'ordinary user cannot enable');
 assert.match(messages.at(-1)[1],/봇 계정만/);
 await emit('room-A','!발로on','9999');
 assert.equal(await settings.isEnabled('room-A',db),true);
 assert.match(messages.at(-1)[1],/기능이 켜졌습니다/);
 await emit('room-A','!스킨 싱귤 밴달');
 await emit('room-A','!발로전적 Demo#KR1');
 assert.deepEqual(handled,[['skin','room-A'],['stats','room-A']]);
 await emit('room-B','!스킨 싱귤 밴달');
 assert.equal(handled.length,2,'room B remains disabled');
 await emit('room-A','!발로off','9999');
 await emit('room-A','!스킨 싱귤 밴달');
 await emit('room-A','!발로전적 Demo#KR1');
 assert.equal(handled.length,2,'turning off must suppress both skin and stats');
});
test('Router fails closed when PostgreSQL check fails',async()=>{
 const script=fs.readFileSync(path.join(__dirname,'../shared/router.js'),'utf8');
 const module={exports:{}};
 let receive;let called=0;let written=0;
 vm.runInNewContext(script,{
  module,exports:module.exports,Promise,Date,
  console:{error(){},log(){},warn(){}},
  require(name){
   if(name==='./help')return {handleExtraMessage:async()=>false};
   if(name==='../game/command-aliases')return {isGameCommand:()=>false,isRetiredLegacyCommand:()=>false};
   if(name==='./unicode-output'||name==='./reply-delete')return {install(){}};
   if(name==='./valorant-settings')return {isEnabled:async()=>{throw Error('offline')}};
   if(name==='./valorant-skin'||name==='./valorant-stats')return {handle:async()=>called++};
   throw Error('Unexpected require '+name);
  }
 });
 const client={userId:'777',onMessage(fn){receive=fn;},
  chat:{sendText:async()=>written++}};
 module.exports.attachRouter(client,{ready:new Promise(()=>{}),game:{},management:{}});
 await receive({room:{id:'abc'},sender:{id:'other'},message:{text:'!스킨 싱귤 밴달'}});
 assert.equal(called,0);
 assert.equal(written,0);
});
