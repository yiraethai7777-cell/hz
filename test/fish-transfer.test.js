'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const fish=require('../game/fish-transfer');
const alias=require('../game/command-aliases');

const specimen=(name,size)=>({name,tier:'전설',size,value:12345,at:7,salePending:true});
test('Aliases recognize fish transfer as a game command',()=>{
 assert.equal(alias.toLegacy('!물고기전송 @친구 황금용어 2'),'#물고기전송 @친구 황금용어 2');
 assert.equal(alias.toLegacy('!물고기전송 @친구 all'),'#물고기전송 @친구 all');
});
test('Parser supports species, quantities, multiword names and all',()=>{
 assert.equal(fish.parse('#물고기전송 @친구 황금용어 2').name,'황금용어');
 assert.equal(fish.parse('#물고기전송 @친구 별바다의 왕어 3').count,3);
 assert.equal(fish.parse('#물고기전송 @친구 all').all,true);
 assert.equal(fish.parse('#물고기전송 @친구 해룡 all').name,'해룡');
 for(const input of ['#물고기전송 @친구 황금용어 0','#물고기전송 @친구 황금용어 -1',
  '#물고기전송 @친구 황금용어 9999999999999999999','#물고기전송 @친구 없는물고기 1',
  '#물고기전송 황금용어 2'])assert.throws(()=>fish.parse(input));
});
test('Move fish keeps unique items and original metadata without transferring coins',()=>{
 const f1=specimen('황금용어',50),f2=specimen('황금용어',60),f3=specimen('해룡',70);
 const players={'1001':{id:'1001',name:'송신자',points:99,inventory:[f1,f2,f3]}};
 const d={players};
 const result=fish.move(d,'1001','2002','수신자',{name:'황금용어',count:2,all:false});
 assert.equal(result.count,2);
 assert.deepEqual(players['1001'].inventory,[f3]);
 assert.deepEqual(players['2002'].inventory,[f1,f2]);
 assert.equal(players['1001'].points,99);
 assert.equal(players['2002'].points,0);
 assert.deepEqual(players['2002'].inventory[1],f2);
 const rest=fish.move(d,'1001','2002','수신자',{all:true});
 assert.equal(rest.count,1);
 assert.equal(players['1001'].inventory.length,0);
 assert.equal(players['2002'].inventory.length,3);
 assert.throws(()=>fish.move(d,'1001','2002','수신자',{all:true}),/전송할 물고기/);
});
test('Insufficient amount never creates recipient or changes fish inventory',()=>{
 const f1=specimen('해룡',999),d={players:{'1001':{inventory:[f1]}}};
 assert.throws(()=>fish.move(d,'1001','2002','수신자',{name:'해룡',count:2,all:false}),/보유 수량/);
 assert.equal(d.players['2002'],undefined);
 assert.equal(d.players['1001'].inventory[0],f1);
});
test('Command handler uses real mention ID, validates sender and never trusts visible @name',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../game/fish-transfer.js'),'utf8');
 const mod={exports:{}},calls=[],sent=[];
 const stub={transferFish:async args=>{calls.push(args);return '전송 성공';}};
 vm.runInNewContext(source,{module:mod,exports:mod.exports,Error,String,Number,RegExp,Set,Map,
  require(name){
   if(name==='./data')return {FISH_TABLE:require('../game/data').FISH_TABLE};
   if(name==='./coin')return {mentionTarget:msg=>{
     if(!msg.mentions||msg.mentions.length!==1)throw Error('실제 멘션이 필요합니다.');
     return msg.mentions[0];
    },messageKey:msg=>msg.id};
   if(name==='../shared/runtime')return stub;
   throw Error(name);
  }
 },{filename:'game/fish-transfer.js'});
 const handle=mod.exports.handle;
 const base={text:'#물고기전송 @수신자 해룡 1',roomId:'33',userId:'1001',send:async s=>sent.push(s)};
 await handle({...base,msg:{id:'5000',room:{name:'test'},mentions:[{id:'2002',name:'수신자'}]}});
 assert.equal(calls.length,1);
 assert.equal(calls[0].toId,'2002');
 assert.equal(calls[0].request.name,'해룡');
 await handle({...base,msg:{id:'5001',mentions:[]}});
 assert.equal(calls.length,1);
 await handle({...base,msg:{id:'5002',mentions:[{id:'1001',name:'본인'}]}});
 assert.equal(calls.length,1);
 assert.match(sent.at(-1),/자기 자신/);
});
test('Runtime uses a room lock and deduplicates transfer messages inside transaction',()=>{
 const runtime=fs.readFileSync(path.join(__dirname,'../shared/runtime.js'),'utf8');
 assert.match(runtime,/runtime\.withRoom\(roomId,roomName,async\(d,c\)=>/);
 assert.match(runtime,/INSERT INTO gl_game_requests\(room_id,message_id\)/);
 assert.match(runtime,/if\(!claim\.rowCount\)throw Error/);
});
