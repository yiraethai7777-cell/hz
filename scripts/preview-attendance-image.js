'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {renderAttendance}=require('../manage/attendance-image/render');
const cases=[
 {file:'01-2026-10.png',name:'김민수',today:'2026-10-19',streak:1,total:1,reward:'30000',days:[19]},
 {file:'02-long-name.png',name:'아주아주긴한글닉네임을사용하는출석테스트사용자입니다',today:'2026-10-19',streak:100,total:1000,reward:'129000',days:Array.from({length:19},(_,i)=>i+1)},
 {file:'03-february.png',name:'서연',today:'2026-02-28',streak:1,total:25,reward:'30000',days:[1,4,8,20,28]},
 {file:'04-leap-february.png',name:'윤년 테스트',today:'2024-02-29',streak:100,total:1000,reward:'129000',days:Array.from({length:29},(_,i)=>i+1)},
 {file:'05-december-six-weeks.png',name:'지우',today:'2023-12-31',streak:7,total:1000,reward:'36000',days:[1,8,25,26,27,28,29,30,31]},
 {file:'06-escaped-name.png',name:'<출석 & 확인> "별명"',today:'2026-10-19',streak:2,total:50,reward:'31000',days:[1,3,18,19]}
];
async function main(){
 const output=path.resolve(process.argv[2]||path.join(__dirname,'../../../outputs/attendance-images'));await fs.mkdir(output,{recursive:true});
 const start=Date.now();
 const results=await Promise.all(cases.map(async sample=>{
  const dates=sample.days.map(day=>sample.today.slice(0,7)+'-'+String(day).padStart(2,'0'));
  const buffer=await renderAttendance({...sample,attendanceDate:sample.today,dates});await fs.writeFile(path.join(output,sample.file),buffer);
  return {file:sample.file,name:sample.name,date:sample.today,streak:sample.streak,total:sample.total,reward:sample.reward,dates,bytes:buffer.length};
 }));
 await fs.writeFile(path.join(output,'test-data.json'),JSON.stringify({kind:'isolated fixtures, no live attendance or coin changes',elapsedMs:Date.now()-start,images:results},null,2));
 console.log(JSON.stringify({output,count:results.length,elapsedMs:Date.now()-start,totalBytes:results.reduce((n,r)=>n+r.bytes,0)}));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={cases};
