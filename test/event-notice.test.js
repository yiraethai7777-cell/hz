'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const notice=require('../shared/event-notice');

const roomId='18495931541358610';
function fixture(overrides={}){
  const out=[];
  const args={
    client:{connected:true},
    roomId,
    msg:{room:{isOpenChat:true},sender:{type:1}},
    text:'#이벤공지등록',
    send:async text=>{out.push(text);return {body:{logId:'42'}};},
    loadSettings:async()=>({announcement:'APEX 이벤트 공지입니다.'}),
    ...overrides
  };
  return {args,out};
}

test('unknown Kakao notice protocol must not send a fake notice',async()=>{
  const {args,out}=fixture();
  assert.equal(await notice.handle(args),true);
  assert.match(out[0],/로그인 정보가 없거나 실험 기능이 꺼져/);
  assert.doesNotMatch(out[0],/✅/);
  assert.equal(out.length,1);
});

test('notice capability status is accurate',async()=>{
  const {args,out}=fixture({text:'#이벤공지상태'});
  await notice.handle(args);
  assert.match(out[0],/연동이 아직 없습니다/);
});

test('unprivileged chat member cannot register a real notice',async()=>{
  let called=false;
  const {args,out}=fixture({
    msg:{room:{isOpenChat:true},sender:{type:2}},
    adapter:{register:async()=>{called=true;return {registered:true};}}
  });
  await notice.handle(args);
  assert.equal(called,false);
  assert.match(out[0],/방장 또는 부방장/);
});

test('verified adapter receives persisted room announcement and reports success',async()=>{
  const calls=[];
  const {args,out}=fixture({adapter:{
    register:async payload=>{
      calls.push(payload);
      return {registered:true,status:0,postId:'123456789'};
    }
  }});
  await notice.handle(args);
  assert.deepEqual(calls,[{roomId,text:'APEX 이벤트 공지입니다.'}]);
  assert.match(out[0],/실제 공지 등록 확인/);
  assert.match(out[0],/123456789/);
});

test('command with text registers explicit content rather than stored notice',async()=>{
  const calls=[];
  const {args}=fixture({
    text:'#이벤공지등록 오늘부터 1시간 이벤트입니다.',
    adapter:{register:async data=>{calls.push(data);return {registered:true};}}
  });
  await notice.handle(args);
  assert.equal(calls[0].text,'오늘부터 1시간 이벤트입니다.');
});

test('adapter result without explicit confirmation never claims success',async()=>{
  const {args,out}=fixture({adapter:{register:async()=>({status:0})}});
  await notice.handle(args);
  assert.match(out[0],/등록이 확인되지 않았습니다/);
});

test('notice registration refuses invalid content',async()=>{
  const {args,out}=fixture({text:'#이벤공지등록',
    loadSettings:async()=>({announcement:''}),
    adapter:{register:async()=>{throw Error('should not be called');}}
  });
  await notice.handle(args);
  assert.match(out[0],/공지 내용을 먼저 작성/);
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

test('unrecognized command returns false',async()=>{
  const {args}=fixture({text:'#이벤진행테스트'});
  assert.equal(await notice.handle(args),false);
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
