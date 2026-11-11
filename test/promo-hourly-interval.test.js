'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const promo=require('../promotion');

test('60 minute promotion is accepted and marked clock-aligned',()=>{
 const started=promo.patch({message:'테스트 홍보'},'start',{minutes:60});
 assert.equal(started.minutes,60);
 assert.equal(started.enabled,true);
 assert.equal(started.clockAligned,true);
 const changed=promo.patch({message:'테스트 홍보',enabled:true},'interval',{minutes:60});
 assert.equal(changed.minutes,60);
 assert.equal(changed.clockAligned,true);
});

test('60 minute schedule executes on the hour and not at 20 or 30 minutes',()=>{
 const hour=Date.UTC(2026,10,11,3,0,0);
 assert.equal(promo.nextBoundary(60,hour+25*60000),hour+3600000);
 assert.equal(promo.nextBoundary(60,hour),hour+3600000);
 assert.equal(promo.boundaryDue(60,hour+30000),true);
 assert.equal(promo.boundaryDue(60,hour+20*60000),false);
 assert.equal(promo.boundaryDue(60,hour+30*60000),false);
 assert.equal(promo.boundaryDue(60,hour+60*60000),true);
});

test('existing 20 and 30 minute schedules still work',()=>{
 const hour=Date.UTC(2026,10,11,3,0,0);
 for(const minutes of [20,30]){
  assert.equal(promo.patch({message:'테스트 홍보'},'start',{minutes}).minutes,minutes);
  assert.equal(promo.boundaryDue(minutes,hour+minutes*60000),true);
  assert.equal(promo.nextBoundary(minutes,hour+250000),hour+minutes*60000);
 }
});
