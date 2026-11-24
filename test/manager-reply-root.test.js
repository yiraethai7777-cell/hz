'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {resolveRoot}=require('../manage/targets');
const {targetOf}=require('../manage/commands-v2');
const room='18490000000123456',bot='99999999',originalId='11111111',replier='22222222';
const msg=(log,author,type=1,replyLog='',replyAuthor='')=>({
 room:{id:room,isOpenChat:true},
 sender:{id:author,name:author===originalId?'원문 작성자':'중간 답장'},
 message:{logId:log,type,...(replyLog?{attachment:{reply:{src_logId:replyLog,src_userId:replyAuthor}}}:{})}
});
const original=msg('10001',originalId);
const middle=msg('20001',replier,26,'10001',originalId);
const command=msg('30001','33333333',26,'20001',replier);
const emptyDb={query:async()=>({rows:[],rowCount:0})};
const client=(records)=>({
 userId:bot,async fetchMessage(roomId,log){assert.equal(String(roomId),room);return records[log]||null}
});
test('!내풀 resolves a reply-of-reply to original author, not latest reply author',async()=>{
 const api=client({'20001':middle,'10001':original});
 const t=await targetOf(emptyDb,room,command,'',api,true,true);
 assert.equal(t.id,originalId);
 assert.notEqual(t.id,replier);
});
test('!내풀 follows arbitrarily nested verified replies',async()=>{
 const third=msg('25001','77777777',26,'20001',replier);
 const cmd=msg('30001','33333333',26,'25001','77777777');
 const t=await resolveRoot({msg:cmd,roomId:room,client:client({'25001':third,'20001':middle,'10001':original}),db:emptyDb});
 assert.equal(t.id,originalId);
});
test('!내풀 does not kick the intermediate replier when the root cannot be verified',async()=>{
 const api=client({'20001':middle});
 assert.equal(await targetOf(emptyDb,room,command,'',api,true,true),null);
 assert.equal(await targetOf(emptyDb,room,command,'',{},true,true),null);
 assert.equal(await targetOf(emptyDb,room,command,'',client({'20001':{...middle,message:{logId:'20001',type:26}}}),true,true),null);
});
test('!내풀 rejects mismatched fetched message, cycles, and excessive depth',async()=>{
 const fake={...original,room:{id:'1888888888'}};
 assert.equal(await resolveRoot({msg:msg('30001','33333333',26,'10001',originalId),roomId:room,client:client({'10001':fake}),db:emptyDb}),null);
 const cycle=msg('20001',replier,26,'20001',replier);
 assert.equal(await resolveRoot({msg:command,roomId:room,client:client({'20001':cycle}),db:emptyDb}),null);
 assert.equal(await resolveRoot({msg:command,roomId:room,client:client({'20001':middle,'10001':original}),db:emptyDb,maxDepth:1}),null);
});
test('Direct ID and actual mention continue taking precedence',async()=>{
 const api=client({});
 assert.equal((await targetOf(emptyDb,room,command,'44444444',api,true,true)).id,'44444444');
 const mention={...command,mentions:[{userId:'55555555',name:'직접 멘션'}]};
 assert.equal((await targetOf(emptyDb,room,mention,'',api,true,true)).id,'55555555');
});
test('Known bot-authored leave notice retains the logged kick target',async()=>{
 const db={query:async(sql,args)=>{
  assert.match(sql,/gl_leave_replies/);
  return {rows:args[1]==='90001'?[{target_id:'12121212',target_name:'퇴장 대상'}]:[]};
 }};
 const quoted=msg('40001','33333333',26,'90001',bot);
 const t=await resolveRoot({msg:quoted,roomId:room,client:{userId:bot},db});
 assert.deepEqual(t,{id:'12121212',name:'퇴장 대상'});
});
