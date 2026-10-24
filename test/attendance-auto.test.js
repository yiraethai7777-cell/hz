'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../manage/attendance-image/automatic.js'),'utf8');

function createFixture({snapshot,render,deliver}={}){
 const emitted=[],calls={reads:0,renders:0,uploads:0};
 const expected=snapshot===undefined?{
  roomId:'12345',userId:'67890',name:'출석 회원',today:'2026-10-24',
  attendanceDate:'2026-10-24',streak:3,total:12,reward:'32000',
  dates:['2026-10-22','2026-10-23','2026-10-24']
 }:snapshot;
 const m={exports:{}};
 const buffer=Buffer.from([137,80,78,71,13,10,26,10,1]);
 const deps={
  '../../shared/db':{getPool:()=>({})},
  './data':{readSnapshot:async(_pool,args)=>{
   calls.reads++;
   assert.equal(args.roomId,'12345');assert.equal(args.userId,'67890');
   return expected;
  }},
  './render':{renderAttendance:async input=>{calls.renders++;return render?render(input):buffer;}},
  './send':{sendPng:async(client,room,image,opts)=>{
   calls.uploads++;
   assert.equal(room,'12345');
   assert.equal(opts.caption,'📅 출석 회원님의 출석 달력 · 2026-10-24');
   assert.equal(image,buffer);
   return deliver?deliver(client):{confirmed:true};
  }}
 };
 vm.runInNewContext(source,{
  module:m,exports:m.exports,require:name=>{
   if(!Object.prototype.hasOwnProperty.call(deps,name))throw Error('unexpected import '+name);
   return deps[name];
  },console:{log(){},error(){}},Set,Error,Promise,String
 },{filename:'automatic.js'});
 const send=async text=>emitted.push(String(text));
 return {sendAttendanceImage:m.exports.sendAttendanceImage,calls,emitted,context:{roomId:'12345',userId:'67890',send},client:{connected:true}};
}

test('new attendance creates and sends a real-record image with no extra attendance writes',async()=>{
 const f=createFixture();
 assert.equal(await f.sendAttendanceImage(f.client,f.context),true);
 assert.equal(f.calls.reads,1);
 assert.equal(f.calls.renders,1);
 assert.equal(f.calls.uploads,1);
 assert.deepEqual(f.emitted,[]);
});

test('resend without attendance record does not create a fictional image',async()=>{
 const f=createFixture({snapshot:{
  roomId:'12345',userId:'67890',name:'출석 회원',
  today:'2026-10-24',attendanceDate:null,reward:null,dates:[]
 }});
 assert.equal(await f.sendAttendanceImage(f.client,{...f.context,onDemand:true}),false);
 assert.equal(f.calls.renders,0);
 assert.equal(f.calls.uploads,0);
 assert.match(f.emitted.join(' '),/먼저 !출석/);
});

test('upload errors preserve attendance and offer manual retry',async()=>{
 const f=createFixture({deliver:async()=>{throw Error('network failure');}});
 assert.equal(await f.sendAttendanceImage(f.client,f.context),false);
 assert.equal(f.calls.uploads,1);
 assert.match(f.emitted.join(' '),/출석은 정상 완료/);
 assert.match(f.emitted.join(' '),/!출석이미지/);
});

test('concurrent photo requests do not upload duplicate images',async()=>{
 let release;
 const f=createFixture({deliver:async()=>new Promise(r=>{release=()=>r({confirmed:true})})});
 const first=f.sendAttendanceImage(f.client,f.context);
 for(let i=0;i<20&&!release;i++)await Promise.resolve();
 assert.equal(typeof release,'function');
 const concurrent=await f.sendAttendanceImage(f.client,{...f.context,onDemand:true});
 assert.equal(concurrent,false);
 assert.match(f.emitted.join(' '),/전송하고 있습니다/);
 assert.equal(f.calls.uploads,1);
 release();
 assert.equal(await first,true);
});
