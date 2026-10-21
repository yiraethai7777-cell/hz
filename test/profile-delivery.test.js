'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const delivery=require('../manage/profile-delivery');
async function fixture(run){
 const db=new PGlite();let failEnqueue=false;
 const query=async(sql,p)=>{
  if(failEnqueue&&sql.includes('INSERT INTO hz_profile_outbox'))throw Error('outbox unavailable');
  return p?.length?db.query(sql,p):(await db.exec(sql)).at(-1);
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const make=()=>{
  const ctx=require('../shared/runtime').createRuntime({pool,economyEnabled:false});
  ctx.globalBotId='9999';ctx.globalClient={connected:true};return ctx;
 };
 const ctx=make();
 try{
  await ctx.initDb();await query('INSERT INTO hz_rooms(room_id,data) VALUES($1,$2::jsonb)',['100',JSON.stringify({manage:true,players:{existing:{points:123}}})]);
  const observe=(name,url='photo',link='https://open.kakao.com/o/test')=>ctx.withRoom('100','',(_,c)=>ctx.profileObserve(c,'100','10001',name,url,link));
  await observe('old');
  await run({ctx,pool,query,make,observe,setFail:value=>{failEnqueue=value;}});
 }finally{await db.close();}
}

test('history, observation and outbox commit atomically; rollback preserves all old records',()=>fixture(async({query,observe,setFail})=>{
 setFail(true);await assert.rejects(observe('new'),/outbox unavailable/);setFail(false);
 assert.equal((await query('SELECT observed_profile_name FROM hz_members')).rows[0].observed_profile_name,'old');
 assert.equal((await query('SELECT * FROM hz_profiles')).rows.length,0);
 assert.equal((await query('SELECT * FROM hz_profile_outbox')).rows.length,0);
 await observe('new');await observe('new');
 assert.equal((await query('SELECT * FROM hz_profiles')).rows.length,1);
 assert.equal((await query('SELECT * FROM hz_profile_outbox')).rows.length,1);
 assert.equal((await query('SELECT data FROM hz_rooms')).rows[0].data.players.existing.points,123);
}));

test('committed queue survives runtime recreation and sends each acknowledged event once',()=>fixture(async({query,observe,make})=>{
 await observe('new');const restarted=make(),sent=[];
 restarted.globalChat={sendText:async(room,text,opts)=>{sent.push({room,text,opts});return {body:{logId:'9007199254740993123'}};}};
 await delivery.drain(restarted,'100');await delivery.drain(restarted,'100');
 assert.equal(sent.length,1);assert.equal(sent[0].room,'100');assert.ok(sent[0].text.length<=4500);
 const row=(await query('SELECT * FROM hz_profile_outbox')).rows[0];
 assert.equal(row.state,'sent');assert.equal(row.log_id,'9007199254740993123');assert.equal(sent[0].opts.msgId,row.client_msg_id);
}));

test('photo and link changes are labelled while signed URL rotation does not create false notices',()=>fixture(async({query,observe})=>{
 await observe('old','https://images.example/photo1?token=a');
 await observe('old','https://images.example/photo1?token=b');
 assert.equal((await query('SELECT * FROM hz_profile_outbox')).rows.length,1);
 await observe('old','https://images.example/photo2?token=c','https://open.kakao.com/o/changed');
 const rows=(await query('SELECT * FROM hz_profile_outbox ORDER BY profile_id')).rows;
 assert.equal(rows.length,2);assert.match(rows[1].body,/변경 항목: 프로필 사진 · 오픈프로필 링크/);
}));

test('timeout never blindly resends; only exact bot echo confirms the uncertain delivery',()=>fixture(async({ctx,pool,query,observe})=>{
 await observe('new');let sends=0;
 ctx.globalChat={sendText:async()=>{sends++;throw Error('Request WRITE timed out');}};
 await delivery.drain(ctx,'100');await delivery.drain(ctx,'100');assert.equal(sends,1);
 const row=(await query('SELECT * FROM hz_profile_outbox')).rows[0];assert.equal(row.state,'uncertain');
 const echo={room:{id:'100'},sender:{id:'9999'},message:{id:'9007199254740993123',text:row.body},raw:{chatLog:{msgId:row.client_msg_id}}};
 await delivery.confirm(pool,'9999',{...echo,sender:{id:'10001'}});
 await delivery.confirm(pool,'9999',{...echo,room:{id:'200'}});
 await delivery.confirm(pool,'9999',{...echo,message:{...echo.message,text:row.body+'spoof'}});
 assert.equal((await query('SELECT state FROM hz_profile_outbox')).rows[0].state,'uncertain');
 await delivery.confirm(pool,'9999',echo);
 assert.equal((await query('SELECT state FROM hz_profile_outbox')).rows[0].state,'sent');
 await delivery.drain(ctx,'100');assert.equal(sends,1);
}));

test('explicit server rejection retries with backoff and the same message ID',()=>fixture(async({ctx,query,observe})=>{
 await observe('new');const ids=[];
 ctx.globalChat={sendText:async(room,text,opts)=>{ids.push(opts.msgId);if(ids.length===1)throw Error('WRITE failed: status=-203');return {body:{logId:'12345'}};}};
 await delivery.drain(ctx,'100');await delivery.drain(ctx,'100');assert.equal(ids.length,1);
 const pending=(await query('SELECT * FROM hz_profile_outbox')).rows[0];assert.equal(pending.state,'pending');assert.ok(new Date(pending.retry_at)>new Date());
 await query("UPDATE hz_profile_outbox SET retry_at=NOW()-INTERVAL '1 second'");
 await delivery.drain(ctx,'100');assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
 assert.equal((await query('SELECT state FROM hz_profile_outbox')).rows[0].state,'sent');
}));

test('concurrent drainers cannot send the same event twice',()=>fixture(async({ctx,query,observe,make})=>{
 await observe('new');let release,started;const sending=new Promise(r=>{started=r;});const wait=new Promise(r=>{release=r;});let sends=0;
 ctx.globalChat={sendText:async()=>{sends++;started();await wait;return {body:{logId:'12345'}};}};
 const other=make();other.globalChat=ctx.globalChat;
 const first=delivery.drain(ctx,'100');await sending;await delivery.drain(other,'100');release();await first;
 assert.equal(sends,1);assert.equal((await query('SELECT state FROM hz_profile_outbox')).rows[0].state,'sent');
}));

test('disabled, locked, disconnected and different-bot queues stay pending; abandoned claims stay uncertain',()=>fixture(async({ctx,query,observe})=>{
 await observe('new');let sends=0;ctx.globalChat={sendText:async()=>{sends++;return {body:{logId:'12345'}};}};
 await query("UPDATE hz_rooms SET data=jsonb_set(data,'{manage}','false')");await delivery.drain(ctx,'100');
 await query("UPDATE hz_rooms SET data=jsonb_set(jsonb_set(data,'{manage}','true'),'{locked}','true')");await delivery.drain(ctx,'100');
 await query("UPDATE hz_rooms SET data=jsonb_set(data,'{locked}','false')");ctx.globalClient.connected=false;await delivery.drain(ctx,'100');
 ctx.globalClient.connected=true;ctx.globalBotId='8888';await delivery.drain(ctx,'100');assert.equal(sends,0);
 ctx.globalBotId='9999';await query("UPDATE hz_profile_outbox SET state='sending',claimed_at=NOW()-INTERVAL '6 minutes'");
 await delivery.drain(ctx,'100');assert.equal(sends,0);assert.equal((await query('SELECT state FROM hz_profile_outbox')).rows[0].state,'uncertain');
}));
