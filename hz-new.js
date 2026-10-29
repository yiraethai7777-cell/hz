"use strict";

const { createClient } = require('./dist');
const {id,original,safeError}=require('./shared/delete-message');

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
  const recentMessages = new Map();
  const keyFor = (room, log) => String(room) + ':' + String(log);

  // Independent listener: persist every incoming message before it can be deleted.
  // EventEmitter 'message' is emitted by KakaoForge regardless of onMessage handlers.
  client.on('message', (...args) => {
    const msg = args.length === 1 ? args[0] : args[1];
    const record=original(msg);
    const {roomId,messageId,userId,text}=record;
    console.log('[DELETE DIAG RECEIVE]',JSON.stringify({...record.comparison,valid:!!(roomId&&messageId&&userId),hasText:typeof text==='string'&&!!text}));
    if(!roomId||!messageId||!userId||typeof text!=='string'||!text||record.comparison.idLogMatch===false||record.comparison.idMatch===false||record.comparison.roomMatch===false)return;
    recentMessages.set(keyFor(roomId, messageId), {text, userId, userName:msg.sender?.name, at:Date.now()});
    if(recentMessages.size>5000){for(const [key,item] of recentMessages){if(Date.now()-item.at>86400000)recentMessages.delete(key);}if(recentMessages.size>5000)recentMessages.delete(recentMessages.keys().next().value);}

    void ready.then(() => manage.saveDeletedMessage({
      roomId, messageId, userId,
      userName: msg.sender?.name, text, botId: client.userId
    })).catch(error => console.error('[DELETE WATCH] message persistence failed',safeError(error)));
  });


  // Deleted-message events identify the original message author via event.member.
  // Never treat the deletion actor as the warned user.
  client.onDelete(async (...args) => {
    const event = args.length === 1 ? args[0] : args[1];
    const roomId = id(event?.room?.id ?? event?.chatId);
    const userId = event?.member?.ids?.[0];
    const userName = event?.member?.names?.[0] || String(userId || '');
    const messageId = id(event?.message?.logId ?? event?.logId);
    if (!roomId || !messageId) {
      console.warn('[DELETE V2] missing room or message ID');
      return;
    }
    // Deletion pushes can lack reliable room-type metadata.
    // manage.deleted() independently requires this room to be explicitly enabled.
    if (event?.room?.isOpenChat === false) {
      console.log('[DELETE V2] room metadata says non-open; checking configured room', 'configured room');
    }
    try {
      console.log('[DELETE V2] callback entered', JSON.stringify({valid:true}));
      await ready;
      console.log('[DELETE V2] received', JSON.stringify({valid:true,authorAvailable:!!userId}));
      const cached = recentMessages.get(keyFor(roomId,messageId));
      console.log('[DELETE DIAG MATCH]', JSON.stringify({cacheHit:!!cached,roomCacheCount:[...recentMessages.keys()].filter(k=>k.startsWith(String(roomId)+':')).length}));
      const handled = await manage.deleted({
        cached,
        fetchOriginal: (room, log) => client.fetchMessage(room, log),
        roomId, userId, userName, messageId, botId: client.userId,
        send: async body => {
          console.log('[DELETE V2] sending unified alert', JSON.stringify({chars:body.length}));
          return client.chat.sendText(roomId, body);
        }
      });
      console.log('[DELETE V2] result', JSON.stringify({handled:!!handled}));
    } catch (error) {
      console.error('[DELETE V2] failed',safeError(error));
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

