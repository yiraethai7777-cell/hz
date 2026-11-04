'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const reminder=require('../manage/mention-repeat');
const tagged={mentions:[{userId:'23456',name:'테스트'}]};
test('admin mention request parses genuine single Kakao mention with count',()=>{
 const good=reminder.parse({text:'!멘션 @테스트 3',msg:tagged,issuerId:'12345',botId:'99999'});
 assert.equal(good.count,3);assert.equal(good.target.id,'23456');
 assert.ok(reminder.parse({text:'!멘션 @테스트 6',msg:tagged,issuerId:'12345',botId:'99999'}).error);
 assert.ok(reminder.parse({text:'!멘션 @테스트 1',msg:{},issuerId:'12345',botId:'99999'}).error);
 assert.ok(reminder.parse({text:'!멘션 @테스트 1',msg:tagged,issuerId:'23456',botId:'99999'}).error);
});
test('sends separate tagged messages and enforces per-room cooldown',async()=>{
 const sent=[];
 const args={text:'!멘션 @테스트 3',msg:tagged,roomId:'88888',userId:'12345',botId:'99999',
  chat:{mention:(id,name)=>'\u0002'+id+'\u0003'+name+'\u0004'},
  send:async value=>sent.push(value),waitFn:async()=>{},now:()=>1000000};
 await reminder.handle(args);
 assert.equal(sent.length,3);
 assert.equal(sent[0],'\u000223456\u0003테스트\u0004');
 assert.equal(sent[1],sent[0]);
 assert.equal(sent[2],sent[0]);
 await reminder.handle(args);
 assert.equal(sent.length,4);
 assert.match(sent[3],/기다려/);
});
