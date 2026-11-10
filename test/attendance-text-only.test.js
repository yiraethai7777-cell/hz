'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {formatAttendance}=require('../manage/attendance');
const src=file=>fs.readFileSync(path.resolve(__dirname,'..',file),'utf8');
const data={user:'123456789',name:'민수',date:'2026-11-10',time:'09:30:12',position:3,days:2};

test('first check-in produces one concise chat message, no hidden image fold',()=>{
 const result=formatAttendance({...data,isNew:true,reward:31000});
 assert.match(result,/카카오톡 매니저 \| 출석 완료/);
 assert.match(result,/민수/);
 assert.match(result,/오늘 순위 : 3등/);
 assert.match(result,/출석 시간 : 09:30:12/);
 assert.match(result,/연속 출석 : 2일/);
 assert.match(result,/총 지급 : 31,000코인/);
 assert.doesNotMatch(result,/\u200b{1200}|달력 이미지|출석 이미지를/);
});

test('repeat check-in only shows previous rank/time and never duplicates reward',()=>{
 const result=formatAttendance({...data,isNew:false,reward:0});
 assert.match(result,/이미 출석했습니다/);
 assert.match(result,/오늘 3등/);
 assert.match(result,/09:30:12/);
 assert.doesNotMatch(result,/총 지급|보상|달력|이미지|\u200b{1200}/);
});

test('active command handlers never start attendance image rendering or photo uploads',()=>{
 const commands=src('manage/commands-v2.js'),old=src('manage/index.js'),router=src('shared/router.js');
 const help=src('shared/help.js');
 for(const [file,body] of [['manage/commands-v2.js',commands],['manage/index.js',old],['shared/router.js',router]]){
  assert.doesNotMatch(body,/attendance-image|sendAttendanceImage/,file);
 }
 assert.doesNotMatch(commands,/!출석이미지/);
 assert.doesNotMatch(help,/!출석이미지/);
 assert.match(commands,/cmd==='ㅊㅅ'\|\|cmd==='!출석'/);
 assert.match(commands,/await send\(result\)/);
 assert.match(commands,/cmd==='!출석순위'/);
 assert.match(help,/출석 순위·시간·보상 정보를 채팅으로/);
});

test('attendance wallet and DB protections are retained',()=>{
 const attendance=src('manage/attendance.js');
 for(const token of ['pg_advisory_xact_lock','ON CONFLICT DO NOTHING','ensureWallet','hz_coin_logs','BEGIN','COMMIT','ROLLBACK'])
  assert.ok(attendance.includes(token),token);
});
