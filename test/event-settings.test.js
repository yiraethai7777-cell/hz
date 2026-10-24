'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const settings=require('../shared/event-settings');

class FakePool {
  constructor(){this.rows=new Map();this.queries=[];}
  async query(sql,params=[]) {
    this.queries.push({sql,params});
    if(sql.startsWith('CREATE TABLE'))return {rows:[]};
    const id=String(params[0]??'');
    if(sql.startsWith('SELECT'))return {rows:this.rows.has(id)?[this.rows.get(id)]:[]};
    if(sql.startsWith('INSERT')) {
      const row=this.rows.get(id)||{
        speed_ms:35,announcement:'',win_message:'',early_message:'',timeout_message:''
      };
      const match=sql.match(/\(room_id,([a-z_]+)\)/);
      if(match)row[match[1]]=params[1];
      this.rows.set(id,row);
      return {rows:[]};
    }
    if(sql.startsWith('UPDATE')) {
      const col=sql.match(/SET ([a-z_]+)=\$2/)[1];
      this.rows.get(id)[col]=params[1];
      return {rows:[]};
    }
    throw Error('Unexpected query: '+sql);
  }
}

test('event settings persist per-room custom texts and speed in database',async()=>{
  const pool=new FakePool(),a='18495931541358610',b='18495931541358611';
  await settings.save(a,'speedMs','650',{pool});
  await settings.save(a,'winMessage','🎉 {멘션}님 축하! 모두 {인원}명!',{pool});
  await settings.save(a,'announcement','🔥 이벤트 공지\n참여해주세요!',{pool});
  const loaded=await settings.load(a,{pool});
  assert.equal(loaded.speedMs,650);
  assert.match(loaded.winMessage,/축하!/);
  assert.match(loaded.announcement,/이벤트 공지\n/);
  const other=await settings.load(b,{pool});
  assert.equal(other.speedMs,35);
  assert.equal(other.announcement,'');
  assert.equal(pool.queries.filter(q=>q.sql.startsWith('CREATE TABLE')).length,1);
});

test('speed validates bounds and templates sanitize hidden mention controls',()=>{
  assert.equal(settings.checkSpeed(35),35);
  assert.equal(settings.checkSpeed('10000'),10000);
  assert.throws(()=>settings.checkSpeed(10),/35~10000/);
  assert.throws(()=>settings.checkSpeed('fast'),/숫자/);
  assert.equal(settings.cleanText('\u0002test\u0003\nhello\u0004'),'test\nhello');
  assert.throws(()=>settings.cleanText('x'.repeat(1001)),/최대/);
});

test('winner text substitutes placeholders and mentions even when placeholder missing',()=>{
  const marker='\u00029007199254740993123\u0003APEX 님\u0004';
  const args={name:'APEX 님',mention:marker,count:9};
  const withMarker=settings.render('{멘션}: {닉네임} / {인원}명',args,true);
  assert.ok(withMarker.includes(marker));
  assert.match(withMarker,/9명/);
  assert.equal(withMarker.split(marker).length,2);
  const without=settings.render('당첨자 {닉네임} 축하!',args,true);
  assert.ok(without.startsWith(marker+'\n'));
});

test('event settings reset returns original defaults',async()=>{
  const pool=new FakePool(),room='12345';
  await settings.save(room,'winMessage','변경 문구',{pool});
  await settings.reset(room,'winMessage',{pool});
  const config=await settings.load(room,{pool});
  assert.equal(config.winMessage,settings.DEFAULTS.winMessage);
});

function command(overrides={}) {
  const sent=[],calls=[],row={...settings.DEFAULTS};
  const store={
    load:async()=>({...row}),
    save:async(_room,field,value)=>{
      calls.push({field,value});row[field]=value;return value;
    },
    reset:async(_room,field)=>{row[field]=settings.DEFAULTS[field];}
  };
  return {sent,calls,row,args:{
    roomId:'12345',msg:{room:{isOpenChat:true},sender:{type:1}},client:{connected:true},
    send:async message=>sent.push(message),store,...overrides}};
}

test('only room owner or co-manager may change event settings',async()=>{
  const ctx=command({text:'!이벤당첨문구 유저 축하',
    msg:{room:{isOpenChat:true},sender:{type:2}}});
  assert.equal(await settings.handle(ctx.args),true);
  assert.equal(ctx.calls.length,0);
  assert.match(ctx.sent[0],/방장 또는 부방장/);
});

test('event commands save multiline notice and expose settings',async()=>{
  const ctx=command();
  assert.equal(await settings.handle({...ctx.args,text:'!이벤공지작성 오늘 9시 시작\n응원해주세요'}),true);
  assert.equal(ctx.calls[0].field,'announcement');
  assert.match(ctx.row.announcement,/응원해주세요/);
  await settings.handle({...ctx.args,text:'!이벤공지'});
  assert.match(ctx.sent.at(-1),/오늘 9시/);
  await settings.handle({...ctx.args,text:'!이벤설정'});
  assert.match(ctx.sent.at(-1),/!이벤당첨문구/);
});

test('event speed and early/timeout/custom winner controls are recognized',async()=>{
  const ctx=command();
  for(const [cmd,field] of [
    ['!이벤속도 700','speedMs'],
    ['!이벤당첨문구 {멘션} 당첨!','winMessage'],
    ['!이벤탈락문구 너무 빨랐어요','earlyMessage'],
    ['!이벤시간초과문구 늦었어요','timeoutMessage']
  ])await settings.handle({...ctx.args,text:cmd});
  assert.deepEqual(ctx.calls.map(c=>c.field),['speedMs','winMessage','earlyMessage','timeoutMessage']);
});
