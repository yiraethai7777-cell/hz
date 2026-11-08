'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PLANT_MS,HARVEST_MS,sendFarmCompletion}=require('../game/farm-timing');
const {createFarm}=require('../game/farm');

test('planting and harvest stages both take five seconds',()=>{
 assert.equal(PLANT_MS,5000);
 assert.equal(HARVEST_MS,5000);
});

test('five-second planting completion sends a new message without editing',async()=>{
 const events=[],scheduled=[];
 const farm=createFarm({pool:{},autoRecover:false,
  schedule:(fn,delay)=>{scheduled.push({fn,delay});return {unref(){}};}});
 const ctx={roomId:'100',chat:{
  editMessage:async()=>assert.fail('Farm must not edit messages')
 },send:async text=>events.push({kind:'send',text})};
 farm.scheduleCompletion({ctx,
  receipt:{status:0,body:{logId:'7654321'}},
  job:{type:'plant',completedText:'✅ 파인애플 9칸 전부 심었습니다!'}});
 assert.equal(scheduled.length,1);
 assert.equal(scheduled[0].delay,5000);
 assert.deepEqual(events,[]);
 await scheduled[0].fn();
 assert.deepEqual(events,[{
  kind:'send',
  text:'✅ 파인애플 9칸 전부 심었습니다!'
 }]);
});

test('completion sends a new message regardless of edit capability',async()=>{
 const messages=[];
 const result=await sendFarmCompletion({
  ctx:{roomId:'100',chat:{editMessage:async()=>({status:-1})},
   send:async text=>messages.push(text)},
  receipt:{status:0,body:{logId:'456'}},text:'✅ 작물 전부 수확 완료!'
 });
 assert.equal(result,'sent');
 assert.deepEqual(messages,['✅ 작물 전부 수확 완료!']);
});

test('completion never needs or edits a message logId',async()=>{
 let edited=false;const sent=[];
 const result=await sendFarmCompletion({
  ctx:{roomId:'100',chat:{editMessage:async()=>{edited=true;return {status:0};}},
   send:async text=>sent.push(text)},
  receipt:{status:0},text:'✅ 심기 완료'
 });
 assert.equal(result,'sent');
 assert.equal(edited,false);
 assert.deepEqual(sent,['✅ 심기 완료']);
});
