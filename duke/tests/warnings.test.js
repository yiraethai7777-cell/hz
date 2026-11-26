'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createWarnings}=require('../manage/warnings'),{createCore}=require('../core'),{tableFor}=require('../database');
test('warnings: authorization, reason, ID, mention and reply, selective delete, persistence, room isolation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-warning-'));try{
  const out=[],logs=[],keys=[],send=async(r,t)=>out.push(t);
  const opts={dir,onPersist:k=>keys.push(k),audit:{record:r=>logs.push(r)},canManage:e=>e.userId==='5000',botId:()=> '9000',getName:(r,u)=>u==='3000'?'김 민준':'관리자',fetchMessage:async(r,l)=>({room:{id:r},message:{logId:l,type:1},sender:{id:'3000',name:'김 민준'}})};
  let core=createCore({send});createWarnings(opts).register(core);
  const run=(text,extra={},actor='5000',roomId='1000')=>core.handle({text,userId:actor,roomId,msg:{room:{isOpenChat:true},sender:{name:'관리자'},...extra}});
  await run('-경고 3000 이유',{},'6000');assert.match(out.at(-1),/관리 권한/);
  await run('-경고 @김 민준',{attachmentsRaw:[{mentions:[{userId:'3000',name:'김 민준'}]}]});assert.match(out.at(-1),/사유 없음/);assert.match(out.at(-1),/누적 경고 : 1회/);
  await run('-경고 3000 도배');assert.match(out.at(-1),/누적 경고 : 2회/);
  await run('-경고 @김 민준 욕설',{attachmentsRaw:[{mentions:[{userId:'3000',name:'김 민준'}]}]});assert.match(out.at(-1),/누적 경고 : 3회/);
  await run('-경고 규칙 위반',{message:{type:26},attachmentsRaw:[{src_logId:'2000',src_userId:'3000'}]});assert.match(out.at(-1),/누적 경고 : 4회/);
  await run('-경고내역 3000');assert.match(out.at(-1),/\u200b{1200}/);assert.match(out.at(-1),/규칙 위반/);
  await run('-경고삭제 3000 3');assert.match(out.at(-1),/남은 경고 : 3회/);
  core=createCore({send});createWarnings(opts).register(core);
  await run('-경고내역 3000');assert.match(out.at(-1),/누적 경고 : 3회/);assert.match(out.at(-1),/욕설 \(삭제\)/);
  await run('-경고삭제 3000');assert.match(out.at(-1),/남은 경고 : 2회/);
  await run('-경고삭제 @김 민준 all',{attachmentsRaw:[{mentions:[{userId:'3000',name:'김 민준'}]}]});assert.match(out.at(-1),/남은 경고 : 0회/);
  await run('-경고내역 3000');assert.match(out.at(-1),/삭제된 경고 : 4회/);assert.match(out.at(-1),/도배 \(삭제\)/);assert.match(out.at(-1),/사유 없음 \(삭제\)/);
  await run('-경고 3000 새 경고');assert.match(out.at(-1),/누적 경고 : 1회/);
  await run('-경고내역 3000');assert.match(out.at(-1),/경고 번호 : 5/);
  await run('-경고삭제 3000 3');assert.match(out.at(-1),/이미 삭제/);
  await run('-경고내역 3000',{},'5000','2000');assert.match(out.at(-1),/누적 경고 : 0회/);
  assert.equal(logs.length,8);assert.equal(keys.length,8);assert.equal(tableFor(keys[0]),'duke_warnings');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
