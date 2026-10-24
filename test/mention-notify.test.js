'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const notifier=require('../manage/mention-notify');

test('absent-mention summary has name, time and sender but no room information',()=>{
  const body=notifier.formatNotification('바닐라',[
    {id:'1',sender_name:'헤이즈',sender_id:'1002',room_name:'APEX',
      created_at:'2026-10-24T05:12:00.000Z'}
  ]);
  assert.match(body,/^@바닐라님, 부재중 멘션이 1개 있었어요/);
  assert.match(body,/10\.24 14:12/);
  assert.match(body,/헤이즈/);
  assert.doesNotMatch(body,/채팅방|APEX/);
  assert.match(body,/┣━/);
  assert.match(body,/┗━/);
  assert.ok(body.includes('\u200b'.repeat(1200)));
  assert.ok(!body.includes('메시지 내용'));
});

test('records verified mention IDs only, once per message, without the message body',async()=>{
  const statements=[];
  const db={query:async(sql,args)=>{
    statements.push({sql,args});
    if(sql.startsWith('SELECT COALESCE'))return {rows:[{enabled:true}]};
    return {rows:[]};
  }};
  await notifier.observe({
    db,chat:{},roomId:'1234',senderId:'2222',senderName:'헤이즈',botId:'9999',
    msg:{room:{name:'APEX'},id:'12345',message:{text:'절대 저장하면 안 되는 본문'}},
    mentionTargets:[{id:'3333'},{id:'3333'},{id:'2222'},{id:'9999'}],
    send:async()=>{}
  });
  const inserts=statements.filter(v=>v.sql.startsWith('INSERT INTO hz_mention_alerts'));
  assert.equal(inserts.length,1);
  assert.deepEqual(inserts[0].args,['1234','3333','2222','헤이즈','12345']);
  assert.ok(!JSON.stringify(statements).includes('절대 저장하면 안 되는 본문'));
  assert.ok(!JSON.stringify(inserts).includes('APEX'));
});

test('does not accept plain @name text as verified mention',async()=>{
  const statements=[];
  const db={query:async(sql,args)=>{
    statements.push({sql,args});
    if(sql.startsWith('SELECT COALESCE'))return {rows:[{enabled:true}]};
    return {rows:[]};
  }};
  await notifier.observe({
    db,chat:{},roomId:'1234',senderId:'2222',senderName:'헤이즈',botId:'9999',
    msg:{room:{name:'APEX'},id:'12346',message:{text:'@바닐라'}},
    mentionTargets:[],send:async()=>{}
  });
  assert.equal(statements.filter(v=>v.sql.startsWith('INSERT INTO hz_mention_alerts')).length,0);
});
