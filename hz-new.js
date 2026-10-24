"use strict";

const { createClient } = require('./dist');

const { attachRouter } = require('./shared/router');

const manage = require('./manage');

const { createGame } = require('./game');



function start() {

  const client = createClient({

    authPath: process.env.KAKAO_AUTH_PATH || './auth.json',

    debug: process.env.KAKAO_DEBUG === '1', autoConnect: true, autoReconnect: true

  });

  const game = createGame(client);

  let resolveReady, rejectReady;

  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });

  if(process.env.GL_WEB_ENABLED!=='0')require('./api/server').start({client,ready});

  ready.catch(err => console.error('[HZ NEW] 초기화 실패:', err));

  attachRouter(client, { game, management: manage, ready });

  let initializing = false;

  client.onReady(async () => {

    if (initializing) return;

    initializing = true;

    try {

      await game.init();

      await manage.init();

      require('./manage/scheduled-notices').start(client);

      require('./shared/runtime').startProfileWatch(client);

      resolveReady();

      console.log('[HZ NEW] 게임·관리 준비 완료');

    } catch (err) { rejectReady(err); }

  });

  client.on('error', err => console.error('[HZ NEW] 연결 오류:', err));

  const timer = setInterval(() => ready.then(() => manage.cleanup()).catch(err =>

    console.error('[GL 관리] 정리 오류:', err)), 60 * 60 * 1000);

  timer.unref();

  return client;

}

module.exports = { start };

if (require.main === module) start(); 

