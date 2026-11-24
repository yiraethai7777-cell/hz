'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {periodAction}=require('../api/room-portal');
test('New subscription versus an existing subscription renewal',()=>{
 assert.equal(periodAction(true,null),'grant');
 assert.equal(periodAction(true,undefined),'grant');
 assert.equal(periodAction(true,{plan:'game',active:true}),'extend');
 assert.equal(periodAction(true,{plan:'all',active:false}),'extend');
 assert.equal(periodAction(false,{plan:'manage',active:true}),'none');
});
