'use strict';

// Room-specific VoiceRoom switch. Missing configuration defaults to OFF.
// This only controls requests originating in Railway; Noa and KakaoTalk
// still require an authenticated Android session and server-side privileges.
const { getPool } = require('./db');

const ACTION_COMMAND = /^[#!]?(?:보룸참여|보룸참가|보룸퇴장|보룸스피커받기|보룸진행자받기|보룸켜기|보룸시작|보룸끄기|보룸종료시험|보룸종료|보이스룸참여|보이스룸참가|보이스룸퇴장|보이스룸스피커받기|보이스룸진행자받기|보이스룸켜기|보이스룸시작|보이스룸끄기|보이스룸종료시험|보이스룸종료)(?=$|\s|[.!。])/;

function isActionCommand(text) {
  return ACTION_COMMAND.test(String(text ?? '').trim());
}

// Only the VOX create command is exempt from the room's voice ON/OFF
// switch when the real sending account equals the connected bot account.
const CREATE_COMMAND = /^[#!]?(?:보룸시작|보룸켜기|보이스룸시작|보이스룸켜기)(?=$|\s|[.!。])/;
function isCreateCommand(text) {
  return CREATE_COMMAND.test(String(text ?? '').trim());
}

async function enabled(roomId, query = (sql, params) => getPool().query(sql, params)) {
  const room = String(roomId ?? '');
  if (!/^[1-9]\d{0,23}$/.test(room)) return false;
  const result = await query(
    "SELECT data->>'voiceRoomEnabled' AS voice_enabled FROM hz_rooms WHERE room_id=$1",
    [room],
  );
  return result?.rows?.[0]?.voice_enabled === 'true';
}

// Bot-account participation and role acceptance are independent of the
// customer-facing room web toggle. The real VOX server may still reject them.
const BOT_VOICE_COMMAND=/^[#!]?(?:보룸참가|보룸참여|보룸참가상태|보룸참여상태|보룸스피커받기|보룸진행자받기|보이스룸참가|보이스룸참여|보이스룸참가상태|보이스룸참여상태|보이스룸스피커받기|보이스룸진행자받기)(?=$|\s|[.!。])/;
function isBotVoiceCommand(text){
  return isCreateCommand(text)||BOT_VOICE_COMMAND.test(String(text??'').trim());
}

module.exports = { enabled, isActionCommand, isCreateCommand, isBotVoiceCommand };
