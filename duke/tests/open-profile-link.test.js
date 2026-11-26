'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createOpenProfileLink,validLink}=require('../utility/open-profile-link'),{createCore}=require('../core');
test('open profile command uses current room target and returns plain link; self, mention, ID and reply',async()=>{
 const out=[],calls=[];let at=10000;const core=createCore({send:async(r,t)=>out.push(t)});
 createOpenProfileLink({botId:()=> '2000',now:()=>at,lookup:async(r,u)=>{calls.push([r,u]);return {name:'회원',url:u==='9000'?'':'https://open.kakao.com/o/Ab123'};},fetchMessage:async(r,l)=>({room:{id:r},message:{logId:l,type:1},sender:{id:'4000'}})}).register(core);
 const run=(text,extra={})=>core.handle({roomId:'1000',userId:'2000',text,msg:{room:{isOpenChat:true},...extra}});
 await run('-옾링');assert.equal(out.at(-1),'회원님의 오픈프로필 링크\nhttps://open.kakao.com/o/Ab123');assert.deepEqual(calls.at(-1),['1000','2000']);
 await run('-옾링');assert.match(out.at(-1),/3초/);
 at+=4000;await run('-옾링 @회원',{attachmentsRaw:[{mentions:[{userId:'3000'}]}]});assert.deepEqual(calls.at(-1),['1000','3000']);
 at+=4000;await run('-옾링',{message:{type:26},attachmentsRaw:[{src_userId:'4000',src_logId:'7000'}]});assert.deepEqual(calls.at(-1),['1000','4000']);
 at+=4000;await run('-옾링 9000');assert.match(out.at(-1),/링크가 없습니다/);
 assert.equal(validLink('https://open.kakao.com.evil.test/o/Ab123'),'');assert.equal(validLink('https://open.kakao.com/o/Ab123'),'https://open.kakao.com/o/Ab123');
});
