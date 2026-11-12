'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const auto = require('../shared/voice-room-auto-detect');

function event({ room = '71000000000001', logId = '990001', type = 'vr_invite',
                 duration = 0, open = true, chatType = 52, sendAt,
                 callId = 'secret-call-id' } = {}) {
  return {
    room: { id: room, isOpenChat: open },
    message: { type: chatType, logId, text: 'untrusted body' },
    raw: { chatLog: {
      logId,
      ...(sendAt === undefined ? {} : { sendAt }),
      attachment: JSON.stringify({
        type, duration, csIP: '192.0.2.10', csIP6: '2001:db8::10',
        csPort: 9000, callId, token: 'secret-token',
      }),
    } },
  };
}
function deps({ manage = true, power = true } = {}) {
  const sent = [];
  const queries = [];
  const config = {
    async isManaged(roomId) { queries.push(['manage', roomId]); return manage; },
    async isBotEnabled(roomId) { queries.push(['power', roomId]); return power; },
    async send(roomId, text) { sent.push({ roomId, text }); return { status: 0 }; },
  };
  return { sent, queries, config };
}

test('management ON automatically notifies opening and closure without manual #보룸감지시작', async () => {
  const id = '71000000000011';
  const { sent, config } = deps();
  assert.equal(await auto.handleMessage(event({ room:id, logId:'990011' }), config, 1000), true);
  assert.equal(await auto.handleMessage(event({ room:id, logId:'990012', type:'vr_bye', duration:8 }), config, 2000), true);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map(x=>x.roomId), [id, id]);
  assert.match(sent[0].text, /보이스룸 개설 감지/);
  assert.match(sent[1].text, /보이스룸 종료 감지/);
  assert.match(sent[1].text, /진행 시간: 8초/);
  assert.equal(auto.last(id).eventType, 'vr_bye');
  assert.equal(auto.last(id).verifiedActive, false);
  assert.doesNotMatch(JSON.stringify(sent), /192\.0\.2\.10|2001:db8|secret-call-id|secret-token|untrusted body/);
});

test('management OFF cannot trigger auto notices or update last state', async () => {
  const id = '71000000000012';
  const { sent, config, queries } = deps({ manage: false });
  assert.equal(await auto.handleMessage(event({room:id}), config, 1000), false);
  assert.equal(sent.length, 0);
  assert.deepEqual(queries, [['manage', id]]);
  assert.equal(auto.last(id), null);
});

test('full bot power OFF also blocks automatic detection and delivery', async () => {
  const id = '71000000000013';
  const { sent, config, queries } = deps({ power: false });
  assert.equal(await auto.handleMessage(event({room:id}), config, 1000), false);
  assert.equal(sent.length, 0);
  assert.deepEqual(queries, [['manage', id], ['power', id]]);
  assert.equal(auto.last(id), null);
});

test('same server log ID is announced only once even when replayed', async () => {
  const id = '71000000000014';
  const { sent, config } = deps();
  const e = event({ room:id });
  assert.equal(await auto.handleMessage(e, config, 1000), true);
  assert.equal(await auto.handleMessage(e, config, 1001), false);
  assert.equal(sent.length, 1);
});

test('different rooms stay independent even with identical log ID', async () => {
  const a = '71000000000015';
  const b = '71000000000016';
  const { sent, config } = deps();
  assert.equal(await auto.handleMessage(event({ room:a }), config, 1000), true);
  assert.equal(await auto.handleMessage(event({ room:b }), config, 1000), true);
  assert.equal(sent.length, 2);
  assert.equal(auto.last(a).phase, '개설 이벤트 수신');
  assert.equal(auto.last(b).phase, '개설 이벤트 수신');
});

test('unsupported event types, non-open rooms and ordinary chats do not notify', async () => {
  const { sent, config, queries } = deps();
  for (const e of [
    event({ room:'71000000000017', type:'invite' }),
    event({ room:'71000000000018', open:false }),
    event({ room:'71000000000019', chatType:1 }),
    event({ room:'71000000000020', logId:undefined }),
  ]) {
    if (e.room.id === '71000000000020') { delete e.message.logId; delete e.raw.chatLog.logId; }
    assert.equal(await auto.handleMessage(e, config), false);
  }
  assert.deepEqual(sent, []);
  assert.deepEqual(queries, []);
});

