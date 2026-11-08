'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {send}=require('../game/mining-progress');
test('ARDEN sends only the saved result with no progress wait or edit',async()=>{
 const sent=[],result='⛏ NEXI | 채굴 성공\n💎 다이아몬드 × 2';
 const state=await send({roomId:'1000',isArdenClan:true,send:async text=>sent.push(text),chat:{editMessage:()=>assert.fail('ARDEN must not edit')}},result,()=>assert.fail('ARDEN must not wait'));
 assert.equal(state,'normal');assert.deepEqual(sent,[result]);
});
test('simultaneous other-room mining retains all five seconds of progress edits',async()=>{
 const plain=[],normal=[],waits=[],result='saved result';
 await Promise.all([
  send({roomId:'1000',isArdenClan:true,send:async text=>plain.push(text),chat:{editMessage:()=>assert.fail('No ARDEN edits')}},result,()=>assert.fail('No ARDEN wait')),
  send({roomId:'2000',isArdenClan:false,send:async text=>{normal.push(text);return {status:0,body:{logId:'12345'}};},chat:{editMessage:async(room,log,text)=>{assert.equal(room,'2000');normal.push(text);return {status:0};}}},result,async ms=>waits.push(ms))
 ]);
 assert.deepEqual(plain,[result]);assert.equal(normal.length,6);assert.equal(normal[0],'⛏ NEXI | 광질중.');assert.equal(normal.at(-1),result);assert.deepEqual(waits,[1000,1000,1000,1000,1000]);
});
