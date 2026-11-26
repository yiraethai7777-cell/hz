'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createAttendance}=require('../utility/attendance'),{createCore}=require('../core'),{tableFor}=require('../database');
test('attendance aliases share daily state, rank, Korean midnight, persistence, room isolation and bot power gate',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-attendance-')),out=[],dirty=[];let at=Date.parse('2026-11-30T14:59:59Z'),enabled=true;
 const send=async(r,t)=>out.push(t),opts={dir,now:()=>at,onPersist:k=>dirty.push(k)};
 let core=createCore({send,canHandle:()=>enabled});createAttendance(opts).register(core);
 const cmd=(text,u='3000',r='1000',open=true)=>core.handle({roomId:r,userId:u,text,msg:{room:{id:r,isOpenChat:open},sender:{name:'회원'}}});
 try{
  await cmd('-출석');assert.match(out.at(-1),/출석 순위 : 1등/);assert.match(out.at(-1),/23:59:59/);
  await cmd('-ㅊㅅ');assert.match(out.at(-1),/이미 출석/);await cmd('ㅊㅅ');assert.match(out.at(-1),/이미 출석/);assert.equal(dirty.length,1);
  await cmd('ㅊㅅ','4000');assert.match(out.at(-1),/출석 순위 : 2등/);
  await cmd('-출석','3000','2000');assert.match(out.at(-1),/출석 순위 : 1등/);
  await cmd('-ㅊㅅ','5000','1000',false);assert.match(out.at(-1),/오픈채팅방/);
  assert.equal(await cmd('ㅊㅅ 안녕'),false);await cmd('-출석 1');assert.match(out.at(-1),/사용법/);
  core=createCore({send,canHandle:()=>enabled});createAttendance(opts).register(core);await cmd('ㅊㅅ');assert.match(out.at(-1),/이미 출석/);
  at+=1000;await cmd('-ㅊㅅ');assert.match(out.at(-1),/출석 순위 : 1등/);assert.match(out.at(-1),/2026-12-01/);
  enabled=false;assert.equal(await cmd('ㅊㅅ','6000'),false);enabled=true;await cmd('ㅊㅅ','6000');assert.match(out.at(-1),/출석 순위 : 2등/);
  assert.equal(tableFor('attendance/1000-2026-12.json'),'duke_attendance');
  assert.equal(tableFor('attendance/1000-2026-99.json'),null);
  await cmd('-도움말');assert.match(out.at(-1),/-출석 : 하루 1회 출석/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
