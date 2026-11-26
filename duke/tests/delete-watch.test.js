'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCore}=require('../core'),{createDeleteWatch}=require('../manage/delete-watch');
test('delete watch is opt-in, room scoped, admin reply only and edits same log after 10s',async()=>{
 const out=[],edits=[],timers=[];let at=1;const room={id:'1000',isOpenChat:true};
 const send=async(r,t,o)=>{out.push({r,t,o});return {status:0,body:{logId:String(8000+out.length)}};};
 const w=createDeleteWatch({botId:()=> '9000',now:()=>at,send,edit:async(...a)=>{edits.push(a);return {status:0};},canManage:e=>e.userId==='9000',delay:(fn,ms)=>timers.push({fn,ms})});
 const core=createCore({send});w.register(core);
 const cmd=text=>core.handle({text,roomId:'1000',userId:'9000',msg:{room}});
 const msg={room,sender:{name:'회원'},message:{logId:'5000',type:1}},e={roomId:'1000',userId:'3000',text:'테스트'};
 const del={room,logId:'5000',members:[{id:'3000',name:'회원'}],actor:{id:'3000'},raw:{body:{chatId:'1000'}}};
 await cmd('-삭제감지 on');w.observe(msg,e);await w.onDelete(del);assert.match(out.at(-1).t,/@회원님이 메세지를 삭제하셨습니다/);assert.doesNotMatch(out.at(-1).t,/테스트/);const notice=String(8000+out.length);
 const reply={room,message:{type:26,attachment:{src_userId:'9000',src_logId:notice}}};
 await w.handle(reply,{...e,text:'l'});assert.equal(out.at(-1).t,'관리 권한이 없습니다.');
 await w.handle(reply,{...e,userId:'9000',text:'l'});assert.match(out.at(-1).t,/테스트/);assert.equal(timers[0].ms,10000);
 const view=String(8000+out.length);await timers[0].fn();assert.deepEqual(edits,[['1000',view,'삭제 메세지 확인 종료']]);
 const n=out.length;await w.onDelete(del);assert.equal(out.length,n);w.close();
});

test('rewrite push uses shared cache, independent settings, exact room and actor, suppresses duplicates and edits after 10 seconds',async()=>{
 const out=[],edits=[],timers=[],room={id:'1000',isOpenChat:true};
 const send=async(r,t,o)=>{out.push({r,t,o});return {status:0,body:{logId:String(8000+out.length)}};};
 const w=createDeleteWatch({botId:()=> '9000',send,edit:async(...a)=>{edits.push(a);return {status:0};},canManage:e=>e.userId==='9000',delay:(fn,ms)=>timers.push({fn,ms})});
 try{
  const core=createCore({send});w.register(core);
  await core.handle({text:'-수정감지 on',roomId:'1000',userId:'9000',msg:{room}});
  w.observe({room,sender:{name:'회원'},message:{logId:'5000',type:1}},{roomId:'1000',userId:'3000',text:'이전'});
  const push={method:'SYNCREWR',body:{chatId:'1000',logId:'5000',authorId:'3000',msg:'현재',type:1}};
  assert.equal(await w.onRewrite({...push,body:{...push.body,authorId:'5000'}}),false);
  assert.equal(await w.onRewrite(push),true);assert.match(out.at(-1).t,/@회원님이 메세지를 수정하셨습니다/);assert.doesNotMatch(out.at(-1).t,/이전|현재/);
  assert.equal(await w.onRewrite(push),false);const notice=String(8000+out.length);
  const reply={room,message:{type:26,attachment:{src_userId:'9000',src_logId:notice}}};
  await w.handle(reply,{roomId:'1000',userId:'9000',text:'l'});assert.match(out.at(-1).t,/수정 전 : 이전\n수정 후 : 현재/);
  const view=String(8000+out.length);assert.equal(timers[0].ms,10000);await timers[0].fn();assert.deepEqual(edits,[['1000',view,'수정 메세지 확인 종료']]);
 }finally{w.close();}
});

test('same-log changed message delivery detects edits without treating it as a new command',async()=>{
 const out=[],room={id:'1000',isOpenChat:true},send=async(r,t)=>{out.push(t);return {status:0,body:{logId:'8100'}};};
 const w=createDeleteWatch({botId:()=> '9000',send,logger:{log(){},error(){}}});
 try{const core=createCore({send});w.register(core);
 await core.handle({text:'-수정감지 on',roomId:'1000',userId:'9000',msg:{room}});
 const msg={room,sender:{name:'회원'},message:{logId:'5000',type:1}},e={roomId:'1000',userId:'3000',text:'처음'};
 w.observe(msg,e);assert.equal(w.observe(msg,{...e,text:'변경'}),true);
 await new Promise(resolve=>setImmediate(resolve));assert.match(out.at(-1),/@회원님이 메세지를 수정하셨습니다/);
 const n=out.length;assert.equal(w.observe(msg,{...e,text:'변경'}),true);assert.equal(out.length,n);
 }finally{w.close();}
});

test('SYNCMODMSG edit feed targets modifiedChatLog and ignores non-edit feeds',async()=>{
 const room={id:'1000',isOpenChat:true},out=[];
 const send=async(r,t,o)=>{out.push({r,t,o});return {status:0,body:{logId:'8888'}};};
 const w=createDeleteWatch({botId:()=> '9000',send,canManage:()=>true});
 try{
  const core=createCore({send});w.register(core);
  await core.handle({text:'-수정감지 on',roomId:'1000',userId:'9000',msg:{room}});
  w.observe({room,sender:{name:'회원'},message:{logId:'5000',type:1}},{roomId:'1000',userId:'3000',text:'이전'});
  const push={method:'SYNCMODMSG',body:{chatId:'1000',chatLog:{logId:'6000',authorId:'3000',type:0,message:'{"feedType":25,"logId":5000,"targetRevision":1}'},modifiedChatLog:{logId:'5000',authorId:'3000',type:1,revision:1,message:'현재'}}};
  assert.equal(await w.onRewrite({...push,body:{...push.body,chatLog:{...push.body.chatLog,message:'{"feedType":14,"logId":5000,"targetRevision":1}'}}}),false);
  assert.equal(await w.onRewrite({...push,body:{...push.body,modifiedChatLog:{...push.body.modifiedChatLog,logId:'5001'}}}),false);
  assert.equal(await w.onRewrite(push),true);assert.match(out.at(-1).t,/@회원님이 메세지를 수정하셨습니다/);assert.equal(await w.onRewrite(push),false);
 }finally{w.close();}
});
