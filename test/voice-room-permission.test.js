'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const voice = require('../shared/voice-room-permission');

test('voice room action commands are distinguished from read-only commands', () => {
  for (const command of ['#보룸시작 테스트', '!보룸켜기', '#보룸종료',
    '#보룸참가', '#보룸퇴장', '#보이스룸시작 방송',
    '#보룸아이리스시작 비교', '#보룸아이리스참가', '#보룸아이리스퇴장']) {
    assert.equal(voice.isActionCommand(command), true, command);
  }
  for (const command of ['#보룸참가상태', '#보룸상태', '#보룸명령어',
    '#보룸감지시작', '!명령어', '#보룸시작하기', '#보룸아이리스상태']) {
    assert.equal(voice.isActionCommand(command), false, command);
  }
});

test('voice room remains OFF for absent/unknown room; reads a room-specific flag', async () => {
  const queries = [];
  const query = async (sql, params) => {
    queries.push(params[0]);
    assert.match(sql, /voiceRoomEnabled/);
    return { rows: params[0] === '18495931541358610'
      ? [{ voice_enabled: 'true' }] : [{ voice_enabled: null }] };
  };
  assert.equal(await voice.enabled('18495931541358610', query), true);
  assert.equal(await voice.enabled('18495931541358611', query), false);
  assert.equal(await voice.enabled('invalid', query), false);
  assert.deepEqual(queries, ['18495931541358610','18495931541358611']);
});
