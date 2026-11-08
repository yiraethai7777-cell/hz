'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const observer = require('../shared/voice-room-observer');

function message(roomId, type, text = '', open = true) {
  return {
    room: { id: roomId, isOpenChat: open },
    message: { type, text },
    raw: { chatLog: { type, message: text } },
  };
}

test('only source metadata from a watched open room is recorded', () => {
  const id = '91000000001';
  observer.start(id, 1000);
  assert.equal(observer.observeMessage(message(id, 1, '보룸 시작!'), 1100), false);
  assert.equal(observer.observeMessage(message(id, 52, 'secret text', false), 1100), false);
  assert.equal(observer.observeMessage(message('91000000002', 52), 1100), false);
  assert.equal(observer.observeMessage(message(id, 52, 'private chat message'), 1100), true);
  const snap = observer.get(id, 1200);
  assert.equal(snap.verifiedActive, false);
  assert.equal(snap.events.length, 1);
  assert.deepEqual(snap.events[0], { source: 'message', type: 52, at: 1100 });
  assert.doesNotMatch(JSON.stringify(snap), /private chat message|secret text/);
  observer.stop(id);
});

test('candidate VOX pushes require an unambiguous matching room ID', () => {
  const id = '91000000003';
  observer.start(id, 3000);
  assert.equal(observer.observePush({ method: 'VOX_CHANGED', body: { chatId: id, token: 'private-token' } }, 3200), true);
  assert.equal(observer.observePush({ method: 'VOX_CHANGED', body: { token: 'secret' } }, 3200), false);
  assert.equal(observer.observePush({ method: 'MSG', body: { chatId: id } }, 3200), false);
  assert.equal(observer.observePush({ method: 'VOX_CHANGED', body: { chatId: '91000000004' } }, 3200), false);
  const result = observer.get(id, 3300);
  assert.deepEqual(result.events, [{ source: 'push', method: 'VOX_CHANGED', at: 3200 }]);
  assert.equal(result.verifiedActive, false);
  observer.stop(id);
});

test('expired watch never claims that a room is inactive or active', () => {
  const id = '91000000005';
  const until = observer.start(id, 100).until;
  assert.equal(observer.observeMessage(message(id, 51), until - 1), true);
  assert.equal(observer.observeMessage(message(id, 51), until), false);
  assert.deepEqual(observer.get(id, until), { observing: false, verifiedActive: false, events: [] });
});

test('watch events are bounded and remain room-scoped', () => {
  const id = '91000000006';
  observer.start(id, 5000);
  for (let i = 0; i < 30; i++) observer.observeMessage(message(id, 51), 5001 + i);
  const snap = observer.get(id, 5100);
  assert.equal(snap.events.length, 12);
  assert.equal(snap.events[0].at, 5019);
  observer.stop(id);
});

test('observer attaches once to connected client and never sends packets', () => {
  const id = '91000000007';
  const client = new EventEmitter();
  const carriage = new EventEmitter();
  client._carriage = carriage;
  observer.install(client);
  observer.install(client);
  assert.equal(client.listenerCount('message'), 1);
  assert.equal(carriage.listenerCount('push'), 1);
  observer.start(id);
  client.emit('message', {}, message(id, 52, 'do not store'));
  carriage.emit('push', { method: 'VOX_STATUS', body: { c: id, token: 'secret' } });
  let result = observer.get(id);
  assert.equal(result.events.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /do not store|secret/);
  client.emit('ready');
  assert.equal(carriage.listenerCount('push'), 1);
  observer.stop(id);
});

test('unknown account or chat ID cannot start observation', () => {
  assert.throws(() => observer.start('abc'), /ID/);
  assert.equal(observer.observePush({ method: 'VOX_STATUS', body: { c: 'not-an-id' } }), false);
});


test('type-52 label and time-shaped text become tentative opening/ending hints', () => {
  const room = '91000000008';
  observer.start(room, 1000);
  assert.equal(observer.observeMessage(message(room, 52, '보이스룸'), 1100), true);
  assert.equal(observer.observeMessage(message(room, 52, '0:16'), 1200), true);
  const events = observer.get(room, 1300).events;
  assert.equal(events[0].phaseHint, '개설 표시 후보');
  assert.equal(events[1].phaseHint, '종료 표시 후보');
  assert.equal(observer.get(room, 1300).verifiedActive, false);
  assert.doesNotMatch(JSON.stringify(events), /"0:16"|"보이스룸"/);
  observer.stop(room);
});

test('duration-like ordinary messages never count as type-52 events', () => {
  const room = '91000000009';
  observer.start(room, 1000);
  assert.equal(observer.observeMessage(message(room, 1, '0:19'), 1100), false);
  assert.equal(observer.get(room, 1200).events.length, 0);
  observer.stop(room);
});

test('attachment shape retains sanitized field names/types but never values', () => {
  const room = '91000000010';
  observer.start(room, 1000);
  const msg = message(room, 52, 'secret message');
  msg.raw.chatLog.attachment = JSON.stringify({
    eventType: 'private-text-secret',
    status: 2,
    token: 'secret-token',
    userId: '912345678901',
    title: 'secret title',
    nested: { message: 'secret nested' },
    dangerouslyLargeId: '99988877',
  });
  assert.equal(observer.observeMessage(msg, 1200), true);
  const event = observer.get(room, 1300).events[0];
  assert.equal(event.shape, 'eventType:string,nested:object,status:number');
  assert.equal(event.phaseHint, undefined);
  assert.doesNotMatch(JSON.stringify(event), /private-text-secret|secret-token|912345678901|secret title|secret nested|99988877/);
  observer.stop(room);
});

test('unparseable or too large attachment never leaks its raw body', () => {
  const room = '91000000011';
  observer.start(room, 1000);
  for (const attachment of ['{malformed private', '{"large":"' + 'private'.repeat(2000) + '"}']) {
    const msg = message(room, 52, '');
    msg.raw.chatLog.attachment = attachment;
    assert.equal(observer.observeMessage(msg, 1200), true);
  }
  const events = observer.get(room, 1300).events;
  assert.ok(events.every(e => !e.shape));
  assert.doesNotMatch(JSON.stringify(events), /malformed|private|large/);
  observer.stop(room);
});
