'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function fixture(){
 const m={exports:{}},sent=[],queries=[];
 const db={query:async sql=>{queries.push(sql);return {rows:sql.includes('AS enabled')?[{enabled:true}]:[]};}};
 const deps={'../shared/db':{getPool:()=>db},'./attendance':{},'./chat-ranking':{},'./targets':require('../manage/targets'),'../shared/help':{},'./spam':{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../manage/commands-v2.js'),'utf8'),{module:m,exports:m.exports,require:n=>deps[n],process:{env:{}},console});
 const run=async({text='!id',role=4,message={},client={}}={})=>{
  sent.length=0;const msg={room:{id:'100',isOpenChat:true},sender:{id:'5555',type:role},...message};
  await m.exports.handle({text,roomId:'100',userId:'5555',senderType:role,msg,client,send:async t=>sent.push(t)});return sent[0];
 };
 return {run,queries};
}
test('!id resolves real mention and reply metadata without losing 64-bit IDs',async()=>{
 const {run}=fixture(),target='9007199254740993123';
 assert.match(await run({text:'!id @회원',message:{message:{mentions:[{userId:target,name:'회원'}]}}}),new RegExp(target));
 assert.match(await run({message:{message:{type:26,attachment:JSON.stringify({src_userId:target})}}}),new RegExp(target));
 assert.match(await run({text:'!id '+target}),new RegExp(target));
 assert.equal(await run(),'🆔 내 아이디: 5555');
});
test('!id never falls back to self for ambiguous or invalid targets',async()=>{
 const {run}=fixture();
 for(const message of [{mentions:[{id:'1234'},{id:'2345'}]},{message:{type:26,attachment:'{}'}},{threadId:'9999'}]){
  const reply=await run({message,client:{fetchMessage:async()=>({room:{id:'other-room'},logId:'9999',sender:{id:'1234'}})}});
  assert.match(reply,/대상을 확인할 수 없습니다/);assert.doesNotMatch(reply,/내 아이디/);
 }
});
test('!id rejects non-submanagers before resolving a target',async()=>{
 const {run,queries}=fixture();
 for(const role of [1,2,8,undefined])assert.match(await run({role:role??0,text:'!id 1234'}),/부방장만/);
 assert.ok(queries.every(sql=>sql.includes('AS enabled')));
});
