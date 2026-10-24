'use strict';
const { handleExtraMessage } = require('./help');
const gameAliases=require('../game/command-aliases');

function attachRouter(client, { game, management, ready = Promise.resolve() }) {
  client.onMessage(async (...args) => {
    const msg = args.length === 1 ? args[0] : args[1];
    const chat = args.length === 1 ? (client.chat || client) : args[0];
    if (msg?.room?.id == null) return;
    const text = String(msg.message?.text ?? msg.text ?? '').trim();
    const roomId = msg.room.id;
    const senderId = msg.sender?.id ?? msg.senderId;
    const isBotAccount = client.userId != null && String(client.userId) !== '0' &&
      senderId != null && String(client.userId) === String(senderId);
    try {
      // Voice-room help/status must remain responsive even if unrelated
      // game/database initialization is still pending or has failed.
      if (/^[#!]?(?:보룸켜기|보룸상태|보이스룸켜기|보이스룸상태)(?=$|\s)/.test(text)) {
        console.log('[보이스룸] 명령 수신:', JSON.stringify({
          roomId: String(roomId),
          command: text.split(/\s/,1)[0],
          senderType: msg.sender?.type == null ? 'unknown' : String(msg.sender.type),
          connected: client.connected !== false,
          sameAsBotAccount: isBotAccount
        }));
        const sendVoiceReply = async body => {
          const len = String(body).length;
          const target = String(roomId);
          console.log('[보이스룸] 응답 전송 시작:', JSON.stringify({
            roomId: target, chars: len,
            method: typeof chat?.sendText === 'function' ? 'chat.sendText' :
              typeof client?.sendText === 'function' ? 'client.sendText' : 'missing'
          }));
          try {
            let result;
            if (typeof chat?.sendText === 'function') {
              result = await chat.sendText(roomId, body);
            } else if (typeof client?.sendText === 'function') {
              result = await client.sendText(roomId, body);
            } else {
              throw Error('KakaoForge sendText 함수가 없습니다.');
            }
            const status = result?.status;
            const logId = result?.body?.logId;
            console.log('[보이스룸] 응답 전송 결과:', JSON.stringify({
              roomId: target, status: status ?? 'unknown',
              ackLogId: logId == null ? null : String(logId)
            }));
            // The KakaoForge WRITE implementation accepts only status 0
            // with a returned body.logId as a confirmed message send.
            if (status !== 0 || !logId) {
              throw Error('카카오톡 WRITE 응답 확인 불가 (status=' +
                String(status ?? 'unknown') + ', logId=' + (logId ? 'present' : 'missing') + ')');
            }
            return result;
          } catch (sendError) {
            console.error('[보이스룸] 응답 전송 오류:', String(sendError?.message || sendError));
            throw sendError;
          }
        };
        try {
          await require('./voice-room').handle({
            client, roomId, msg, text, send: sendVoiceReply
          });
        } catch (error) {
          console.error('[보이스룸] 명령어 처리 오류:', error);
          try {
            await sendVoiceReply(
              '❌ 보이스룸 명령어 처리 중 오류가 발생했습니다. Railway 로그를 확인해 주세요.');
          } catch (sendError) {
            console.error('[보이스룸] 오류 안내 전송 실패:', sendError);
          }
        }
        return;
      }
      // Old ! game toggles are retired; do not forward them to legacy handlers.
      if (text === '!게임작동' || text === '!게임중지') {
        await chat.sendText(roomId,'⚠️ 게임 ON/OFF 명령어가 변경되었습니다. !게임on / !게임off');
        return;
      }
      // Game commands now use !. Drop retired # game commands before any legacy listeners.
      if (gameAliases.isRetiredLegacyCommand(text)) return;
      // Retired # management aliases must not reach the old HZ handler.
      // Keep legacy #내아이디/#아이디/#출석확인 permission rules unchanged.
      if (/^#(?:출석|출석순위|채팅순위|채팅순위전체|채팅정보|경고|경고내역|경고삭제|경고초기화|kick|k|내풀|벤해제|벤기록|관리로그|입퇴장로그|입장변경|퇴장변경|프로필로그|관리작동|관리중지|관리자추가|관리자삭제|도배감지켜기|도배감지끄기|삭제감지켜기|삭제감지끄기)(?=$|\s)/.test(text))return;
      // Manual KakaoTalk notice status/registration commands were retired.
      // Actual room notice registration is available only via scheduled commands.
      if (/^#이벤공지(?:상태|등록)(?=$|\s)/.test(text)) return;
      // All APEX event commands now use !. Retire old # event aliases.
      if (/^#이벤(?:설정|속도|공지작성|공지|당첨문구|탈락문구|시간초과문구|초기화|인원테스트|추첨테스트|진행테스트)(?=$|\s)/.test(text)) return;
      // Observe incoming responses before other commands; never block the message.
      require('./event-reaction-test').receive({roomId, senderId, text, isBotAccount});
      await ready;
      // Serve the (static) game help before management and event pipelines.
      if(text==='!게임명령어'){
        await handleExtraMessage(client,...args);
        return;
      }
      
      const context = {
  client,
  roomId,
  userId: senderId ?? '',
  userName: msg.sender?.name || '알 수 없음',
  messageId: msg.id ?? msg.message?.id ?? null,
  text,
  isBotAccount,
  senderType: msg.sender?.type,
  botId: client.userId,
  msg,
  resolveTarget: () => require('../manage/targets').resolve({msg,text,roomId,client,db:require('./db').getPool()}),
  unban: typeof client.openChatUnkick === 'function' ? target => client.openChatUnkick(roomId,String(target)) : undefined,
  kick: async target => {
    const id = String(target);
    if (!/^\d{4,}$/.test(id)) throw new Error('정확한 카카오 사용자 ID를 입력해 주세요.');
    if (id === String(client.userId) || id === String(senderId))
      throw new Error('봇 또는 명령 실행자 본인은 내보낼 수 없습니다.');
    if (typeof client.openChatKick !== 'function') throw new Error('내보내기 API를 사용할 수 없습니다.');
    const result = await client.openChatKick(roomId, id);
    console.log('[KICK API]', JSON.stringify({ roomId: String(roomId), targetId: id, result }));
    if (result === false || result?.success === false || result?.ok === false ||
        result?.status === 'error' || (typeof result?.status === 'number' && result.status !== 0))
      throw new Error('내보내기 요청 실패: ' + JSON.stringify(result));
    return result;
  },
  send: body => chat.sendText(roomId, body)
};
      if (text.startsWith('!')) {
        try {
          if (await require('../manage/commands-v2').handle(context)) return;
        } catch (error) {
          console.error('[MANAGE COMMAND ERROR]', error);
          try { await context.send('❌ 관리 명령 처리 실패. Railway 로그를 확인해 주세요.'); }
          catch (sendError) { console.error('[MANAGE SEND ERROR]', sendError); }
          return;
        }
      }
      if (text === "!테스트") {
        await require("../manage/attendance-image/command")
          .handleTest(client, context);
        return;
      }
      
if(gameAliases.isGameCommand(text) && text!=='!게임on' && text!=='!게임off'){
  const started=Date.now();
  await game.message({...context,msg,chat});
  const elapsed=Date.now()-started;
  if(elapsed>=800)console.warn('[GAME COMMAND SLOW]',{command:text.split(/\s+/,1)[0],elapsedMs:elapsed});
  // Preserve management chat-count statistics without delaying the game reply.
  // This path cannot invoke management commands: aliases are game-only.
  Promise.resolve().then(()=>management.message(context))
    .catch(error=>console.error('[GAME CHAT COUNT]',error));
  return;
}

if (await require('./event-settings').handle({
  client,roomId,msg,text,send:context.send
})) return;

if (text === '!이벤인원테스트') {
  await require('./event-member-test').handle({client, roomId, msg, send: context.send});
  return;
}

if (text === '!이벤추첨테스트') {
  await require('./event-draw-test').handle({
    client, roomId, msg, send: context.send,
    mention: (id, name) => {
      if (typeof chat?.mention !== 'function') return null;
      return chat.mention(id, name, roomId);
    }
  });
  return;
}

      if (text === '!이벤트시작' || text === '!이벤트중지') {
        const event=require('./event-reaction-test');
        const commandArgs={
          client,roomId,msg,send:context.send,
          mention:(id,name)=>typeof chat?.mention==='function'
            ?chat.mention(id,name,roomId):null
        };
        if(text==='!이벤트시작')await event.startUntilWinner(commandArgs);
        else await event.stopUntilWinner(commandArgs);
        return;
      }

      if (text === '!이벤진행테스트') {
        await require('./event-reaction-test').start({
          client, roomId, msg, send: context.send,
          mention: (id, name) => typeof chat?.mention === 'function' ? chat.mention(id, name, roomId) : null
        });
        return;
      }

      if (text === '!게임on' || text === '!게임off') {
        await game.toggle(context);
        return;
      }

      if (!gameAliases.isGameCommand(text) && await management.message(context)) return;
      if (text !== '#주식시간' && await handleExtraMessage(client, ...args)) return;
      if (/^#출석(?:확인|순위)?(?:\s|$)/.test(text)) return;
      await game.message({ ...context, msg, chat });
    } catch (err) { console.error('[HZ NEW] 메시지 처리 실패:', err); }
  });
}
module.exports = { attachRouter };
