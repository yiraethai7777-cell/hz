'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCore}=require('../core'),{createDeleteWatch}=require('../manage/delete-watch');
test('delete watch is opt-in, room scoped, admin reply only and edits same log after 2s',async()=>{
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
 await w.handle(reply,{...e,userId:'9000',text:'l'});assert.match(out.at(-1).t,/테스트/);assert.equal(timers[0].ms,2000);
 const view=String(8000+out.length);await timers[0].fn();assert.deepEqual(edits,[['1000',view,'삭제 메세지 확인 종료']]);
 const n=out.length;await w.onDelete(del);assert.equal(out.length,n);w.close();
});
