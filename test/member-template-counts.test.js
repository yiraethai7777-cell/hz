'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {renderMemberTemplate}=require('../manage/leave-reply');
test('custom join text replaces Korean placeholders and retains real mention',()=>{
 const result=renderMemberTemplate('👤 (이름)님\\n(멘션)님\\n🆔 (아이디)\\n입장 (입장횟수)회 · 퇴장 (퇴장횟수)회 · 경고 (경고횟수)개',{
  name:'11',userId:'9007199254740993123',joins:4,leaves:3,warnings:2
 });
 assert.match(result,/👤 11님/);
 assert.ok(result.includes('\\u0002'.replace('\\u0002','\u0002')+'9007199254740993123'+'\u0003'+'11'+'\u0004'));
 assert.match(result,/입장 4회 · 퇴장 3회 · 경고 2개/);
 assert.doesNotMatch(result,/\\(입장횟수\\)|\\(퇴장횟수\\)/);
});
test('count variables default to zero and only replace supported names',()=>{
 const output=renderMemberTemplate('(입장횟수)/(퇴장횟수)/(경고횟수)/(알수없는변수)',{name:'가입자',userId:'2345'});
 assert.equal(output,'0/0/0/(알수없는변수)');
});

test('warning reasons default to none and are replaced in one pass with existing variables',()=>{
 assert.equal(renderMemberTemplate('(경고사유)/(경고횟수)',{name:'가입자'}),'없음/0');
 assert.equal(renderMemberTemplate('(이름):(경고횟수):(경고사유):(경고사유):(미지원)',{
  name:'가입자',warnings:2,warningReasons:['도배','사유에 (멘션) 포함']
 }),'가입자:2:도배\n사유에 (멘션) 포함:도배\n사유에 (멘션) 포함:(미지원)');
});
