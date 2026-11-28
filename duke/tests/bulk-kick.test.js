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
test('DUKE bulk kick is bot-only, rejects spoofed sender and invalid codes',async()=>{
 const x=fixture();
 assert.equal(x.command.section,'BOT');
 assert.equal(x.command.hidden,true);
 for(const role of [1,4,2])assert.match(await x.execute('1005',role),/봇 계정만/);
 assert.match(await x.execute('1001',1,['10'],'1005'),/봇 계정만/);
 for(const args of [[],['0'],['1'],['9'],['11'],['10','2']])assert.match(await x.execute('1001',1,args),/실행 코드/);
 assert.equal(x.loads(),0);
 assert.equal(x.calls.length,0);
});
test('DUKE delegates to Manager implementation with fixed code and protected staff',async()=>{
 const x=fixture();
 assert.match(await x.execute('1001',1),/성공 : 13명/);
 assert.deepEqual(x.calls.map(c=>c[1]).sort(),Array.from({length:13},(_,i)=>String(1100+i)));
 assert.equal(x.records.length,1);
 assert.equal(x.records[0].command,'-일괄강퇴');
});

test('hidden bot command is excluded from the help text and public count',async()=>{
 const {createCore}=require('../core'),sent=[];
 const core=createCore({send:async(r,v)=>sent.push(v)});
 core.register({name:'일괄강퇴',section:'BOT',hidden:true,description:'비공개',execute:()=> '실행됨'});
 await core.handle({roomId:'2000',userId:'1001',text:'-도움말'});
 assert.doesNotMatch(sent[0],/일괄강퇴|비공개/);
 assert.match(sent[0],/등록 명령어 : 4개/);
});
