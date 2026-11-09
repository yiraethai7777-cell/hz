'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {idString,decodeMembership}=require('../shared/voice-room-vox-membership');
const ME='9007199254740993123';
function reply(role='listener'){
 return {resCode:0,
  moderatorUserIdList:role==='moderator'?[ME]:['11111111111'],
  speakerUserIdList:role==='speaker'?[ME]:['22222222222'],
  listenerUserIdList:role==='listener'?[ME]:['33333333333']};
}
test('full Int64 participant IDs remain exact with no JS Number truncation',()=>{
 assert.equal(idString(ME),ME);
 assert.equal(idString('9223372036854775807'),'9223372036854775807');
 assert.equal(idString('9223372036854775808'),'');
 assert.equal(idString(9007199254740993),'');
 assert.equal(idString('000123'),'');
 assert.equal(idString('0'),'');
});
test('moderator, speaker and listener states are distinct',()=>{
 for(const role of ['moderator','speaker','listener']){
  const state=decodeMembership(reply(role),ME);
  assert.equal(state.role,role);
  assert.equal(state.parsed,true);
  assert.equal(state.moderatorCount,1);
 }
});
test('not on list is absent, never moderator',()=>{
 const state=decodeMembership(reply(),'44444444444');
 assert.deepEqual(state,{parsed:true,role:'absent',moderatorCount:1});
});
test('non-success or missing member arrays cannot assert participant or moderator',()=>{
 for(const bad of [
  {...reply('moderator'),resCode:1},
  {...reply('moderator'),listenerUserIdList:null},
  {...reply('moderator'),moderatorUserIdList:'string'},
  null,
 ])assert.deepEqual(decodeMembership(bad,ME),
  {parsed:false,role:'unknown',moderatorCount:null});
});
test('conflicting roles cannot grant moderator permission',()=>{
 const overlap=reply('moderator');
 overlap.listenerUserIdList.push(ME);
 assert.equal(decodeMembership(overlap,ME).role,'unknown');
 assert.equal(decodeMembership(overlap,ME).parsed,false);
});
test('invalid identity or forged array values never grant authority',()=>{
 const obj=reply('moderator');
 obj.moderatorUserIdList=['9223372036854775808'];
 assert.equal(decodeMembership(obj,ME).role,'unknown');
 assert.equal(decodeMembership(reply('moderator'),'not-a-user').role,'unknown');
 assert.equal(decodeMembership(reply('moderator'),9007199254740993).role,'unknown');
});
