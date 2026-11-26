'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createUserInfo}=require('../manage/user-info'),{createCore}=require('../core'),{createReplyModeration}=require('../manage/reply-moderation'),{createWarnings}=require('../manage/warnings');
test('info uses scoped current profile, role and active warning count; retains deleted reasons',async()=>{
 const out=[],send=async(r,t)=>out.push(t),core=createCore({send});
 const moderation=createReplyModeration({botId:()=> '9000',send});moderation.register(core);
 const warnings=createWarnings({canManage:moderation.canManage,botId:()=> '9000'});warnings.register(core);
 let lookups=0;
 createUserInfo({canManage:moderation.canManage,role:moderation.role,getHistory:warnings.getHistory,lookup:async(r,u)=>{lookups++;assert.equal(r,'1000');assert.equal(u,'3000');return {name:'회원',memberType:2,url:'https://open.kakao.com/o/example',imageUrl:'https://k.kakaocdn.net/dn/example'};}}).register(core);
 const run=(text,type=4,userId='5000')=>core.handle({text,roomId:'1000',userId,msg:{room:{isOpenChat:true},sender:{type}}});
 await run('-경고 3000 도배');await run('-경고 3000 욕설');await run('-경고삭제 3000 1');
 await run('-정보 3000',2);assert.equal(lookups,0);assert.match(out.at(-1),/관리 권한/);
 await run('-정보 3000');const [summary,detail]=out.at(-1).split('\u200b'.repeat(1200));assert.match(summary,/회원님의 정보/);assert.doesNotMatch(summary,/3000/);assert.match(detail,/아이디 : 3000/);assert.match(detail,/권한 : 일반/);assert.match(detail,/경고 횟수 : 1회/);assert.match(detail,/도배 \(삭제\)/);assert.match(detail,/욕설/);assert.match(detail,/https:\/\/open.kakao.com\/o\/example/);
 await run('-관리자추가 3000',1,'9000');await run('-정보 3000');assert.match(out.at(-1),/권한 : 추가 관리자/);
 assert.equal(moderation.role('1000','3000',1),'방장');assert.equal(moderation.role('1000','3000',4),'부방장');assert.equal(moderation.role('1000','9000',2),'봇 계정');assert.equal(moderation.role('1000','4000',undefined),'확인 불가');
});
