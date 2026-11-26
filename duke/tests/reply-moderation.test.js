'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createReplyModeration}=require('../manage/reply-moderation'),{createCore}=require('../core');
test('only authentic same-room replies by staff; k and u once, exact target',async()=>{
 const out=[],actions=[];let seq=100;const send=async(r,t)=>{out.push(t);return {status:0,body:{logId:String(++seq)}};};
 const m=createReplyModeration({botId:()=> '10',send,kick:async(r,u)=>{actions.push(['k',r,u]);return {status:0};},unban:async(r,u)=>{actions.push(['u',r,u]);return {success:true,verified:true};}});
 const core=createCore({send});m.register(core);m.recordLeave({roomId:'1',userId:'18500479612113742',name:'회원',result:{body:{logId:'99'}}});
 const msg=(log,type=4,author='10')=>({room:{isOpenChat:true},sender:{type},message:{type:26},attachmentsRaw:[{src_logId:log,src_userId:author}]});
 const e=(text,userId='20',roomId='1')=>({text,userId,roomId});
 assert.equal(await m.handle({},e('k')),false);
 assert.equal(await m.handle(msg('99',4,'11'),e('k')),false);
 assert.equal(await m.handle(msg('99'),e('k','20','2')),false);
 await m.handle(msg('99',2),e('k'));assert.equal(actions.length,0);
 await core.handle(e('-관리자추가 20','10'));
 await m.handle(msg('99',2),e('k'));assert.deepEqual(actions,[['k','1','18500479612113742']]);assert.match(out.at(-1),/답장으로 u/);
 const banLog=String(seq);await m.handle(msg('99'),e('k'));assert.equal(actions.length,1);
 await m.handle(msg(banLog),e('u'));assert.equal(actions.length,2);assert.match(out.at(-1),/벤을 해제/);
 await m.handle(msg(banLog),e('u'));assert.equal(actions.length,2);
});
test('API failure is not announced as success',async()=>{let out;const m=createReplyModeration({botId:()=> '10',send:async(r,t)=>{out=t;},kick:async()=>({status:1}),logger:{error(){}}});m.recordLeave({roomId:'1',userId:'30',name:'회원',result:{logId:'99'}});await m.handle({room:{isOpenChat:true},sender:{type:4},message:{type:26},attachmentsRaw:[{src_userId:'10',src_logId:'99'}]},{text:'k',userId:'20',roomId:'1'});assert.match(out,/실패 또는 결과 미확인/);});

test('direct ban and kick-release with IDs, mention, original reply chain; permissions and verified unban',async()=>{
 const out=[],actions=[];let seq=1000;const send=async(r,t)=>{out.push(t);return {status:0,body:{logId:String(++seq)}};};
 const original={room:{id:'1000'},message:{type:1,logId:'2000'},sender:{id:'3000',name:'원문'}};
 const intermediate={room:{id:'1000'},message:{type:26,logId:'2001'},sender:{id:'4000'},attachmentsRaw:[{src_logId:'2000',src_userId:'3000'}]};
 const m=createReplyModeration({botId:()=> '9000',send,kick:async(r,u)=>{actions.push(['k',u]);return {status:0};},unban:async(r,u)=>{actions.push(['u',u]);return {success:true,verified:true};},fetchMessage:async(r,l)=>l==='2000'?original:l==='2001'?intermediate:null});
 const core=createCore({send});m.register(core);
 const msg=(type=4,extra={})=>({room:{isOpenChat:true},sender:{type},...extra});
 const run=(text,m=msg())=>core.handle({text,userId:'5000',roomId:'1000',msg:m});
 await run('-벤 3000',msg(2));assert.equal(actions.length,0);
 await run('-벤 3000');assert.deepEqual(actions,[['k','3000']]);assert.match(out.at(-1),/답장으로 u/);
 await run('-내풀',msg(4,{message:{type:26},attachmentsRaw:[{src_logId:'2001',src_userId:'4000'}]}));
 assert.deepEqual(actions.slice(1),[['k','3000'],['u','3000']]);assert.match(out.at(-1),/내보낸 후 벤을 해제/);
 await run('-벤 @회원',msg(4,{attachmentsRaw:[{mentions:[{userId:'6000'}]}]}));assert.deepEqual(actions.at(-1),['k','6000']);
 await run('-벤 9000');await run('-내풀 5000');assert.equal(actions.length,4);
 await run('-내풀',msg(4,{message:{type:26},attachmentsRaw:[{src_logId:'9999',src_userId:'3000'}]}));assert.equal(actions.length,4);
});
