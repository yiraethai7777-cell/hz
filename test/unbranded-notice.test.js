'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {joinNotice,leaveNotice}=require('../manage/leave-reply');

test('join alert shows two-line collapsed notice with real member fields',()=>{
 const msg=joinNotice({
  name:'홍길동',userId:'123456789',joins:1,leaves:0,bans:0,
  time:'2026. 10. 24. 01:25',profileType:0,
  profileLink:'https://open.kakao.com/o/test123',
  profileImage:'https://example.com/avatar.jpg'
 });
 const [visible,detail]=msg.split('\u200b'.repeat(1200));
 assert.equal(visible,'\u0002123456789\u0003홍길동\u0004 님이 채팅방에 입장하셨습니다.\n');
 assert.match(detail,/┏━━━━━━━━━━━━━━━━━━━━\n┃회원 프로필\n┣/);
 assert.match(detail,/┃└ 닉네임\s+홍길동/);
 assert.match(detail,/┃└ 유저 ID\s+123456789/);
 assert.match(detail,/┃└ 프로필\s+오픈프로필/);
 assert.match(detail,/┃└ 프사 URL\s+https:\/\/example.com\/avatar.jpg/);
 assert.match(detail,/┃└ 오픈프로필 URL\s+https:\/\/open.kakao.com\/o\/test123/);
 assert.match(detail,/┃└ 입장 시각\s+2026. 10. 24. 01:25/);
 assert.match(detail,/┃└ 누적 입장\s+1회/);
 assert.match(detail,/┃└ 누적 퇴장\s+0회/);
 assert.match(detail,/┃└ 강퇴 기록\s+0회/);
 assert.doesNotMatch(msg,/NEXUS/i);
});

test('missing name and URLs use safe placeholders; no empty @ mention',()=>{
 const msg=joinNotice({name:'',userId:'123456789',time:'2026. 10. 24. 01:25',profileType:'확인 불가'});
 assert.match(msg,/123456789/);
 assert.doesNotMatch(msg,/@ 님/);
 assert.match(msg,/┃└ 프로필\s+확인 불가/);
 assert.match(msg,/┃└ 프사 URL\s+확인 불가/);
 assert.match(msg,/┃└ 오픈프로필 URL\s+확인 불가/);
 const unknown=joinNotice({name:'',userId:null});
 assert.match(unknown,/@알 수 없음 님/);
 assert.match(unknown,/유저 ID\s+확인 불가/);
});

test('leave alert retains activity fields and reply-k moderation advice',()=>{
 const msg=leaveNotice({name:'테스터',userId:'123456789',joins:3,leaves:2,bans:1,
  joinedAt:'2026. 10. 24. 01:00',time:'2026. 10. 24. 01:25',stay:'25분'});
 assert.match(msg,/세션 기록/);
 assert.match(msg,/체류 시간\s+25분/);
 assert.match(msg,/누적 입장\s+3회/);
 assert.match(msg,/누적 퇴장\s+2회/);
 assert.match(msg,/강퇴 기록\s+1회/);
 assert.match(msg,/답장으로 k/);
 assert.doesNotMatch(msg,/NEXUS/i);
});
