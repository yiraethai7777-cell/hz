'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const notices=require('../manage/scheduled-notices');

test('accepts valid clock and rejects malformed 24-hour HH:MM',()=>{
  assert.deepEqual(notices.parseTime('00:00'),{hour:0,minute:0});
  assert.deepEqual(notices.parseTime('23:59'),{hour:23,minute:59});
  for(const invalid of ['24:00','12:60','7:00','18:3','18:30:00']){
    assert.throws(()=>notices.parseTime(invalid),/HH:MM/);
  }
});
test('schedules the next occurrence using Seoul UTC+09:00 time',()=>{
  const now=Date.parse('2026-10-24T08:15:00Z'); // 17:15 KST
  assert.equal(notices.nextOccurrence('18:30',now).toISOString(),'2026-10-24T09:30:00.000Z');
  assert.equal(notices.nextOccurrence('17:00',now).toISOString(),'2026-10-25T08:00:00.000Z');
  assert.equal(notices.nextOccurrence('00:00',Date.parse('2026-10-24T14:59:00Z')).toISOString(),
    '2026-10-24T15:00:00.000Z');
});
test('sanitizes notice text and formats numbered listings',()=>{
  assert.throws(()=>notices.cleanContent('  '),/공지 내용/);
  assert.throws(()=>notices.cleanContent('A'.repeat(2001)),/2000/);
  assert.equal(notices.cleanContent(' 모임 시작 '),'모임 시작');
  assert.match(notices.formatList([{notice_no:2,scheduled_at:'2026-10-24T09:30:00Z',content:'모임 시작',state:'pending'}]),/#2 ┃ 2026.10.24 18:30/);
});
test('inserts stable room-specific number and timestamp in one transaction',async()=>{
  const calls=[];
  const connection={
    query:async(sql,args)=>{
      calls.push({sql,args});
      if(sql.includes('SELECT COUNT(*)'))return {rows:[{count:0}]};
      if(sql.includes('INSERT INTO hz_notice_counters'))return {rows:[{last_no:3}]};
      return {rows:[],rowCount:0};
    },
    release:()=>calls.push({sql:'RELEASE'})
  };
  const db={
    query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};},
    connect:async()=>connection
  };
  const result=await notices.schedule(db,{
    roomId:'1234',userId:'4444',time:'18:30',content:'테스트 공지',
    now:Date.parse('2026-10-24T08:00:00Z')
  });
  assert.equal(result.noticeNo,3);
  assert.equal(result.scheduledAt.toISOString(),'2026-10-24T09:30:00.000Z');
  assert.ok(calls.some(x=>x.sql==='BEGIN'));
  assert.ok(calls.some(x=>x.sql==='COMMIT'));
  const write=calls.find(x=>x.sql.includes('INSERT INTO hz_scheduled_notices('));
  assert.deepEqual(write.args.slice(0,3),['1234',3,'4444']);
});
test('posts a real verified room notice without sending plain Kakao chat',async()=>{
  const calls=[],posted=[],plainChats=[];
  const due={room_id:'1234',notice_no:3,content:'저녁 모임',open_link_id:'55555',attempts:1};
  const db={query:async(sql,args)=>{
    calls.push({sql,args});
    return sql.includes('WITH due AS')?{rows:[due]}:{rows:[],rowCount:0};
  }};
  const count=await notices.tick({
    db,client:{connected:true,chat:{sendText:async(...args)=>plainChats.push(args)}},
    adapter:{register:async args=>{
      posted.push(args);return {registered:true,status:0,postId:'post-123'};
    }},
    logger:{info:()=>{},error:()=>{}}
  });
  assert.equal(count,1);
  assert.deepEqual(posted,[{roomId:'1234',text:'저녁 모임'}]);
  assert.equal(plainChats.length,0);
  assert.ok(calls.some(x=>x.sql.includes("SET state='sent'")&&x.args.includes('post-123')));
});

test('unverified real room notice never falls back to a plain Kakao chat',async()=>{
  const calls=[],plainChats=[];
  const due={room_id:'1234',notice_no:5,content:'모임 안내',open_link_id:'55555',attempts:1};
  const db={query:async(sql,args)=>{
    calls.push({sql,args});
    return sql.includes('WITH due AS')?{rows:[due]}:{rows:[],rowCount:0};
  }};
  await notices.tick({
    db,client:{connected:true,chat:{sendText:async(...args)=>plainChats.push(args)}},
    adapter:{register:async()=>({registered:false,status:0})},
    logger:{info:()=>{},error:()=>{}}
  });
  assert.equal(plainChats.length,0);
  assert.ok(calls.some(x=>x.sql.includes("SET state='failed'")&&x.args.some(a=>String(a).includes('확인 필요'))));
  assert.ok(!calls.some(x=>x.sql.includes('next_attempt_at=NOW()')));
});

test('reservation refuses an unavailable real room notice integration',()=>{
  assert.throws(()=>notices.noticeCapability({connected:true},'1234','5678'),/실제 채팅방 공지 등록 연동/);
});

test('does not transmit while Kakao client is disconnected',async()=>{
  let calls=0;
  const n=await notices.tick({db:{query:async()=>{calls++;return {rows:[]};}},
    client:{connected:false},logger:{info:()=>{},error:()=>{}}});
  assert.equal(n,0);
  assert.equal(calls,0);
});
