'use strict';
const { getPool, testConnection } = require('../shared/db');
const { initWallet } = require('./wallet');
const { initMembers } = require('./members');
const { initCoinExtra } = require('./coin');
const market = require('./commands');
const aliases = require('./command-aliases');
const marketCommand = /^#(?:게임가입|코인순위|코인내역|코인송금|코인지급|코인아이디|코인초기화|핑)(?:\s|$)/;
const controls = /^#(?:퀴즈|낚시)(?:작동|중지)$/;

function createGame(client) {
  let legacyMessage;
  return {
    async init() {
      await testConnection();
      await initWallet();
      await initMembers();
      await initCoinExtra();
      await require('./economy').init();
      await require('./farm').init();
      await require('./mining').init();
      await require('../api/schema').init();
      await require('./room-reset').init();
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
    async toggle({roomId,text,isBotAccount,roomBotAdmin=false,send}) {
      if (!isBotAccount&&!roomBotAdmin) return;
      const on = text === '!게임on';
      // Patch only the flag, retaining every existing player and setting.
      await getPool().query(`INSERT INTO hz_rooms(room_id,data)
        VALUES($1,jsonb_build_object('game',$2::boolean))
        ON CONFLICT(room_id) DO UPDATE SET
        data=CASE WHEN $2::boolean
          THEN jsonb_set(hz_rooms.data,'{game}','true'::jsonb,true)
          ELSE jsonb_set(jsonb_set(hz_rooms.data,'{game}','false'::jsonb,true),'{quiz}','null'::jsonb,true)
        END,updated_at=NOW()`,
      [String(roomId),on]);
      await send(on ? '🎮 카카오톡 게임 매니저 | 게임 기능이 작동되었습니다.' : '🎮 카카오톡 게임 매니저 | 게임 기능이 중지되었습니다.');
    },
    async message(context) {
      const text = aliases.toLegacy(context.text);
      const msg = aliases.toLegacyMessage(context.msg,context.text,text);
      const normalized = text===context.text?context:{...context,text,msg};
      const {roomId,chat,isBotAccount,roomBotAdmin=false,send} = normalized;
      // The room-only game reset requires confirmation and is allowed when games are OFF.
      if(/^#게임초기화(?:\s|$)/.test(text)){
        await require('./room-reset').handle(normalized);
        return;
      }
      // Plain-text confirmation for a pending fishing rod restoration.
      if(text==='네'||text==='아니요'){
        try{
          const response=await require('../shared/runtime').respondRodRestore(normalized);
          if(response){await send(response);return;}
        }catch(error){
          console.error('[ROD RESTORE]',String(error?.code||error?.message||error));
          await send('❌ 낚싯대 복구 선택 처리 중 오류가 발생했습니다.');
          return;
        }
      }
      // Handle rod purchases explicitly. The legacy event adapter could finish
      // without an actionable reply; this always sends the transaction result.
      if(/^#낚시대구매(?:\s|$)/.test(text)){
        try {
          await send(await require('../shared/runtime').buyRod(normalized));
        } catch(error) {
          console.error('[ROD PURCHASE]',String(error?.code||error?.message||error));
          await send('❌ 낚시대 구매 처리 중 오류가 발생했습니다. Railway 로그를 확인해 주세요.');
        }
        return;
      }
      if(/^#물고기전송(?:\s|$)/.test(text)){
        await require('./fish-transfer').handle(normalized);
        return;
      }
      // Retired commands must not mutate games or historical records.
      if (/^[!#](?:준개|전체준개)/.test(text)) return;
      if (/^[!#](?:주식|내주식)/.test(text) || ['!코인','!레벨','!내정보','#코인','#레벨','#내정보'].includes(text)) return;
      
      // Check room state before dispatching any quiz command. Previously this
      // fast path bypassed the room's game OFF gate.
      if ((text === '#퀴즈' || /^#정답(?:\s|$)/.test(text)) && legacyMessage) {
        const q=await getPool().query("SELECT (data->>'game')::boolean AS game,(data->>'quizEnabled')::boolean AS quiz FROM hz_rooms WHERE room_id=$1",[String(roomId)]);
        if(!isBotAccount&&q.rows[0]?.game!==true)return;
        if(!isBotAccount&&q.rows[0]?.quiz===false)return;
        await legacyMessage(chat,msg);
        return;
      }

      if (text==='#정보') {if(await require('./info').handle(normalized,client))return;}
      if(await require('../promotion').handleCommand(normalized,client))return;
      if(await require('./privacy').command(normalized))return;
      // A room administrator must be able to reset this room's coins even
      // when its game feature is disabled or the room is game-locked.
      // The coin handler independently enforces bot / room-super-admin permissions.
      if (/^#코인초기화(?:\s|$)/.test(text)) {
        await market.message(normalized);
        return;
      }
      if (controls.test(text) && !isBotAccount && !roomBotAdmin) {
        await send('⛔ 봇 계정만 사용할 수 있습니다.'); return;
      }
      const r = await getPool().query('SELECT data FROM hz_rooms WHERE room_id=$1',[String(roomId)]);
      const flags = r.rows[0]?.data || {};
      if(/^#치트(?:\s|$)/.test(text)){
        const senderId=msg.sender?.id??msg.senderId;
        let allowed=isBotAccount;
        if(!allowed&&senderId!=null){
          allowed=await require('../shared/super-admin').isSuperAdmin(roomId,senderId);
        }
        if(!allowed){await send('⛔ !치트는 봇 계정 또는 이 방의 최고관리자만 사용할 수 있습니다.');return;}
        if(!flags.game){await send('🎮 이 방은 게임 기능이 꺼져 있습니다. !게임on으로 활성화해 주세요.');return;}
        await require('./extra').handle(normalized,client);
        return;
      }
      if(text==='#게임상태'){await send(`🎮 게임: ${flags.game?'작동':'중지'}\n🧩 퀴즈: ${flags.quizEnabled!==false?'작동':'중지'}\n🎣 낚시: ${flags.fishEnabled!==false?'작동':'중지'}`);return;}
      if(text==='#게임정보'){await send('🎮 카카오톡 게임 매니저 | 게임 정보\n━━━━━━━━━━━━━━━━━━\n!게임가입으로 시작하세요.\n코인·광물 채굴·낚시(20종)·퀴즈(500문제)·펫·레벨을 즐길 수 있습니다.\n게임과 관리는 독립적으로 작동합니다.\n!게임명령어에서 자세한 사용법을 확인하세요.');return;}
      if (flags.locked&&!isBotAccount) return;
      if(/^#(?:광산|채굴|광물인벤|광물판매|곡괭이|곡괭이강화|곡괭이구매|곡괭이장착|채굴지)(?:\s|$)/.test(text)){
        if(!flags.game){await send('게임 기능이 꺼져 있습니다. !게임on 이후 이용해 주세요.');return;}
        await require('./mining').handle({...normalized,isArdenClan:String(flags.ardenClan)==='true'});return;
      }
      if(/^#상점(?:\s|$)/.test(text)){if(!flags.game){await send('게임 기능이 꺼져 있습니다.');return;}await require('./shop').handle(normalized);return;}
      if(await require('./typing').handle(normalized,!!flags.game||isBotAccount))return;
      if((flags.game||isBotAccount)&&await require('./farm').handle(normalized))return;
      if((flags.game||isBotAccount)&&await require('./extra').handle(normalized,client))return;
      if (marketCommand.test(text)) {
        if (!flags.game&&!isBotAccount) return;
        // Read-only coin lookups do not need a wallet migration/row lock.
        const walletChanging=/^#(?:게임가입|코인송금|코인지급)(?:\s|$)/.test(text);
        if(walletChanging&&msg.sender?.id!=null)
          await require('./economy').ensureLinked(String(roomId),String(msg.sender.id),msg.sender.name);
        await market.message(normalized);
        return;
      }
      // Legacy fishing, pets, quizzes and management keep their original
      // tables, timers, events and permissions, without a second registration.
      if (legacyMessage) await legacyMessage(chat, msg);
    }
  };
}
module.exports = { createGame };
