'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const val=require('../valorant-manager');
test('Manager keeps School functionality but not deleted or existing manager commands',()=>{
 for(const cmd of ['!발로전적','!발로저장','!발로전적확인','!스킨','!요원','!맵','!조준점','!파티등록','!듀오모집','!내전예약','!후보참여','!내전홍보','!발로명령어'])
  assert(val.COMMANDS.has(cmd),cmd);
 for(const cmd of ['!명령어','!정보','!경고','!출석','!스킨비교','!발로랭킹'])
  assert(!val.COMMANDS.has(cmd),cmd);
 assert(val.shouldHandle('!발로전적 example#KR1',null));
 assert(!val.shouldHandle('!경고 @사람 1',null));
});
test('Manager rebrands School output without changing account-list reply marker',()=>{
 assert(val.formatAnswer('🎯 VALORANT SCHOOL | 전적 조회\n승률: 70%', '!발로전적').includes('카카오톡 매니저 | VALORANT'));
 assert(!val.formatAnswer('🎨 NEXI | 스킨','!스킨').includes('NEXI'));
 assert(val.formatAnswer('🎯 저장한 발로란트 계정 (2/20)\n1. A#KR1','!발로전적확인').startsWith('🎯 저장한 발로란트 계정'));
 assert.equal(val.formatAnswer('제트','!랜덤요원'),'제트');
});
test('Independent Valorant switch works for management-only packages and preserves prior game rooms',()=>{
 assert.equal(val.enabledFromRoom({valorant_enabled:'true',game:'false'}),true);
 assert.equal(val.enabledFromRoom({valorant_enabled:'false',game:'true'}),false);
 assert.equal(val.enabledFromRoom({valorant_enabled:null,game:'true'}),true);
 assert.equal(val.enabledFromRoom({valorant_enabled:null,game:'false'}),false);
 assert.equal(val.enabledFromRoom({}),false);
});
test('Room administrator permission catalogue includes an independent Valorant toggle',()=>{
 const api=require('../api/room-portal');
 assert(api.PERMISSIONS.includes('valorant'));
});
test('Bot reply number is dispatched only for reply messages',()=>{
 assert(!val.shouldHandle('1',{}));
 assert(val.shouldHandle('1',{message:{type:26}}));
});
