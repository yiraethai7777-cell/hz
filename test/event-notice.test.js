'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const notice=require('../shared/event-notice');

const roomId='18495931541358610';

test('manual event notice registration and status handlers are retired',()=>{
  assert.equal(Object.hasOwn(notice,'handle'),false);
});

test('scheduled real notice requires a real registration adapter',async()=>{
  const result=await notice.register({client:{},roomId,body:'공지 테스트',adapter:null});
  assert.deepEqual(result,{registered:false,reason:'unsupported'});
});

test('scheduled notice calls a verified registration adapter, not chat.sendText',async()=>{
  const calls=[];
  const result=await notice.register({client:{chat:{sendText:()=>{throw Error('unexpected ordinary chat');}}},
    roomId,body:'예약 공지',adapter:{
      register:async payload=>{calls.push(payload);return {registered:true,status:0,postId:'post-123'};}
    }});
  assert.deepEqual(calls,[{roomId,text:'예약 공지'}]);
  assert.deepEqual(result,{registered:true,postId:'post-123'});
});

test('ambiguous adapter response is not reported as successful notice',async()=>{
  const result=await notice.register({client:{},roomId,body:'확인 필요',
    adapter:{register:async()=>({status:0})}});
  assert.deepEqual(result,{registered:false,reason:'unconfirmed'});
});

test('an empty scheduled notice is rejected',async()=>{
  await assert.rejects(notice.register({client:{},roomId,body:' ',
    adapter:{register:async()=>{throw Error('should not register');}},
    loadSettings:async()=>({announcement:''})}),/공지 내용을/);
});

test('register uses a per-room lock to avoid duplicate submissions',async()=>{
  let release;
  let calls=0;
  const adapter={
    register:async()=>{calls++;await new Promise(resolve=>{release=resolve});return {registered:true};}
  };
  const first=notice.register({client:{},roomId,body:'첫 공지',adapter});
  await Promise.resolve();
  const second=await notice.register({client:{},roomId,body:'중복 공지',adapter});
  assert.deepEqual(second,{registered:false,reason:'busy'});
  assert.equal(calls,1);
  release();
  assert.equal((await first).registered,true);
});

test('message-to-notice adapter uses real KakaoForge response.body.logId',async()=>{
  const called=[];
  const adapter=notice.createMessageNoticeAdapter({
    sendText:async(room,text)=>{called.push({kind:'send',room,text});return {
      status:0,body:{logId:'9007199254740993123'}
    };},
    setNotice:async args=>{called.push({kind:'notice',...args});return {
      registered:true,status:0,postId:'post-123'
    };}
  });
  const res=await adapter.register({roomId,text:'오늘 이벤트 공지'});
  assert.deepEqual(called,[
    {kind:'send',room:roomId,text:'오늘 이벤트 공지'},
    {kind:'notice',roomId,logId:'9007199254740993123'}
  ]);
  assert.deepEqual(res,{registered:true,postId:'post-123'});
});

test('message-to-notice adapter stops if WRITE returned no valid logId',async()=>{
  let posted=false;
  const adapter=notice.createMessageNoticeAdapter({
    sendText:async()=>({status:0,result:{logId:'77'}}),
    setNotice:async()=>{posted=true;return {registered:true};}
  });
  await assert.rejects(adapter.register({roomId,text:'안내'}),/logId/);
  assert.equal(posted,false);
});

test('notice method without verified completion is not reported as registered',async()=>{
  const adapter=notice.createMessageNoticeAdapter({
    sendText:async()=>({status:0,body:{logId:'9007199254740993123'}}),
    setNotice:async()=>({status:0})
  });
  const result=await adapter.register({roomId,text:'공지'});
  assert.deepEqual(result,{registered:false});
});
