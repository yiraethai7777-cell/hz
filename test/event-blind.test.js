'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const event=require('../shared/event-reaction-test');
const {attachRouter}=require('../shared/router');

let nextRoom=710000;
function setup(){
 const roomId=String(++nextRoom),target='9007199254740993123';
 const blinds=[],outputs=[],downstream=[];
 let dispatch;
 const client={
  userId:'999',connected:true,
  onMessage(fn){dispatch=fn;},
  getCachedMemberProfiles:async()=>[{id:target,name:'APEX 참가자'}],
  chat:{
   mention:(id,name)=>'\u0002'+id+'\u0003'+name+'\u0004',
   sendText:async(_room,body)=>{outputs.push(String(body));return{status:0,body:{logId:'800'}};},
   openChatBlind:async(...args)=>{blinds.push(args);return {status:0};}
  }
 };
 attachRouter(client,{ready:Promise.resolve(),game:{message:async c=>downstream.push(c.text)},
  management:{message:async()=>false}});
 const message=(senderId,text,logId='77',senderType=2,overrides={})=>({
  room:{id:roomId,isOpenChat:true,openLinkId:'777'},
  sender:{id:senderId,name:'참가자',type:senderType},
  message:{text,logId},
  text,...overrides
 });
 const host=(command,logId='100')=>message('5',command,logId,1);
 return {roomId,target,client,outputs,blinds,downstream,
  message,host,dispatch:(msg)=>dispatch(msg)};
}
async function waitFor(predicate){
 for(let i=0;i<70;i++){
  if(predicate())return;
  await new Promise(resolve=>setImmediate(resolve));
 }
 throw Error('event did not reach the expected phase');
}

test('live event blinds off-turn messages using the original MessageEvent and never reports',async()=>{
 const t=setup(),task=t.dispatch(t.host('!이벤트시작'));
 await waitFor(()=>t.outputs.includes('⏳ 5'));
 const outside=t.message('22222','안녕하세요','9007199254740993222');
 await t.dispatch(outside);
 assert.equal(t.blinds.length,1);
 assert.equal(t.blinds[0][0],t.roomId);
 assert.equal(t.blinds[0][1],outside);
 assert.deepEqual(t.blinds[0][2],{report:false});
 assert.ok(!t.downstream.includes('안녕하세요'));

 // Selected participant is never blinded and can win.
 await t.dispatch(t.message(t.target,'당첨 도전','9007199254740993223'));
 await task;
 assert.match(t.outputs.at(-1),/반응 성공/);
 assert.equal(t.blinds.length,1);
 // No more blinding after the winner is declared.
 await t.dispatch(t.message('22222','이벤트 후 일반 대화','9007199254740993224'));
 assert.equal(t.blinds.length,1);
});

test('host event controls and bot messages remain visible, but host small talk is blinded',async()=>{
 const t=setup(),task=t.dispatch(t.host('!이벤트시작'));
 await waitFor(()=>t.outputs.includes('⏳ 5'));
 await t.dispatch(t.message('999','⏳ 4','300',4));
  assert.equal(event.shouldBlind({roomId:t.roomId,senderId:'5',
  msg:t.host('!이벤트중지'),text:'!이벤트중지'}),false);
 const talk=t.message('5','이벤트 잠깐만','302',1);
 await t.dispatch(talk);
 assert.equal(t.blinds.length,1);
 assert.equal(t.blinds[0][1],talk);
 // The host can still stop an event after a hidden ordinary message.
 await t.dispatch(t.host('!이벤트중지','303'));
 await task;
 assert.ok(t.outputs.some(text=>text.includes('이벤트가 중지되었습니다.')));
 assert.equal(t.blinds.length,1);
 await t.dispatch(t.message('22222','중지 후 대화','304'));
 assert.equal(t.blinds.length,1);
});

test('invalid or missing log IDs are not passed to BLIND',async()=>{
 const t=setup(),task=t.dispatch(t.host('!이벤트시작'));
 await waitFor(()=>t.outputs.includes('⏳ 5'));
 assert.equal(event.shouldBlind({roomId:t.roomId,senderId:'22222',
  text:'안녕',msg:t.message('22222','안녕',null)}),false);
 await t.dispatch(t.message('22222','사진',null));
 assert.equal(t.blinds.length,0);
 await t.dispatch(t.host('!이벤트중지'));
 await task;
 assert.ok(t.outputs.some(text=>text.includes('이벤트가 중지되었습니다.')));
});

test('event test mode never blinds unrelated participant messages',async()=>{
 const t=setup();
 let resolveSleep;
 const run=event.start({
  client:t.client,roomId:t.roomId,msg:t.host('!이벤진행테스트'),
  send:async s=>t.outputs.push(s),
  mention:(id,name)=>t.client.chat.mention(id,name,t.roomId),
  sleep:()=>new Promise(r=>{resolveSleep=r}),
  loadSettings:async()=>require('../shared/event-settings').DEFAULTS
 });
 await waitFor(()=>t.outputs.includes('⏳ 5'));
 const off=t.message('22222','테스트 참가자 대화','309');
 assert.equal(event.shouldBlind({roomId:t.roomId,senderId:'22222',text:'테스트 참가자 대화',msg:off}),false);
 await t.dispatch(off);
 assert.equal(t.blinds.length,0);
 // Complete the test via the selected member's response.
 event.receive({roomId:t.roomId,senderId:t.target,text:'안녕하세요'});
 resolveSleep?.();
 await run;
});
