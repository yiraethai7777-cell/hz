'use strict';

// Room-specific VoiceRoom switch. Missing configuration defaults to OFF.
// This only controls requests originating in Railway; Noa and KakaoTalk
// still require an authenticated Android session and server-side privileges.
const { getPool } = require('./db');

const ACTION_COMMAND = /^[#!]?(?:보룸아이리스시작|보룸아이리스참가|보룸아이리스퇴장|보룸참가|보룸퇴장|보룸켜기|보룸시작|보룸끄기|보룸종료|보이스룸참가|보이스룸퇴장|보이스룸켜기|보이스룸시작|보이스룸끄기|보이스룸종료)(?=$|\s|[.!。])/;

function isActionCommand(text) {
  return ACTION_COMMAND.test(String(text ?? '').trim());
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

module.exports = { enabled, isActionCommand };
