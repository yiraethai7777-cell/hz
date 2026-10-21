'use strict';

const { getPool } = require('../shared/db');
const { mentions } = require('./targets');

const MORE = '\u200b'.repeat(1000);
const COMMANDS = Object.freeze({
  '#멘션감지켜기': ['mentionAlertsEnabled', true, '멘션 감지'],
  '#멘션감지끄기': ['mentionAlertsEnabled', false, '멘션 감지'],
  '#프로필변경켜기': ['profileAlertsEnabled', true, '프로필 변경 알림'],
  '#프로필변경끄기': ['profileAlertsEnabled', false, '프로필 변경 알림']
});

function alertsEnabled(flags, key) {
  return !!flags && flags.manage === true && flags.locked !== true &&
    flags[key] !== false;
}

function allowedToConfigure({ senderType, isBotAccount, userId }) {
  if (isBotAccount || [1, 4].includes(Number(senderType))) return true;
  const ownerIds = [
    process.env.HZ_OWNER_ID, process.env.HZ_OWNER_IDS, process.env.GL_OWNER_ID
  ].filter(Boolean).join(',');
  return ownerIds.split(/[\s,;]+/).includes(String(userId));
}

function safeName(value) {
  return String(value || '알 수 없음')
    .replace(/[\u0000-\u001f\u007f\u200b-\u200d]/g, '')
    .trim().slice(0, 70) || '알 수 없음';
}

function formatKoreanTime(date) {
  const parsed = new Date(date);
  if (!Number.isFinite(parsed.getTime())) return '시간 확인 불가';
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
    hour: 'numeric', minute: '2-digit', hour12: true
  }).formatToParts(parsed);
  const part = type => parts.find(x => x.type === type)?.value || '';
  return part('month') + '.' + part('day') + ' ' + part('dayPeriod') +
    ' ' + part('hour') + ':' + part('minute');
}

function formatMentionNotice(userId, targetName, records) {
  const name = safeName(targetName);
  const id = String(userId);
  // KakaoForge understands these markers as a native mention, not plain @text.
  const target = /^\d{4,}$/.test(id)
    ? '\u0002' + id + '\u0003' + name + '\u0004'
    : '@' + name;
  const lines = records.map((record, index) =>
    String(index + 1).padStart(2, '0') + '  ' +
    formatKoreanTime(record.created_at) + '\n' +
    '   보낸 사람  ' + safeName(record.sender_name || record.sender_id) + '\n' +
    '   받은 사람  ' + name
  );
  return '🔔 NEXUS | MENTION\n' +
    target + '님, 부재중 멘션이 ' + records.length + '건 있습니다.\n' +
    MORE + '\n\nNEXUS / MENTION HISTORY\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    lines.join('\n────────────────────\n') +
    '\n━━━━━━━━━━━━━━━━━━━━\nNEXUS · AUTOMATED NOTIFICATION';
}

async function handleAlertCommand(context, suppliedPool) {
  const command = String(context.text || '').trim();
  if (command !== '#감지상태' && !Object.hasOwn(COMMANDS, command)) return false;
  const roomId = String(context.roomId);
  const db = suppliedPool || getPool();

  if (command === '#감지상태') {
    const result = await db.query('SELECT data FROM hz_rooms WHERE room_id=$1', [roomId]);
    const flags = result.rows[0]?.data || {};
    const state = key => flags[key] === false ? 'OFF' : 'ON';
    const operational = flags.manage === true && flags.locked !== true;
    await context.send(
      '🔔 NEXUS | 감지 상태\n' +
      '멘션 감지: ' + state('mentionAlertsEnabled') + '\n' +
      '프로필 변경 알림: ' + state('profileAlertsEnabled') + '\n' +
      '관리 기능: ' + (operational ? '작동 중' : '중지 또는 잠금') + '\n' +
      '※ 관리 기능이 작동 중일 때 알림을 전송합니다.'
    );
    return true;
  }

  if (!allowedToConfigure(context)) {
    await context.send('⛔ 방장·부방장 또는 봇 관리자만 감지 설정을 변경할 수 있습니다.');
    return true;
  }

  const [key, enabled, label] = COMMANDS[command];
  await db.query(
    'INSERT INTO hz_rooms(room_id,data) ' +
    'VALUES($1,jsonb_build_object($2::text,$3::boolean)) ' +
    'ON CONFLICT(room_id) DO UPDATE SET ' +
    'data=jsonb_set(hz_rooms.data,ARRAY[$2::text],to_jsonb($3::boolean),true),' +
    'updated_at=NOW()',
    [roomId, key, enabled]
  );
  await context.send('✅ ' + label + ' ' + (enabled ? 'ON' : 'OFF') +
    '\n채팅방별 설정이 저장되었습니다.');
  return true;
}

async function processMentionAlerts(context, suppliedPool) {
  const msg = context.msg;
  if (!msg?.room?.id || !context.userId || context.isBotAccount) return;
  const roomId = String(context.roomId);
  const userId = String(context.userId);
  const db = suppliedPool || getPool();
  const state = await db.query('SELECT data FROM hz_rooms WHERE room_id=$1', [roomId]);
  if (!alertsEnabled(state.rows[0]?.data, 'mentionAlertsEnabled')) return;

  // Only genuine Kakao mention metadata is accepted; ordinary @name text is ignored.
  const detected = mentions(msg);
  const unique = new Set();
  const botId = String(context.botId ?? '');
  const logId = msg.message?.logId ?? msg.logId ?? msg.message?.id ?? msg.id;
  const sourceMessageId = logId == null || String(logId) === '0' ? null : String(logId);

  for (const mention of detected) {
    const targetId = String(mention.id);
    if (targetId === userId || targetId === botId || unique.has(targetId)) continue;
    unique.add(targetId);
    await db.query(
      'INSERT INTO hz_mention_alerts' +
      '(room_id,target_id,sender_id,sender_name,source_message_id) ' +
      'VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [roomId, targetId, userId, safeName(context.userName), sourceMessageId]
    );
  }

  // Claim up to 20 older alerts atomically. Release them if sending fails.
  const pending = await db.query(
    'WITH picked AS (' +
    ' SELECT id FROM hz_mention_alerts' +
    ' WHERE room_id=$1 AND target_id=$2 AND notified_at IS NULL' +
    ' ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED' +
    ') UPDATE hz_mention_alerts AS alerts SET notified_at=NOW()' +
    ' FROM picked WHERE alerts.id=picked.id' +
    ' RETURNING alerts.id,alerts.sender_id,alerts.sender_name,alerts.created_at',
    [roomId, userId]
  );
  if (!pending.rows.length) return;

  try {
    await context.send(formatMentionNotice(userId, context.userName, pending.rows));
  } catch (error) {
    try {
      await db.query(
        'UPDATE hz_mention_alerts SET notified_at=NULL ' +
        'WHERE room_id=$1 AND id=ANY($2::bigint[])',
        [roomId, pending.rows.map(row => row.id)]
      );
    } catch (restoreError) {
      console.error('[NEXUS MENTION] 알림 복구 실패:', restoreError);
    }
    throw error;
  }
}

module.exports = {
  alertsEnabled, allowedToConfigure, formatKoreanTime,
  formatMentionNotice, handleAlertCommand, processMentionAlerts
};
