'use strict';

// An isolated comparison against the Iris-compatible Noa HTTP API.
// This adapter requires a separate, rooted Android/Redroid KakaoTalk instance;
// it is NOT a replacement for the Railway-only VOX protocol.
const COMMAND = /^[#!]?(보룸아이리스시작|보룸아이리스상태|보룸아이리스참가|보룸아이리스퇴장)(?=$|\s|[.!。])/;
const pending = new Set();

function commandOf(text) {
  return COMMAND.exec(String(text ?? '').trim());
}

async function handle({client, roomId, msg, text, send}) {
  const match = commandOf(text);
  if (!match) return false;
  const reply = async value => send(value);
  const botId = String(client?.userId ?? '');
  const senderId = String(msg?.sender?.id ?? msg?.senderId ?? '');
  if (msg?.room?.isOpenChat !== true) {
    await reply('❌ Iris/Noa 보이스룸 실험은 오픈채팅방에서만 실행할 수 있습니다.');
    return true;
  }
  // The remote Android actor may be a different account. Only the Railway
  // bot account can command it; do not infer authorization from sender.type.
  if (!botId || botId === '0' || botId !== senderId) {
    await reply('❌ Iris/Noa 실험 명령은 Railway 봇 계정만 사용할 수 있습니다.');
    return true;
  }
  const room = String(roomId ?? '');
  if (!/^[1-9]\d{0,23}$/.test(room)) {
    await reply('❌ 올바른 오픈채팅방 ID가 필요합니다.');
    return true;
  }
  const bridge = client?.voiceRoomIrisAdapter;
  if (!bridge) {
    await reply('⚠️ Iris/Noa 별도 Android 연동이 준비되지 않았습니다.\n' +
      'NEXI_VOICE_NOA_URL, NEXI_VOICE_NOA_TOKEN, NEXI_VOICE_NOA_ACTOR_USER_ID 설정이 필요합니다.\n' +
      '기존 Railway #보룸시작은 변경되지 않았습니다.');
    return true;
  }

  const op = match[1].slice('보룸아이리스'.length);
  if (pending.has(room)) {
    await reply('⏳ 이 방의 Iris/Noa 요청을 이미 처리 중입니다.');
    return true;
  }
  pending.add(room);
  try {
    const state = await bridge.status({roomId:room, botUserId:botId});
    if (op === '상태') {
      const description = state.statusKnown !== true ? 'Android VOX 상태 확인 불가'
        : state.localActive === true ? 'Android 앱에서 이 방의 음성 세션 감지'
        : state.localBusyOtherRoom === true ? 'Android 앱이 다른 방의 음성 세션을 사용 중'
        : 'Android 앱에서 이 방의 활성 음성 세션 확인 안 됨';
      await reply('🎙️ Iris/Noa 보이스룸 상태\n' + description +
        '\n※ Android 로컬 상태이며 카카오톡 서버에서 30초 이상 유지된 증거는 아닙니다.');
      return true;
    }
    if (state.statusKnown !== true) {
      await reply('⚠️ Noa의 Android VOX 상태를 확인할 수 없어 요청을 보내지 않았습니다.');
      return true;
    }
    if (op === '시작' || op === '참가') {
      if (state.localActive) {
        await reply('🎙️ Noa 실행 계정이 이 방의 음성 세션에 이미 참가 중입니다.');
        return true;
      }
      if (state.localBusyOtherRoom) {
        await reply('⚠️ Noa 실행 계정이 다른 방의 음성 세션을 사용 중입니다. 기존 세션은 종료하지 않았습니다.');
        return true;
      }
      // If the Railway direct transport is still in an active call, avoid
      // starting an accidental second host session for the same chat.
      const direct = client?.voiceRoomAdapter;
      if (op === '시작' && direct && typeof direct.status === 'function') {
        const directState = await direct.status({roomId:room});
        if (directState?.localActive === true) {
          await reply('⚠️ Railway 직접 VOX 세션이 진행 중입니다. 중복 생성을 막았습니다.');
          return true;
        }
      }
    }
    let result;
    if (op === '시작') {
      const {parseTitle} = require('./voice-room');
      const title = parseTitle(String(text).trim().slice(match[0].length));
      result = await bridge.create({roomId:room, title, botUserId:botId});
    } else if (op === '참가') {
      result = await bridge.join({roomId:room, botUserId:botId});
    } else if (op === '퇴장') {
      if (!state.localActive) {
        await reply('⚠️ Noa 실행 계정이 이 방의 보이스룸에 참가 중인 것으로 확인되지 않았습니다.');
        return true;
      }
      result = await bridge.leave({roomId:room, botUserId:botId});
    } else {
      return false;
    }
    if (result?.requestAccepted === true) {
      await reply('📨 Iris/Noa ' + (op==='시작'?'생성':op) + ' 요청이 접수되었습니다.\n' +
        '실제 보이스룸 상태는 #보룸아이리스상태로 확인해 주세요.\n' +
        '※ 30초 이상 유지 여부는 아직 검증되지 않았습니다.');
    } else {
      await reply('⚠️ Iris/Noa 요청 결과를 검증하지 못했습니다. 실제 앱 상태를 확인해 주세요.');
    }
  } catch {
    // Never expose the API URL, bearer token, personal IDs or remote error text.
    console.warn('[VOICE IRIS] operation failed (details redacted)');
    await reply('❌ Iris/Noa 요청 실패. Android 실행 상태·계정 권한 및 Railway 연결을 확인해 주세요.');
  } finally {
    pending.delete(room);
  }
  return true;
}

module.exports = {commandOf, handle};
