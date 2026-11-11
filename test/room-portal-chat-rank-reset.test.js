'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {parseChatRankReset}=require('../api/room-portal');

const confirmation='DELETE_CONFIRMED_TWICE';

test('all chat rank reset requires no user ID and scopes deletion to whole room',()=>{
 assert.deepEqual(parseChatRankReset({action:'all',confirmation}),{action:'all',user:null});
 assert.deepEqual(parseChatRankReset({action:'all',userId:'',confirmation}),{action:'all',user:null});
});

test('single user chat rank reset retains ID validation',()=>{
 assert.deepEqual(parseChatRankReset({action:'user',userId:'1234567890',confirmation}),{action:'user',user:'1234567890'});
 assert.throws(()=>parseChatRankReset({action:'user',confirmation}),/ID/);
 assert.throws(()=>parseChatRankReset({action:'user',userId:'abc',confirmation}),/ID/);
 assert.throws(()=>parseChatRankReset({action:'user',userId:'12',confirmation}),/ID/);
});

test('both reset actions require explicit double confirmation',()=>{
 for(const action of ['all','user']){
  assert.throws(()=>parseChatRankReset({action,userId:'1234567890'}),/2단계/);
 }
});
