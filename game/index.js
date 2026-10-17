'use strict';
const { getPool, testConnection } = require('../shared/db');
const { initWallet } = require('./wallet');
const { initMembers } = require('./members');
const { initTrading } = require('./trading');
const { initCoinExtra } = require('./coin');
const { handleExtraMessage } = require('../shared/help');
const manage = require('../manage');
const market = require('./commands');
const marketCommand = /^!(?:게임가입|코인|코인순위|코인내역|코인송금|코인지급|코인아이디|주식검색|주식현황|주식구매|주식판매|내주식|주식거래내역|핑)(?:\s|$)/;
const controls = /^!(?:퀴즈|낚시|준개)(?:작동|중지)$/;

function createGame(client) {
  let legacyMessage;
  return {
    async init() {
      await testConnection();
      await initWallet();
      await initMembers();
      await initTrading();
      await initCoinExtra();
      // Register feature handlers through an adapter; the router keeps the sole listener.
      const adapter = new Proxy(client, {
        get(target, prop) {
          if (prop === 'onMessage') return handler => { legacyMessage = handler; };
          const value = Reflect.get(target, prop, target);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
      await require('../shared/runtime').attachModules(adapter);
    },
    async toggle({roomId,text,isBotAccount,send}) {
      if (!isBotAccount) { await send('⛔ GL봇 계정만 사용할 수 있습니다.'); return; }
      const on = text === '!게임작동';
      if (on && !await manage.enabled(roomId)) {
        await send('🛡️ 먼저 이 방에서 !관리작동 명령어를 사용해 주세요.'); return;
      }
      // Patch only the flag, retaining every existing player and setting.
      await getPool().query(`INSERT INTO hz_rooms(room_id,data)
        VALUES($1,jsonb_build_object('game',$2::boolean))
        ON CONFLICT(room_id) DO UPDATE SET
        data=jsonb_set(hz_rooms.data,'{game}',to_jsonb($2::boolean)),updated_at=NOW()`,
      [String(roomId),on]);
      await send(on ? '🎮 게임 기능이 작동되었습니다.' : '⏹️ 게임 기능이 중지되었습니다.');
    },
    async message(context) {
      const {roomId,text,msg,chat,isBotAccount,send} = context;
      if (controls.test(text) && !isBotAccount) {
        await send('⛔ GL봇 계정만 사용할 수 있습니다.'); return;
      }
      const r = await getPool().query('SELECT data FROM hz_rooms WHERE room_id=$1',[String(roomId)]);
      const flags = r.rows[0]?.data || {};
      if (flags.locked) return;
      if (text === '!주식시간' || marketCommand.test(text)) {
        if (!flags.game) return;
        if (text === '!주식시간') await handleExtraMessage(client, chat, msg);
        else await market.message(context);
        return;
      }
      // Legacy fishing, pets, quizzes, jun and management keep their original
      // tables, timers, events and permissions, without a second registration.
      if (legacyMessage) await legacyMessage(chat, msg);
    }
  };
}
module.exports = { createGame };
