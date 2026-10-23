'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const api=require('../shared/event-board-api');
const session={
  connected:true,oauthToken:'test-token-redacted',deviceUuid:'test-uuid',
  deviceId:'test-derived-id',appVer:'26.1.2',lang:'ko',
  _chatRooms:new Map([['18495931541358610',{openLinkId:'9007199254740993999'}]])
};
const room='18495931541358610';
const link='9007199254740993999';

test('legacy board API builds a text post and verifies notice with GET',async()=>{
  const calls=[];
  const responses=[
    {status:0,id:'post-123'},
    {status:0},
    {status:0,id:'post-123',notice:true}
  ];
  const adapter=api.createBoardAdapter(session,{
    transport:async req=>{
      calls.push(req);
      return responses.shift();
    }
  });
  const result=await adapter.register({roomId:room,text:'APEX 공지 테스트'});
  assert.deepEqual(result,{registered:true,status:0,postId:'post-123'});
  assert.deepEqual(calls.map(c=>[c.method,c.path]),[
    ['POST','/moim/chats/'+room+'/posts?link_id='+link],
    ['POST','/moim/posts/post-123/set_notice?link_id='+link],
    ['GET','/moim/posts/post-123?link_id='+link]
  ]);
  assert.equal(calls[0].form.object_type,'TEXT');
  assert.equal(calls[0].form.notice,'false');
  assert.deepEqual(JSON.parse(calls[0].form.content),[
    {type:'text',text:'APEX 공지 테스트'}
  ]);
  assert.equal(calls[0].headers.Authorization,'test-token-redacted-test-uuid');
  assert.equal(calls[0].headers.A,'android/26.1.2/ko');
  assert.equal(calls[0].headers['User-Agent'],'KT/26.1.2 An/12 ko');
});

test('board notice uses exact 64-bit id strings without precision loss',()=>{
  assert.equal(api.getLinkId(session,room),link);
  assert.equal(api.postIdOf({status:0,post:{id:'9007199254740993123'}}),'9007199254740993123');
});

test('auth headers never fallback to unauthenticated requests',()=>{
  assert.throws(()=>api.buildSessionHeaders({oauthToken:'',deviceUuid:'uuid'}),/로그인 토큰/);
  assert.throws(()=>api.getLinkId(session,room,'abc'),/링크 ID/);
});

test('no set_notice request after create failure',async()=>{
  const calls=[];
  const adapter=api.createBoardAdapter(session,{transport:async r=>{
    calls.push(r);return {status:-4031,error_message:'no permission'};
  }});
  await assert.rejects(adapter.register({roomId:room,text:'TEST'}),/포스트 생성 거부/);
  assert.equal(calls.length,1);
});

test('set_notice rejection reports post remains, does not claim success',async()=>{
  const calls=[];
  const adapter=api.createBoardAdapter(session,{transport:async r=>{
    calls.push(r);
    return calls.length===1?{status:0,id:'existing-post'}:{status:-4031};
  }});
  await assert.rejects(adapter.register({roomId:room,text:'테스트'}),/포스트 existing-post/);
  assert.equal(calls.length,2);
});

test('set_notice response alone is not treated as proof of pinning',async()=>{
  let n=0;
  const adapter=api.createBoardAdapter(session,{transport:async()=>{
    n++;
    if(n===1)return {status:0,id:'id123'};
    if(n===2)return {status:0};
    return {status:0,notice:false};
  }});
  await assert.rejects(adapter.register({roomId:room,text:'테스트'}),/검증하지 못했습니다/);
  assert.equal(n,3);
});

test('transport restricts host and paths before network request',async()=>{
  await assert.rejects(api.defaultTransport({
    method:'POST',path:'/remote/host',headers:{}
  }),/허용되지 않은/);
});

test('invalid post IDs do not make calls to register as notice',async()=>{
  let count=0;
  const adapter=api.createBoardAdapter(session,{transport:async()=>{
    count++;return {status:0,result:{logId:'123'}};
  }});
  await assert.rejects(adapter.register({roomId:room,text:'test'}),/postId/);
  assert.equal(count,1);
});

test('a verified custom adapter may replace the legacy implementation',()=>{
  const notice=require('../shared/event-notice');
  const specific={register:async()=>({registered:true})};
  const other={oauthToken:'token',deviceUuid:'uuid',roomNoticeAdapter:specific};
  assert.equal(notice.capability(other),specific);
});
