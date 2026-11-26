'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createManagementLog}=require('../manage/audit-log'),{createReplyModeration}=require('../manage/reply-moderation'),{createMembership}=require('../manage/membership'),{createCore}=require('../core');
test('room scoped latest 15, persisted across restart and folded',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-audit-'));try{
  let at=1700000000000;const options={dir,now:()=>++at};let audit=createManagementLog(options);
  for(let i=1;i<=17;i++)assert.equal(audit.record({roomId:'1000',actorId:'2000',actorName:'관리자',targetId:'3000',targetName:'회원'+i,command:'-벤',result:'강퇴 요청 성공'}),true);
  audit.record({roomId:'2000',actorId:'2000',targetName:'별도 채팅방',command:'-입장알림 on',result:'ON'});
  audit=createManagementLog(options);const [summary,detail]=audit.render('1000').split('\u200b'.repeat(1200));
  assert.match(summary,/최근 기록 : 15건/);assert.ok(!summary.includes('회원17'));assert.match(detail,/1\. -벤/);assert.match(detail,/15\. -벤/);assert.ok(detail.indexOf('회원17 (')<detail.indexOf('회원3 ('));assert.ok(!detail.includes('회원2 ('));assert.ok(!detail.includes('별도 채팅방'));assert.match(audit.render('2000'),/별도 채팅방/);assert.match(audit.render('4000'),/아직 기록된/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('management integration records real outcomes, protects log access and skips read-only commands',async()=>{
 const out=[],audit=createManagementLog(),send=async(r,t)=>{out.push(t);return {status:0,body:{logId:'1000'}};};
 const m=createReplyModeration({audit,botId:()=> '9000',send,kick:async()=>({status:0}),unban:async()=>({success:false}),getName:(r,u)=>u==='3000'?'회원':'관리자',logger:{error(){}}});
 const member=createMembership({audit,botId:()=> '9000',send});const core=createCore({send});m.register(core);member.register(core);
 const run=(text,userId='5000',type=4)=>core.handle({roomId:'1000',userId,text,msg:{room:{isOpenChat:true},sender:{name:'담당자',type}}});
 await run('-내풀 3000');await run('-입장알림 on','9000');await run('-관리자추가 6000','9000');await run('-관리로그','8000',2);assert.match(out.at(-1),/관리 권한이 없습니다/);
 await run('-관리로그');assert.match(out.at(-1),/최근 기록 : 3건/);assert.match(out.at(-1),/강퇴 성공 \/ 벤 해제 미확인/);assert.match(out.at(-1),/담당자/);assert.match(out.at(-1),/회원/);
 await run('-관리로그');assert.match(out.at(-1),/최근 기록 : 3건/);
});
