'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPcCommands,kickResult,resolveTarget}=require('../pc-commands');
const room='18496234145974738',bot='12345678901234',mod='22222222222222';
const member='33333333333333',outside='44444444444444';
const msg=(text,id=mod,role=1,attachment)=>({
 room:{id:room,isOpenChat:true},sender:{id,type:role},
 message:{text,...(attachment?{type:26,attachment:JSON.stringify(attachment)}:{})}
});
const setup=({roster=[{id:bot,role:4},{id:mod,role:1},{id:member,role:2}],result={status:0},allow=true}={})=>{
 const sent=[],kicked=[];
 const client={connected:true,userId:bot,
  openChatKick:async(roomId,id)=>{kicked.push({roomId,id});return result}};
 const commands=createPcCommands({
  client,roomId:room,loadRoster:async()=>roster,
  send:async(r,text)=>{sent.push({room:r,text})},
  canKick:()=>allow
 });
 return {sent,kicked,client,commands};
};
test('ping and self id work with no database',async()=>{
 const a=setup();
 assert.equal(await a.commands.handleChat(msg('!핑',member,2)),true);
 assert.match(a.sent.at(-1).text,/퐁/);
 assert.equal(await a.commands.handleChat(msg('!id',member,2)),true);
 assert.match(a.sent.at(-1).text,new RegExp(member));
 assert.equal(await a.commands.handleChat(msg('!k',member,2)),true);
 assert.match(a.sent.at(-1).text,/권한이 없습니다/);
 assert.equal(a.kicked.length,0);
});
test('target ID lookup and single kick require room privileges',async()=>{
 const a=setup();
 await a.commands.handleChat(msg('!id '+member,member,2));
 assert.match(a.sent.at(-1).text,/ID 조회/);
 await a.commands.handleChat(msg('!id '+member));
 assert.match(a.sent.at(-1).text,new RegExp(member));
 await a.commands.handleChat(msg('!k '+member));
 assert.deepEqual(a.kicked,[{roomId:room,id:member}]);
 assert.match(a.sent.at(-1).text,/서버에서 수락/);
});
test('actual mention and reply identity use original target parser without DB',async()=>{
 const a=setup();
 const withMention=msg('!k @대상');
 withMention.mentions=[{userId:member,name:'대상'}];
 assert.equal((await resolveTarget({msg:withMention,text:'!k @대상',roomId:room,client:a.client})).id,member);
 const withReply=msg('!k',mod,1,{src_userId:member,src_logId:'987654321'});
 assert.equal((await resolveTarget({msg:withReply,text:'!k',roomId:room,client:a.client})).id,member);
 await a.commands.handleChat(withReply);
 assert.equal(a.kicked[0].id,member);
});
test('bot account may issue commands; targets and staff are protected',async()=>{
 const a=setup();
 await a.commands.handleChat(msg('!k '+member,bot,2));
 assert.equal(a.kicked.length,1);
 await a.commands.handleChat(msg('!k '+mod));
 assert.match(a.sent.at(-1).text,/방장·부방장/);
 await a.commands.handleChat(msg('!k '+bot));
 assert.match(a.sent.at(-1).text,/본인 계정/);
 assert.equal(a.kicked.length,1);
});
test('departed user id can be attempted but success is never assumed without server acknowledgement',async()=>{
 const a=setup();
 await a.commands.handleChat(msg('!k '+outside));
 assert.equal(a.kicked[0].id,outside);
 assert.equal(kickResult({status:0}),'accepted');
 assert.equal(kickResult({}),'unverified');
 assert.throws(()=>kickResult({status:1}),/거부/);
 const b=setup({result:{status:0,body:{status:403}}});
 await b.commands.handleChat(msg('!k '+member));
 assert.match(b.sent.at(-1).text,/거부/);
});
test('room restrictions and operator checks do not trigger a kick for unrelated messages',async()=>{
 const a=setup({allow:false});
 const other=msg('!k '+member);
 other.room.id='55555555555555';
 assert.equal(await a.commands.handleChat(other),false);
 assert.equal(await a.commands.handleChat(msg('알림 테스트')),false);
 await a.commands.handleChat(msg('!k '+member));
 assert.match(a.sent.at(-1).text,/진행 중/);
 assert.equal(a.kicked.length,0);
});
test('missing manager rights fail closed',async()=>{
 const a=setup({roster:[{id:bot,role:2},{id:member,role:2}]});
 await a.commands.handleChat(msg('!k '+member));
 assert.match(a.sent.at(-1).text,/방장·부방장 권한/);
 assert.equal(a.kicked.length,0);
});
test('reply with only log ID requires exact original room and message ID',async()=>{
 const a=setup();
 a.client.fetchMessage=async(r,id)=>({room:{id:r},message:{logId:id},sender:{id:member,name:'대상'}});
 const withReply=msg('!id',mod,1,{src_logId:'77777777'});
 assert.equal((await resolveTarget({msg:withReply,text:'!id',roomId:room,client:a.client})).id,member);
 a.client.fetchMessage=async()=>({room:{id:'99999999999999'},message:{logId:'77777777'},sender:{id:member}});
 await assert.rejects(resolveTarget({msg:withReply,text:'!id',roomId:room,client:a.client}),/검증/);
});
