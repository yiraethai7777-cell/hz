'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {send}=require('../game/mining-progress');
test('all rooms send mined results immediately as one message without edits or waits',async()=>{
 const sent=[],result='⛏ 카카오톡 게임 매니저 | 채굴 성공\n💎 다이아몬드 × 2';
 for(const isArdenClan of [true,false]){
  const out=[];
  const state=await send({roomId:'1000',isArdenClan,
   send:async text=>out.push(text),
   chat:{editMessage:()=>assert.fail('mining edit must not occur')}},result,()=>assert.fail('mining wait must not occur'));
  assert.equal(state,'normal');assert.deepEqual(out,[result]);sent.push(...out);
 }
 assert.equal(sent.length,2);
});
