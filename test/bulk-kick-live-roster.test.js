'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const bulk=require('../manage/bulk-kick');
const roster=require('../shared/live-roster');

const client={connected:true,userId:'9999'};
function db(){
 const audits=[];
 return {audits,async query(sql,args){
  if(sql.startsWith('SELECT user_id FROM gl_manage_admins'))return {rows:[{user_id:'1003'}]};
  if(sql.startsWith('INSERT INTO gl_manage_actions')){audits.push(args);return {rowCount:1};}
  throw Error('unexpected query '+sql.slice(0,50));
 }};
}
const args={
 client,roomId:'1234555',msg:{room:{isOpenChat:true}},userId:'master:test',
 db:db(),owner:true,listSuperAdmins:async()=>[{user_id:'1004'}]
};
test('live CHATONROOM roster marks unknown roles as unsafe, not as ordinary',async()=>{
 const c={connected:true,_carriage:{chatOnRoom:async()=>({
  status:0,body:{status:0,m:[
   {userId:'2001',nickName:'일반',mt:2},
   {userId:'2002',nickName:'미확인'},
   {userId:'2003',nickName:'부방장',mt:4}
  ]}
 })}};
 const snapshot=await roster.refresh(c,'1234556',{force:true});
 assert.deepEqual(snapshot.members.map(m=>[m.id,m.roleKnown,m.type]),[
  ['2001',true,2],['2002',false,0],['2003',true,4]
 ]);
});
test('bulk-kick uses fresh roster, protects staff, and checks kick responses',async()=>{
 const kicked=[];
 const outcome=await bulk.handle({
  ...args,loadRoster:async()=>{
   return {members:[
    {id:'1001',type:2,roleKnown:true},
    {id:'1002',type:1,roleKnown:true},
    {id:'1003',type:2,roleKnown:true},
    {id:'1004',type:2,roleKnown:true},
    {id:'1005',type:0,roleKnown:false},
    {id:'1006',type:4,roleKnown:true},
    {id:'1007',type:0,roleKnown:true},
    {id:'1008',type:2,roleKnown:true},
    {id:'9999',type:2,roleKnown:true}
   ]};
  },kick:async userId=>{
   kicked.push(userId);
   if(userId==='1001')return {body:{status:0}};
   if(userId==='1007')return false;
   return undefined;
  }
 });
 assert.deepEqual(kicked.sort(),['1001','1007','1008']);
 assert.equal(outcome.attempted,3);
 assert.equal(outcome.success,1);
 assert.equal(outcome.failed,1);
 assert.equal(outcome.unverified,1);
 assert.equal(outcome.skipped.protected,5);
 assert.equal(outcome.skipped.unknownRole,1);
});
test('kick states reject errors and do not invent success for missing results',()=>{
 assert.equal(bulk.kickState({body:{status:-1}}),'rejected');
 assert.equal(bulk.kickState(false),'rejected');
 assert.equal(bulk.kickState({status:0,body:{status:403}}),'rejected');
 assert.equal(bulk.kickState(undefined),'unverified');
 assert.equal(bulk.kickState({body:{status:0}}),'accepted');
});
test('failed live member lookup must not kick anyone',async()=>{
 let kicked=0;
 await assert.rejects(()=>bulk.handle({
  ...args,roomId:'1234557',loadRoster:async()=>{throw Error('CHATONROOM unavailable');},
  kick:async()=>{kicked++;return {status:0};}
 }),/CHATONROOM unavailable/);
 assert.equal(kicked,0);
});
test('web job records failure and does not report success',async()=>{
 const job=bulk.start({
  ...args,roomId:'1234558',loadRoster:async()=>{throw Error('실시간 참가자 정보 오류');},
  kick:async()=>({status:0})
 });
 assert.equal(job.status,'running');
 await new Promise(resolve=>setImmediate(resolve));
 const result=bulk.getStatus('1234558');
 assert.equal(result.status,'failed');
 assert.match(result.error,/실시간 참가자 정보 오류/);
 assert.equal(result.success,0);
});
