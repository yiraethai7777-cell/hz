'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ownRole,roleLabel}=require('../shared/vox30-role-state');

const packet=groups=>({method:12011,memberGroups:groups});
test('VOX server roster distinguishes listener/speaker/moderator only for own user',()=>{
  for(const [group,role,label] of [
    ['listeners','listener','리스너'],
    ['speakers','speaker','스피커'],
    ['moderators','moderator','진행자'],
  ]){
    const result=ownRole(packet({[group]:{own:'present',ownStates:{mic:group!=='listeners'}}}));
    assert.deepEqual(result,{role,source:'vox-12011-own-roster',mic:group!=='listeners'});
    assert.equal(roleLabel(result.role),label);
  }
});
test('unknown, missing or competing group evidence is not a role change',()=>{
  assert.equal(ownRole(packet({listeners:{own:'not_observed'}})),null);
  assert.equal(ownRole(packet({listeners:{own:'present'},speakers:{own:'present'}})),null);
  assert.equal(ownRole({method:12023,memberGroups:{speakers:{own:'present'}}}),null);
  assert.equal(ownRole(packet(null)),null);
  assert.equal(roleLabel('unknown'),'미확인');
});
test('VOX 12011 member roster gives no fabricated mic/voice consent',()=>{
  const result=ownRole(packet({speakers:{own:'present',ownStates:{}}}));
  assert.equal(result.mic,null);
  assert.equal(result.role,'speaker');
  assert.equal('invitationAccepted' in result,false);
});
