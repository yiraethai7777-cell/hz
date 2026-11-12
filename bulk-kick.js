'use strict';
// Standalone Windows terminal runner: no PostgreSQL, no NEXI game/runtime.
const readline = require('node:readline');
const { createClient } = require('./dist');

const args = process.argv.slice(2);
const roomArg = args.indexOf('--room');
const roomId = roomArg >= 0 ? args[roomArg + 1] : '';
if (!/^\d{8,25}$/.test(roomId || '')) {
  console.error('사용법: node bulk-kick.js --room 채팅방ID');
  process.exit(1);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const client = createClient({
  authPath: process.env.KAKAO_AUTH_PATH || './auth.json',
  autoConnect: false,
  autoReconnect: true
});
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let connected = false;
let running = false;
const prompt = question => new Promise(resolve => rl.question(question, resolve));
const isMember = role => Number(role) === 2;
const isManager = role => [1, 4].includes(Number(role));

async function roster() {
  if (!client.connected) throw new Error('카카오톡에 연결되어 있지 않습니다.');
  if (typeof client.refreshMemberProfiles !== 'function')
    throw new Error('현재 KakaoForge 버전에서 참여자 조회 기능을 찾을 수 없습니다.');
  // Use the current LOCO roster, NOT old database/participation records.
  const members = await client.refreshMemberProfiles(roomId, {
    allowChatOnRoomFallback: true,
    onProgress: p => console.log('참여자 조회:', p.page, '페이지,', p.totalMembers, '명')
  });
  const seen = new Set();
  const result = [];
  for (const m of members) {
    const id = String(m.id || '');
    if (!/^\d{4,25}$/.test(id) || seen.has(id)) throw new Error('참여자 ID 중복 또는 불일치');
    seen.add(id);
    // Unknown roles must abort to avoid kicking owners/submanagers.
    if (![1, 2, 4].includes(Number(m.type)))
      throw new Error('참여자 역할을 확인할 수 없습니다: ' + id + ' (실행 중단)');
    result.push({ id, name: String(m.name || id), role: Number(m.type) });
  }
  if (!result.length) throw new Error('조회된 참여자가 없습니다.');
  return result;
}

async function kickAll() {
  if (running) return console.log('이미 실행 중입니다.');
  running = true;
  try {
    const members = await roster();
    const botId = String(client.userId);
    const me = members.find(m => m.id === botId);
    if (!me || !isManager(me.role)) throw new Error('PC 로그인 계정의 방장/부방장 권한을 검증하지 못했습니다.');
    const targets = members.filter(m => m.id !== botId && isMember(m.role));
    if (!targets.length) return console.log('강퇴할 일반 참여자가 없습니다.');
    // The typed terminal command is the execution authorization. No additional
    // confirmation, preview or KakaoTalk announcement is sent.
    console.log('일괄강퇴 시작:', roomId, '| 대상', targets.length, '명');
    let success = 0, failed = 0;
    for (const member of targets) {
      if (!client.connected) throw new Error('연결이 끊어져 중단했습니다.');
      try {
        const result = await client.openChatKick(roomId, member.id);
        const status = result?.status ?? result?.body?.status;
        if (result === false || result?.success === false || result?.ok === false ||
            (status != null && Number(status) !== 0)) throw new Error('강퇴 응답 실패: ' + String(status ?? 'false'));
        success++;
        console.log('성공:', member.name, member.id);
      } catch (err) {
        failed++;
        console.error('실패:', member.name, member.id, String(err?.message || err));
      }
      await sleep(200);
    }
    console.log('완료: 성공', success, '명 / 실패', failed, '명');
  } catch (err) {
    console.error('실행 중단:', String(err?.message || err));
  } finally {
    running = false;
  }
}

client.onMessage(async (...received) => {
  const msg = received.length === 1 ? received[0] : received[1];
  const text = String(msg?.message?.text ?? msg?.text ?? '').trim();
  if (String(msg?.room?.id) !== roomId) return;
  if (text === '!핑') {
    try {
      await client.chat.sendText(roomId, '🏓 퐁! PC 봇 연결 정상');
    } catch (error) {
      console.error('핑 응답 실패:', String(error?.message || error));
    }
    return;
  }
  if (text !== '!일괄강퇴') return;
  const senderId = msg?.sender?.id ?? msg?.senderId;
  if (senderId == null || String(senderId) !== String(client.userId)) {
    console.warn('일괄강퇴 무시: PC 로그인 봇 계정만 실행할 수 있습니다.');
    return;
  }
  // Only the specifically configured room and bot-account message can start kicks.
  // Never post a confirmation or status message to KakaoTalk.
  void kickAll();
});
client.onReady(() => {
  connected = true;
  console.log('✅ 카카오톡 연결 완료. 대상 방:', roomId);
  console.log('PowerShell에서 !핑 / !일괄강퇴 / 종료 를 입력할 수 있습니다.');
});
client.on('error', error => console.error('연결 오류:', String(error?.message || error)));
async function main() {
  await client.connect();
  while (true) {
    const command = (await prompt('NEXI-PC> ')).trim();
    if (command === '종료' || command === 'exit') break;
    if (command === '!핑') console.log(client.connected ? '🏓 퐁! PC 연결 정상' : '❌ 연결되지 않음');
    else if (command === '!일괄강퇴') await kickAll();
    else if (command) console.log('명령어: !핑 / !일괄강퇴 / 종료');
  }
  rl.close();
  process.exit(0);
}
main().catch(error => {
  console.error('PC 실행 실패:', String(error?.message || error));
  process.exitCode = 1;
  rl.close();
});
