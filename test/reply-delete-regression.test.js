'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const deletion=require('../shared/reply-delete');
const room='18452389232976863';
const bot='446486065';
const user='1234567890123';
const target='3962127585876015106';
function command(chatLog={}){
 return {
  room:{id:room,isOpenChat:true},
  sender:{id:user,type:1},
  message:{text:'삭제',type:1,logId:'3969999999999999999'},
  raw:{chatLog:{type:1,logId:'3969999999999999999',...chatLog}}
 };
}
function original(author=bot){
 return {room:{id:room},sender:{id:author},message:{logId:target,type:1,text:'NEXI message'}};
}
function context(msg=command({threadId:target}),author=bot,response={status:0,body:{status:0}}){
 const sent=[],deleted=[];
 return {
  sent,deleted,
  ctx:{
   msg,roomId:room,senderId:user,text:'삭제',isBotAccount:false,
   chat:{sendText:async(_r,message)=>{sent.push(message);}},
   client:{userId:bot,fetchMessage:async()=>original(author),
    deleteMessage:async(r,log)=>{deleted.push({r,log});return response;}}
  }
 };
}
test('extracts 64-bit quote IDs from real attachment JSON',()=>{
 const msg=command({extra:JSON.stringify({src_logId:target,src_userId:bot})});
 assert.equal(deletion.reference(msg).log,target);
 assert.equal(deletion.reference(msg).author,bot);
});
test('extracts quotes stored in supplement and nested source',()=>{
 assert.equal(deletion.reference(command({supplement:JSON.stringify({src_logId:target})})).log,target);
 assert.equal(deletion.reference(command({extra:JSON.stringify({src:{src_logId:target}})})).log,target);
});
test('reads threadId from type 1 messages without an attachment',()=>{
 assert.equal(deletion.reference(command({threadId:target})).log,target);
 assert.equal(deletion.reference(command({threadId:'0'})),null);
});
test('authorized moderator deletes only a verified NEXI-authored message',async()=>{
 const t=context();
 assert.equal(await deletion.handle(t.ctx),true);
 assert.deepEqual(t.deleted,[{r:room,log:target}]);
 assert.equal(t.sent.length,0);
});
test('cannot delete a message from a different sender',async()=>{
 const t=context(command({threadId:target}),'7777777777');
 assert.equal(await deletion.handle(t.ctx),true);
 assert.equal(t.deleted.length,0);
 assert.match(t.sent.at(-1),/봇이 보낸 원본 메시지를 확인할 수 없어/);
});
test('missing reply metadata never guesses a target',async()=>{
 const t=context(command({threadId:'0'}));
 assert.equal(await deletion.handle(t.ctx),true);
 assert.equal(t.deleted.length,0);
 assert.match(t.sent.at(-1),/원본 메시지를 확인하지 못했습니다/);
});
test('nested Kakao delete errors do not count as success',async()=>{
 const t=context(command({threadId:target}),bot,{status:0,body:{status:-500}});
 assert.equal(await deletion.handle(t.ctx),true);
 assert.equal(t.deleted.length,1);
 assert.match(t.sent.at(-1),/삭제에 실패했습니다/);
});
