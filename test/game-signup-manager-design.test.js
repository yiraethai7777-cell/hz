'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { formatJoinGameMessage } = require('../game/members');

test('new signup uses KakaoTalk Game Manager format and shows bonus', () => {
  const message = formatJoinGameMessage({ name: '테스트', joined: true, bonus: 100000, balance: 120000 });
  assert.match(message, /^🎮 카카오톡 게임 매니저 \| 게임 가입 완료/);
  assert.match(message, /👤 닉네임 · 테스트/);
  assert.match(message, /🎁 가입 축하금 · 100,000코인/);
  assert.match(message, /🪙 보유 코인 · 120,000코인/);
  assert.match(message, /!게임명령어/);
  assert.doesNotMatch(message, /HZ|NEXI/);
});

test('migration signup keeps existing balance note when bonus is zero', () => {
  const message = formatJoinGameMessage({ name: '기존회원', joined: true, bonus: 0, balance: 2500 });
  assert.match(message, /가입 축하금 · 0코인/);
  assert.match(message, /보유 코인 · 2,500코인/);
  assert.match(message, /기존 지갑 잔액은 그대로 유지됩니다/);
});

test('already joined user sees current balance without any new signup bonus', () => {
  const message = formatJoinGameMessage({ name: '기존회원', joined: false, bonus: 100000, balance: 5000 });
  assert.match(message, /^🎮 카카오톡 게임 매니저 \| 게임 가입 안내/);
  assert.match(message, /가입 상태 · 이미 가입됨/);
  assert.match(message, /보유 코인 · 5,000코인/);
  assert.doesNotMatch(message, /가입 축하금/);
  assert.doesNotMatch(message, /HZ|NEXI/);
});