test('replayed old chat history never triggers stale room announcement', async () => {
  const now = 1700000000000;
  const { sent, config } = deps();
  const oldMessage = event({room:'71000000000021', sendAt: Math.floor((now - 3600000) / 1000)});
  assert.equal(await auto.handleMessage(oldMessage, config, now), false);
  assert.equal(sent.length, 0);
});

test('database lookup errors fail closed instead of sending', async () => {
  const id = '71000000000022', sent = [];
  await assert.rejects(auto.handleMessage(event({room:id}), {
    isManaged: async () => {throw Error('database unavailable');},
    isBotEnabled: async () => true,
    send: async () => sent.push('sent'),
  }, 1000), /database unavailable/);
  assert.deepEqual(sent, []);
  assert.equal(auto.last(id), null);
});

test('installation handles actual EventEmitter message events once', async () => {
  const client = new EventEmitter();
  const {sent,config}=deps();
  assert.equal(auto.install(client,config),true);
  assert.equal(auto.install(client,config),true);
  assert.equal(client.listenerCount('message'), 1);
  client.emit('message', {}, event({room:'71000000000023'}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sent.length,1);
});

test('VOX invite only confirms exact call ID even when unrelated invite arrives first', async()=>{
  const client=new EventEmitter(),room='71000000000101';
  const {config,sent}=deps();
  auto.install(client,config);
  const watcher=auto.watchOpen(client,room);
  assert.ok(watcher);
  const own='13299692653040311',other='13299692653040312';
  assert.equal(await auto.handleMessage(event({room,logId:'991101',callId:other}),config),true);
  const pending=watcher.wait(own);
  assert.deepEqual(auto.callCorrelation(room,own),{
    inviteMatched:false,byeMatched:false,
  });
  assert.equal(await auto.handleMessage(event({room,logId:'991102',callId:own}),config),true);
  assert.equal(await pending,true);
  assert.deepEqual(auto.callCorrelation(room,own),{
    inviteMatched:true,byeMatched:false,
  });
  assert.deepEqual(auto.callCorrelation(room,other),{
    inviteMatched:false,byeMatched:false,
  });
  assert.ok(!JSON.stringify(auto.last(room)).includes(own));
  assert.ok(!JSON.stringify(sent).includes(own));
  watcher.close();
});

test('VOX invite received before create returns still matches expected call ID',async()=>{
  const client=new EventEmitter(),room='71000000000102';
  const {config}=deps();
  auto.install(client,config);
  const watcher=auto.watchOpen(client,room);
  await auto.handleMessage(event({room,logId:'991104',callId:'13299692653040311'}),config);
  assert.equal(await watcher.wait('13299692653040311'),true);
  assert.equal(auto.callCorrelation(room,'13299692653040311').inviteMatched,true);
  watcher.close();
});

test('matching VOX bye is correlated without leaking raw call ID',async()=>{
  const client=new EventEmitter(),room='71000000000103';
  const {config}=deps();
  auto.install(client,config);
  const watcher=auto.watchOpen(client,room);
  const id='13299692653040311';
  const done=watcher.wait(id);
  await auto.handleMessage(event({room,logId:'991105',callId:id}),config);
  assert.equal(await done,true);
  await auto.handleMessage(event({room,logId:'991106',type:'vr_bye',
    duration:30,callId:id}),config);
  assert.deepEqual(auto.callCorrelation(room,id),{
    inviteMatched:true,byeMatched:true,
  });
  assert.ok(!JSON.stringify(auto.callCorrelation(room,id)).includes(id));
  watcher.close();
});

test('missing or invalid VOX invite call IDs never confirm a pending create',async()=>{
  const client=new EventEmitter(),room='71000000000104';
  const {config}=deps();
  auto.install(client,config);
  const watcher=auto.watchOpen(client,room);
  assert.equal(await watcher.wait(undefined),false);
  watcher.close();
  assert.deepEqual(auto.callCorrelation(room,'13299692653040311'),{
    inviteMatched:false,byeMatched:false,
  });
});
