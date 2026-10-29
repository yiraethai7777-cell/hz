"use strict";

const { createClient } = require('./dist');

const { attachRouter } = require('./shared/router');

const manage = require('./manage');

const { createGame } = require('./game');



function start() {
  console.log('[DELETE WATCH] rebuilt deletion watcher loaded');

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

  // Deleted-message events identify the original message author via event.member.
  // Never treat the deletion actor as the warned user.
  client.onDelete(async (...args) => {
    const event = args.length === 1 ? args[0] : args[1];
    const roomId = event?.room?.id ?? event?.chatId;
    const userId = event?.member?.ids?.[0];
    const userName = event?.member?.names?.[0] || String(userId || '');
    const messageId = event?.message?.logId ?? event?.logId;
    if (!roomId || !messageId) {
      console.warn('[DELETE V2] missing room or message ID');
      return;
    }
    // Deletion pushes can lack reliable room-type metadata.
    // manage.deleted() independently requires this room to be explicitly enabled.
    if (event?.room?.isOpenChat === false) {
      console.log('[DELETE V2] room metadata says non-open; checking configured room', String(roomId));
    }
    try {
      console.log('[DELETE V2] callback entered', JSON.stringify({roomId:String(roomId),messageId:String(messageId)}));
      await ready;
      console.log('[DELETE V2] received', JSON.stringify({roomId:String(roomId),messageId:String(messageId),authorAvailable:!!userId}));
      const handled = await manage.deleted({
        roomId, userId, userName, messageId, botId: client.userId,
        send: async body => {
          console.log('[DELETE V2] sending unified alert', JSON.stringify({roomId:String(roomId),chars:body.length}));
          return client.chat.sendText(roomId, body);
        }
      });
      console.log('[DELETE V2] result', JSON.stringify({roomId:String(roomId),handled:!!handled}));
    } catch (error) {
      console.error('[DELETE V2] failed', error);
    }
  });


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

