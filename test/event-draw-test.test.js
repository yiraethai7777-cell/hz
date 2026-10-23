'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {handle,getCandidates,isApex} = require('../shared/event-draw-test');

const marker=(id,name)=>'\u0002'+String(id)+'\u0003'+name+'\u0004';
let counter=100;
function context(overrides={}) {
  const roomId=String(++counter);
  const sent=[], called=[];
  const client={
    connected:true,userId:'999',
    getCachedMemberProfiles:async()=>[
      {id:'9007199254740993123',name:'𒊮𝐀𝐏𝐄𝐗 정 ᯽'},
      {id:'222',name:'APEX 두번째'},
      {id:'333',name:'일반'},
      {id:'999',name:'APEX 봇'}
    ],
    refreshMemberProfiles:async()=>{throw Error('Must not request MEMLIST')},
    _carriage:{memList:()=>{throw Error('Must not query MEMLIST')},chatOnRoom:()=>{throw Error('Must not query CHATONROOM')}}
  };
  return {roomId,client,msg:{room:{isOpenChat:true},sender:{type:1}},
    send:async body=>{sent.push(body)},
    mention:(id,name)=>{called.push({id,name});return marker(id,name)},
    pickRandom:()=>0,now:()=>100000,
    sent,called,...overrides};
}

test('APEX filter handles stylized Unicode and excludes bot, non-APEX and duplicates',()=>{
  assert.equal(isApex('𒊮𝐀𝐏𝐄𝐗 정 ᯽'),true);
  assert.equal(isApex(' A P E X '),true);
  assert.equal(isApex('일반 사용자'),false);
  const candidates=getCandidates([
    {id:'101',name:'APEX'}, {id:'101',name:'APEX 중복'},
    {id:'999',name:'APEX 봇'}, {id:'102',name:'일반'},
    {id:'9007199254740993123',name:'𝐀𝐏𝐄𝐗 회원'}
  ],'999');
  assert.deepEqual(candidates.map(x=>x.id),['101','9007199254740993123']);
});

test('test command selects one candidate and sends exactly one real mention marker',async()=>{
  const ctx=context();
  await handle(ctx);
  assert.equal(ctx.sent.length,1);
  assert.equal(ctx.called.length,1);
  assert.equal(ctx.called[0].id,'9007199254740993123');
  assert.match(ctx.sent[0],/APEX 랜덤 추첨·멘션 테스트/);
  assert.ok(ctx.sent[0].includes(marker('9007199254740993123','𒊮𝐀𝐏𝐄𝐗 정 ᯽')));
  assert.match(ctx.sent[0],/실제 당첨·보상은 없습니다/);
});

test('selected APEX candidate follows injected random index',async()=>{
  const ctx=context({pickRandom:n=>n-1});
  await handle(ctx);
  assert.equal(ctx.called.length,1);
  assert.equal(ctx.called[0].id,'222');
});

test('event draw rejects non-admin or normal chat',async()=>{
  const a=context({msg:{room:{isOpenChat:false},sender:{type:1}}});
  await handle(a);assert.match(a.sent[0],/오픈채팅방/);assert.equal(a.called.length,0);
  const b=context({msg:{room:{isOpenChat:true},sender:{type:2}}});
  await handle(b);assert.match(b.sent[0],/방장 또는 부방장/);assert.equal(b.called.length,0);
});

test('event draw reports no candidates without mentioning anyone',async()=>{
  const ctx=context();
  ctx.client.getCachedMemberProfiles=()=>[{id:'321',name:'일반'}];
  await handle(ctx);assert.match(ctx.sent[0],/캐시에 없습니다/);assert.equal(ctx.called.length,0);
});

test('event draw blocks rapid repeated mention attempts',async()=>{
  const ctx=context();
  await handle(ctx);await handle(ctx);
  assert.equal(ctx.called.length,1);
  assert.equal(ctx.sent.length,2);
  assert.match(ctx.sent[1],/60초 간격/);
});

test('event draw rejects invalid marker rather than plain-text fake mention',async()=>{
  const ctx=context({mention:()=> '@APEX'});
  await handle(ctx);assert.equal(ctx.sent.length,1);
  assert.match(ctx.sent[0],/실패했습니다/);
});

test('event draw handles disconnected message transport without throwing',async()=>{
  const ctx=context();ctx.send=async()=>{ctx.client.connected=false;throw Error('Connection closed')};
  await assert.doesNotReject(handle(ctx));
});

test('router forwards event draw command through client.chat.mention',async()=>{
  const {attachRouter}=require('../shared/router');
  let dispatch;
  const sent=[];
  const mentionCalls=[];
  const client={
    userId:'999',connected:true,
    onMessage:cb=>{dispatch=cb},
    getCachedMemberProfiles:async()=>[{id:'9007199254740993123',name:'𝐀𝐏𝐄𝐗 테스트'}],
    chat:{
      mention:(id,name,roomId)=>{
        mentionCalls.push({id,name,roomId});
        return marker(id,name);
      },
      sendText:async(roomId,body)=>sent.push({roomId,body})
    }
  };
  attachRouter(client,{game:{},management:{},ready:Promise.resolve()});
  await dispatch({room:{id:'777777',isOpenChat:true},sender:{id:'101',type:1},text:'#이벤추첨테스트'});
  assert.equal(mentionCalls.length,1);
  assert.equal(mentionCalls[0].id,'9007199254740993123');
  assert.equal(String(mentionCalls[0].roomId),'777777');
  assert.equal(sent.length,1);
  assert.ok(sent[0].body.includes(marker('9007199254740993123','𝐀𝐏𝐄𝐗 테스트')));
});

test('KakaoForge mention marker encodes a real mention payload',()=>{
  require('ts-node/register/transpile-only');
  const {extractMarkedMentions,normalizeMentionInputs}=require('../src/utils/mention');
  const msg='추첨: '+marker('9007199254740993123','𝐀𝐏𝐄𝐗 테스트');
  const extracted=extractMarkedMentions(msg);
  assert.equal(extracted.text,'추첨: @𝐀𝐏𝐄𝐗 테스트');
  assert.equal(extracted.mentions.length,1);
  const extra=normalizeMentionInputs(extracted.text,extracted.mentions);
  assert.equal(extra.length,1);
  assert.equal(String(extra[0].user_id),'9007199254740993123');
});
