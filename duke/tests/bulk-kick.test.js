'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {registerBulkKick}=require('../manage/bulk-kick');
function fixture(){
 let command,loads=0;
 const calls=[],records=[],bot='1001';
 const members=[{id:bot,type:1},{id:'1002',type:4},{id:'1003',type:2},{id:'1004',type:2,roleKnown:false},...Array.from({length:13},(_,i)=>({id:String(1100+i),type:2}))];
 registerBulkKick({register:c=>{command=c}},{client:{userId:bot,connected:true},listAdmins:async()=>['1003'],audit:{record:r=>records.push(r)},kick:async(r,u)=>{calls.push([r,u]);return {status:0}},loadRoster:async()=>{loads++;return {members}},logger:{warn(){}}});
 const execute=(userId,role,args=['10'],senderId=userId)=>command.execute({userId,roomId:'2000',msg:{room:{isOpenChat:true},sender:{id:senderId,type:role}},args});
 return {execute,calls,records,loads:()=>loads,command};
}
test('DUKE bulk kick is bot-only, rejects spoofed sender and invalid counts',async()=>{
 const x=fixture();
 assert.equal(x.command.section,'BOT');
 for(const role of [1,4,2])assert.match(await x.execute('1005',role),/봇 계정만/);
 assert.match(await x.execute('1001',1,['10'],'1005'),/봇 계정만/);
 for(const args of [[],['0'],['11'],['10','2']])assert.match(await x.execute('1001',1,args),/사용법/);
 assert.equal(x.loads(),0);
 assert.equal(x.calls.length,0);
});
test('DUKE delegates to Manager implementation with requested cap and protected staff',async()=>{
 const x=fixture();
 assert.match(await x.execute('1001',1),/성공 : 10명/);
 assert.deepEqual(x.calls.map(c=>c[1]).sort(),Array.from({length:10},(_,i)=>String(1100+i)));
 assert.equal(x.records.length,1);
 assert.equal(x.records[0].command,'-일괄강퇴 10');
});
