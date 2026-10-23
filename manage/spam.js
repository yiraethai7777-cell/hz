
'use strict';

const versions = new Map();

const WINDOW_MS = 5000;
const DUPLICATE_WARNING_COUNT = 4;
const RATE_WARNING_COUNT = 5;
const BAN_COUNT = 10;

function reset(room) {
  const key = String(room);
  versions.set(key, (versions.get(key) || 0) + 1);
}

function clean(value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(clean);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter(k => !/^(log_?id|message_?id|timestamp|sentAt|createdAt)$/i.test(k))
      .map(k => [k, clean(value[k])])
  );
}

function fingerprint(msg, text) {
  const type = Number(msg.message?.type ?? msg.type ?? 1);

  if ([12, 20, 25].includes(type)) {
    let attachment = msg.attachmentsRaw;

    if (!attachment?.length) {
      attachment = msg.raw?.chatLog?.attachment ?? msg.raw?.attachment;
    }

    if (typeof attachment === 'string') {
      try {
        attachment = JSON.parse(attachment);
      } catch {
        return '';
      }
    }

    if (!attachment || (Array.isArray(attachment) && !attachment.length)) {
      return '';
    }

    return 'E:' + type + ':' + JSON.stringify(clean(attachment));
  }

  const value = String(text || '').normalize('NFKC').trim();

  return [1, 26].includes(type) && value
    ? 'T:' + value
    : '';
}

function withinWindow(timestamps, now) {
  return (timestamps || []).filter(
    timestamp => now >= timestamp && now - timestamp < WINDOW_MS
  );
}

async function check(ctx, msg, chat, rid, uid, name, text, isSelf, flags) {
  const room = String(rid);
  const user = String(uid);
  const key = room + ':' + user;

  // 봇 본인, 관리자, 관리 기능 비활성화 상태는 검사하지 않음
  if (
    isSelf ||
    Number(msg.sender?.type) === 8 ||
    ctx.isOwnerType(msg.sender?.type) ||
    !flags.manage ||
    flags.locked
  ) {
    ctx.spamState.delete(key);
    return false;
  }

  // 해당 방의 도배 감지 설정 확인
  const settings = await ctx.pool.query(
    'SELECT spam_enabled FROM gl_manage_rooms WHERE room_id=$1',
    [room]
  );

  if (settings.rows[0]?.spam_enabled === false) {
    ctx.spamState.delete(key);
    return false;
  }

  const fp = fingerprint(msg, text);
  const revision = versions.get(room) || 0;
  const old = ctx.spamState.get(key);
  const sameRevision = old?.revision === revision;

  // 동일 메시지 이벤트 중복 처리 방지
  const messageId = msg.id ?? msg.message?.id ?? msg.logId;
  const seen = sameRevision ? (old.seen || []) : [];

  if (messageId != null && seen.includes(String(messageId))) {
    return false;
  }

  const now = Date.now();

  // 최근 5초 안에 보낸 전체 메시지 횟수
  const recentMessages = withinWindow(
    sameRevision ? old.timestamps : [],
    now
  );

  recentMessages.push(now);

  // 동일한 글·이모티콘이 연속으로 나온 횟수
  // 다른 내용이 나오면 연속 횟수를 새로 계산
  const sameTimestamps =
    fp && sameRevision && old.fp === fp
      ? withinWindow(old.sameTimestamps, now)
      : [];

  if (fp) {
    sameTimestamps.push(now);
  }

  // 5초 안에 이미 경고를 받았다면 중복 경고 방지
  const previousWarningAt = sameRevision ? old.warnedAt : null;

  const warnedAt =
    previousWarningAt != null &&
    now >= previousWarningAt &&
    now - previousWarningAt < WINDOW_MS
      ? previousWarningAt
      : null;

  const cur = {
    fp: fp || '',
    revision,
    count: sameTimestamps.length,
    sameTimestamps,
    timestamps: recentMessages.slice(-BAN_COUNT),
    warnedAt,
    seen: messageId == null
      ? seen
      : [...seen, String(messageId)].slice(-20)
  };

  ctx.spamState.set(key, cur);

  // 경고 조건
  const duplicateWarning =
    cur.count === DUPLICATE_WARNING_COUNT;

  if (duplicateWarning && cur.warnedAt == null) {
    const reason = '동일 글·이모티콘 4회 연속 도배 (5초 이내)';

    await ctx.pool.query(
      'INSERT INTO gl_manage_warnings(room_id,user_id,user_name,reason,issuer_id) VALUES($1,$2,$3,$4,$5)',
      [
        room,
        user,
        name,
        reason,
        String(ctx.globalBotId)
      ]
    );

    await ctx.pool.query(
      "INSERT INTO gl_manage_actions(room_id,actor_id,target_id,action,detail) VALUES($1,$2,$3,'AUTO_WARNING',$4)",
      [
        room,
        String(ctx.globalBotId),
        user,
        reason + ': 경고 1개'
      ]
    );

    await ctx.send(
      chat,
      room,
      `⚠️ ${name}님에게 경고 1개를 부여했습니다.\n이유: ${reason}`
    );

    cur.warnedAt = now;
  }

  // 벤 조건
  const duplicateBan = cur.count === BAN_COUNT;
  if (duplicateBan) {
    const reason = '동일 글·이모티콘 10회 연속 도배 (5초 이내)';

    try {
      await ctx.kickMember(msg, user);

      await ctx.pool.query(
        "INSERT INTO gl_manage_actions(room_id,actor_id,target_id,action,detail) VALUES($1,$2,$3,'AUTO_BAN',$4)",
        [
          room,
          String(ctx.globalBotId),
          user,
          reason
        ]
      );

      await ctx.send(
        chat,
        room,
        `🚫 ${name}님을 벤했습니다.\n이유: ${reason}`
      );
    } catch (e) {
      await ctx.send(
        chat,
        room,
        `⚠️ ${name}님의 도배를 감지했지만 벤에 실패했습니다.\n이유: ${reason}\n봇의 방장·부방장 권한을 확인해 주세요.`
      );

      console.error('[NEXUS AUTO BAN]', e.message);
    }

    ctx.spamState.delete(key);
    return true;
  }

  return false;
}

module.exports = {
  check,
  fingerprint,
  reset
};
