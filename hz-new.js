"use strict";
const { createClient } = require('./dist');
const { attachRouter } = require('./shared/router');
const manage = require('./manage');
const { createGame } = require('./game');

// 새로 추가된 고급 관리 및 이벤트 모듈 불러오기 (경로에 맞게 설정)
const { AdvancedManager } = require('./modules/advancedManager');

function start() {
  const client = createClient({
    authPath: process.env.KAKAO_AUTH_PATH || './auth.json',
    debug: process.env.KAKAO_DEBUG === '1', 
    autoConnect: true, 
    autoReconnect: true
  });
  
  const game = createGame(client);
  
  // AdvancedManager 인스턴스 생성
  const advancedManager = new AdvancedManager(client);

  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { 
    resolveReady = resolve; 
    rejectReady = reject; 
  });

  if (process.env.GL_WEB_ENABLED !== '0') {
    require('./api/server').start({ client, ready });
  }

  ready.catch(err => console.error('[HZ NEW] 초기화 실패:', err));
  
  // 기존 라우터 부착 (게임 및 관리 기능 유지)
  attachRouter(client, { game, management: manage, ready });

  // [추가] 모든 채팅 메시지를 새로 만든 고급 관리 및 이벤트 매니저로 전달
  client.on('chat', async (chat, channel) => {
    try {
      const sender = await channel.getMember(chat.sender);
      await advancedManager.handleMessage(chat, sender, channel);
    } catch (err) {
      console.error('[AdvancedManager Event Error]', err);
    }
  });

  let initializing = false;
  client.onReady(async () => {
    if (initializing) return;
    initializing = true;
    try {
      await game.init();
      await manage.init();
      require('./shared/runtime').startProfileWatch(client);
      resolveReady();
      console.log('[HZ NEW] 게임·관리 준비 완료');
    } catch (err) { 
      rejectReady(err); 
    }
  });

  client.on('error', err => console.error('[HZ NEW] 연결 오류:', err));

  const timer = setInterval(() => {
    ready.then(() => manage.cleanup()).catch(err =>
      console.error('[GL 관리] 정리 오류:', err)
    );
  }, 60 * 60 * 1000);
  
  timer.unref();
  return client;
}

module.exports = { start };

if (require.main === module) start();
