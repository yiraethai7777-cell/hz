'use strict';
const {getPool}=require('../shared/db');
const {initAttendance,attend,attendanceRanking}=require('./attendance');
const MORE='\u200b'.repeat(500);
const date=()=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'medium'}).format(new Date());
const key=v=>String(v);
function formatKST(value){
  const d = value ? new Date(value) : new Date();
  const parts = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(d);

  const get = type => parts.find(v => v.type === type)?.value || '';
  return `${get('year')}.${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}

function formatStayDuration(start, end){
  if(!start || !end) return '확인 불가';

  const diff = new Date(end).getTime() - new Date(start).getTime();
  if(!Number.isFinite(diff) || diff < 0) return '확인 불가';

  let sec = Math.floor(diff / 1000);

  const day = Math.floor(sec / 86400);
  sec %= 86400;
  const hour = Math.floor(sec / 3600);
  sec %= 3600;
  const min = Math.floor(sec / 60);

  const out = [];
  if(day) out.push(`${day}일`);
  if(hour) out.push(`${hour}시간`);
  if(min) out.push(`${min}분`);

  return out.length ? out.join(' ') : '1분 미만';
}

async function kickCount(room, user){
  const r = await getPool().query(
    "SELECT count(*)::int AS n FROM gl_manage_actions WHERE room_id=$1 AND target_id=$2 AND action='KICK'",
    [room, user]
  );
  return r.rows[0]?.n || 0;
}
async function init(){await initAttendance();const db=getPool();await require('./leave-reply').init(db);await require('./mention-notify').init(db);await db.query(`
CREATE TABLE IF NOT EXISTS gl_manage_rooms(room_id TEXT PRIMARY KEY,enabled BOOLEAN NOT NULL DEFAULT FALSE,spam_enabled BOOLEAN NOT NULL DEFAULT TRUE,deleted_enabled BOOLEAN NOT NULL DEFAULT FALSE);
CREATE TABLE IF NOT EXISTS gl_manage_admins(room_id TEXT NOT NULL,user_id TEXT NOT NULL,PRIMARY KEY(room_id,user_id));
CREATE TABLE IF NOT EXISTS gl_manage_warnings(id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,user_id TEXT NOT NULL,user_name TEXT NOT NULL,reason TEXT NOT NULL,issuer_id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),removed BOOLEAN NOT NULL DEFAULT FALSE);
CREATE INDEX IF NOT EXISTS gl_warning_lookup ON gl_manage_warnings(room_id,user_id,removed);
CREATE TABLE IF NOT EXISTS gl_manage_bans(room_id TEXT NOT NULL,user_id TEXT NOT NULL,added_by TEXT NOT NULL,added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,user_id));
CREATE TABLE IF NOT EXISTS gl_manage_members(room_id TEXT NOT NULL,user_id TEXT NOT NULL,user_name TEXT NOT NULL,joins INTEGER NOT NULL DEFAULT 0,leaves INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(room_id,user_id));
CREATE TABLE IF NOT EXISTS gl_manage_chat_counts(room_id TEXT NOT NULL,user_id TEXT NOT NULL,user_name TEXT NOT NULL,count BIGINT NOT NULL DEFAULT 0,PRIMARY KEY(room_id,user_id));
CREATE TABLE IF NOT EXISTS gl_manage_temp_messages(room_id TEXT NOT NULL,message_id TEXT NOT NULL,user_id TEXT NOT NULL,user_name TEXT NOT NULL,body TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,message_id));
CREATE INDEX IF NOT EXISTS gl_temp_expiry ON gl_manage_temp_messages(created_at);
CREATE TABLE IF NOT EXISTS gl_manage_actions(id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,actor_id TEXT,target_id TEXT,action TEXT NOT NULL,detail TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`);
 await db.query(`
  ALTER TABLE gl_manage_members
  ADD COLUMN IF NOT EXISTS last_joined_at TIMESTAMPTZ;
`);
 // Existing game settings take precedence. Only synchronize the management flag;
 // legacy game state and all stored records remain intact.
 await db.query(`INSERT INTO hz_rooms(room_id,data)
 SELECT room_id,jsonb_build_object('manage',enabled) FROM gl_manage_rooms
 ON CONFLICT(room_id) DO UPDATE SET
 data=jsonb_set(hz_rooms.data,'{manage}',EXCLUDED.data->'manage')`);
 await require('./scheduled-notices').init(db);
}
async function enabled(room){
 const r=await getPool().query("SELECT COALESCE((SELECT enabled FROM gl_manage_rooms WHERE room_id=$1),(SELECT (data->>'manage')::boolean FROM hz_rooms WHERE room_id=$1),FALSE) AS enabled",[key(room)]);
 return !!r.rows[0]?.enabled;
}
async function admin(room,user){const owner=process.env.GL_OWNER_ID;if(owner && key(user)===owner)return true;const r=await getPool().query('SELECT 1 FROM gl_manage_admins WHERE room_id=$1 AND user_id=$2',[room,user]);return !!r.rowCount}
async function setEnabled(room,value){
 const db=await getPool().connect();
 try{
  await db.query('BEGIN');
  await db.query('INSERT INTO gl_manage_rooms(room_id,enabled) VALUES($1,$2) ON CONFLICT(room_id) DO UPDATE SET enabled=EXCLUDED.enabled',[room,value]);
  await db.query(`INSERT INTO hz_rooms(room_id,data) VALUES($1,jsonb_build_object('manage',$2::boolean)) ON CONFLICT(room_id) DO UPDATE SET data=jsonb_set(hz_rooms.data,'{manage}',to_jsonb($2::boolean)),updated_at=NOW()`,[room,value]);
  await db.query('COMMIT');
 }catch(e){await db.query('ROLLBACK');throw e}finally{db.release()}
}
async function warnCount(room,user){const r=await getPool().query('SELECT count(*)::int AS n FROM gl_manage_warnings WHERE room_id=$1 AND user_id=$2 AND NOT removed',[room,user]);return r.rows[0].n}
async function log(room,actor,target,action,detail){await getPool().query('INSERT INTO gl_manage_actions(room_id,actor_id,target_id,action,detail) VALUES($1,$2,$3,$4,$5)',[room,actor,target,action,detail])}
// GL_BOT_ONLY_V1
async function message({client,roomId,userId,userName,messageId,text,send,kick,unban,resolveTarget,isBotAccount=false,senderType,botId,msg}){
 const room=key(roomId),user=key(userId),db=getPool(),s=String(text||'').trim();
 if(s==='#관리상태'){await send('🛡️ 관리: '+(await enabled(room)?'작동':'중지'));return true}
 if(s==='#관리작동'||s==='#관리중지'){
  if(!isBotAccount){await send('⛔ 봇 계정만 사용할 수 있습니다.');return true}
  await setEnabled(room,s==='#관리작동');await send('🛡️ 관리 '+(s==='#관리작동'?'작동':'중지')+' 완료');return true
 }
 if(!await enabled(room))return false;
 const roomManager=[1,4].includes(Number(senderType));
 if(s==='#내아이디'){
  await send(roomManager?'🆔 내 아이디: '+user:'⛔ 방장·부방장만 사용할 수 있습니다.');
  return true;
 }
 if(/^#(?:내풀|벤해제)(?:\s|$)/.test(s))return require('./kick-release').handle({roomId:room,userId:user,text:s,msg,senderType,botId,send,kick,unban,resolveTarget},db);
 if(/^#아이디(?:\s|$)/.test(s)&&resolveTarget){
  if(!roomManager){await send('⛔ 방장·부방장만 사용할 수 있습니다.');return true;}
  try{const who=await resolveTarget();await send(who?`🔎 ${who.name}\n사용자 ID: ${who.id}`:'대상 메시지에 답장·댓글을 하거나 실제 멘션 또는 사용자 ID를 지정해 주세요.');}
  catch(e){await send('대상 확인 실패: '+e.message);}return true;
 }
 if(s==='k'&&await require('./leave-reply').handle({roomId:room,userId:user,text:s,msg,senderType,botId,send,kick},db))return true;
 // Count ordinary messages without retaining their text.
 if(!s.startsWith('#')){
  await db.query(`INSERT INTO gl_manage_chat_counts(room_id,user_id,user_name,count) VALUES($1,$2,$3,1) ON CONFLICT(room_id,user_id) DO UPDATE SET count=gl_manage_chat_counts.count+1,user_name=$3`,[room,user,userName]);
  return false;
 }
 const parts=s.split(/\s+/),cmd=parts[0];let target=parts[1],targetRole=0;
 if((cmd==='#출석확인'&&!roomManager&&!isBotAccount)||
    (['#벤기록','#관리로그'].includes(cmd)&&!roomManager)){
  await send('⛔ 방장·부방장'+(cmd==='#출석확인'?' 또는 봇 계정':'')+'만 사용할 수 있습니다.');
  return true;
 }
 if(resolveTarget&&['#kick','#k','#출석확인','#채팅정보','#경고','#경고삭제','#경고초기화','#경고내역','#벤기록'].includes(cmd)){
  const who=await resolveTarget();
  if(who){
   targetRole=Number(who.type)||0;
   const hasId=/^\d{4,}$/.test(parts[1]||''),hasMention=require('./targets').mentions(msg).length===1;
   if(hasId||hasMention)parts[1]=who.id;else parts.splice(1,0,who.id);
   target=who.id;
  }
 }
 

if (cmd === '#출석') {
  console.log('[ATTENDANCE DEBUG] 명령어 진입');

  const result = await attend(room, user, userName);

  console.log('[ATTENDANCE DEBUG] 출석 처리 완료', {
    isNew: result.startsWith('✅ '),
    clientAvailable: typeof client !== 'undefined'
  });

  if (result.startsWith('✅ ')) {
    try {
      console.log('[ATTENDANCE DEBUG] 이미지 전송 시작');

      await require('./attendance-image/automatic')
        .sendAttendanceImage(client, {
          roomId: room,
          userId: user,
          send
        });

      console.log('[ATTENDANCE DEBUG] 이미지 처리 종료');
    } catch (error) {
      console.error('[ATTENDANCE DEBUG] 오류:', error);
    }
  }

  await send(result);
  return true;
}


if (cmd === '#출석순위') {
  await send(await attendanceRanking(room));
  return true;
}

if (cmd === '#출석확인') {
  const t = target || user;
  const r = await db.query(
    "SELECT attended_at FROM hz_new_attendance WHERE room_id=$1 AND user_id=$2 AND attend_date=(NOW() AT TIME ZONE 'Asia/Seoul')::date",
    [room, t]
  );
  await send(
    r.rowCount
      ? '✅ 오늘 출석했습니다.'
      : '📌 오늘 출석 기록이 없습니다.'
  );
  return true;
}

 if(cmd==='#채팅순위'||cmd==='#채팅순위전체'){for(const page of await require('./chat-ranking').messages(db,room,cmd==='#채팅순위전체'))await send(page);return true}
 if(cmd==='#채팅정보'){const r=await db.query('SELECT user_name,count FROM gl_manage_chat_counts WHERE room_id=$1 AND user_id=$2',[room,target||user]);await send(r.rowCount?`💬 ${r.rows[0].user_name}: ${r.rows[0].count}회`:'기록 없음');return true}
 const privileged=['#경고','#경고삭제','#경고초기화','#kick','#k','#관리자추가','#관리자삭제','#도배감지켜기','#도배감지끄기','#삭제감지켜기','#삭제감지끄기'];
 const isRoomManager=Number(senderType)===1||Number(senderType)===4;
 if(privileged.includes(cmd)&&!isBotAccount&&!isRoomManager&&!await admin(room,user)){await send('⛔ 관리 권한이 없습니다.');return true}
 if(cmd==='#경고'){
  if(targetRole===8||target===String(botId)){await send('🤖 오픈채팅봇에는 경고를 주지 않습니다.');return true}
  const n=Number(parts[2]),reason=parts.slice(3).join(' ');if(!target||!Number.isInteger(n)||n<1||n>4||!reason){await send('사용법: #경고 사용자ID 1 사유');return true}
  for(let i=0;i<n;i++)await db.query('INSERT INTO gl_manage_warnings(room_id,user_id,user_name,reason,issuer_id) VALUES($1,$2,$3,$4,$5)',[room,target,target,reason,user]);const count=await warnCount(room,target);await send(`⚠️ ${target} 경고 ${count}회`);if(count>=4&&kick){try{await kick(target);await log(room,user,target,'KICK','경고 4회');await send('🚫 경고 4회 자동 강퇴 요청 완료')}catch(e){await send('강퇴 실패: '+e.message)}}return true
 }
 if(cmd==='#경고내역'){if(!target){await send('사용법: #경고내역 사용자ID');return true}const r=await db.query('SELECT id,reason,created_at FROM gl_manage_warnings WHERE room_id=$1 AND user_id=$2 AND NOT removed ORDER BY id DESC LIMIT 50',[room,target]);await send('⚠️ 경고 내역\n'+r.rows.map(v=>`${v.id}. ${v.reason} (${v.created_at.toISOString()})`).join('\n'));return true}
 if(cmd==='#경고삭제'){if(!target||!/^\d+$/.test(parts[2]||'')){await send('사용법: #경고삭제 사용자ID 경고번호');return true}const r=await db.query('UPDATE gl_manage_warnings SET removed=TRUE WHERE room_id=$1 AND user_id=$2 AND id=$3 AND NOT removed',[room,target,parts[2]]);await send(r.rowCount?'경고 삭제 완료':'해당 경고 없음');return true}
 if(cmd==='#경고초기화'){if(!target)return true;await db.query('UPDATE gl_manage_warnings SET removed=TRUE WHERE room_id=$1 AND user_id=$2',[room,target]);await send('경고 초기화 완료');return true}
 if(cmd==='#kick'||cmd==='#k'){if(!target||!kick){await send('사용법: '+cmd+' 사용자ID (강퇴 API 연결 필요)');return true}try{await kick(target);await log(room,user,target,'KICK','수동 강퇴 요청');await send('🚫 강퇴 요청 완료: '+target)}catch(e){await send('강퇴 실패: '+e.message)}return true}
 if(cmd==='#벤기록'||cmd==='#관리로그'){const r=await db.query(`SELECT actor_id,target_id,action,detail,created_at FROM gl_manage_actions WHERE room_id=$1 AND ($2::text IS NULL OR target_id=$2) ORDER BY id DESC LIMIT 20`,[room,cmd==='#벤기록'?target||null:null]);await send('📜 관리 기록\n'+r.rows.map(v=>`${v.created_at.toISOString()} ${v.action} ${v.target_id||''} (실행자 ${v.actor_id||'자동'})`).join('\n'));return true}
 if(cmd==='#관리자추가'||cmd==='#관리자삭제'){if(!target)return true;if(cmd==='#관리자추가')await db.query('INSERT INTO gl_manage_admins(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[room,target]);else await db.query('DELETE FROM gl_manage_admins WHERE room_id=$1 AND user_id=$2',[room,target]);await send('관리자 설정 완료');return true}
 if(cmd==='#관리자목록'){const r=await db.query('SELECT user_id FROM gl_manage_admins WHERE room_id=$1',[room]);await send('🛡️ 관리자\n'+r.rows.map(v=>v.user_id).join('\n'));return true}
 if(cmd==='#도배감지켜기'||cmd==='#도배감지끄기'){
  const on=cmd==='#도배감지켜기';
  await db.query('INSERT INTO gl_manage_rooms(room_id,enabled,spam_enabled) VALUES($1,TRUE,$2) ON CONFLICT(room_id) DO UPDATE SET spam_enabled=EXCLUDED.spam_enabled',[room,on]);
  require('./spam').reset(room);
  await send(on?'🛡️ 도배 감지를 켰습니다.\n동일 글·이모티콘 연속 4회 → 경고 1개\n연속 10회 → 벤':'⏹️ 도배 감지를 껐습니다.');return true;
 }
 const toggles={'#삭제감지켜기':true,'#삭제감지끄기':false};
 if(Object.hasOwn(toggles,cmd)){
  const on=toggles[cmd];
  await db.query('INSERT INTO gl_manage_rooms(room_id,enabled,deleted_enabled) VALUES($1,TRUE,$2) ON CONFLICT(room_id) DO UPDATE SET deleted_enabled=EXCLUDED.deleted_enabled',[room,on]);
  await send(on?'🗑️ 삭제 감지가 켜졌습니다.':'⏹️ 삭제 감지가 꺼졌습니다.');
  return true;
 }
 return false;
}

async function join({roomId,userId,userName,send}){
  const room = key(roomId);
  const user = key(userId);

  if (!await enabled(room)) return;

  const db = getPool();

  await db.query(`
    INSERT INTO gl_manage_members
      (room_id,user_id,user_name,joins,leaves,last_joined_at)
    VALUES ($1,$2,$3,1,0,NOW())
    ON CONFLICT (room_id,user_id)
    DO UPDATE SET
      joins = gl_manage_members.joins + 1,
      user_name = $3,
      last_joined_at = NOW()
  `, [room,user,userName]);

  const m = await db.query(
    `SELECT joins,leaves,last_joined_at
     FROM gl_manage_members
     WHERE room_id=$1 AND user_id=$2`,
    [room,user]
  );

  const joins = m.rows[0].joins;
  const leaves = m.rows[0].leaves;
  const joinedAt = m.rows[0].last_joined_at;
  const bans = await kickCount(room,user);
  const warnings = await warnCount(room,user);

  const saved=(await db.query('SELECT open_profile_link,last_profile_url FROM hz_members WHERE room_id=$1 AND user_id=$2',[room,user])).rows[0]||{};
  const template=(await db.query("SELECT data->>'joinTemplate' AS value FROM hz_rooms WHERE room_id=$1",[room])).rows[0]?.value;
  if(template){
    const summary=template.includes('(경고사유)')
      ?await require('./warning-summary').read(db,room,user,{includeReasons:true})
      :{warnings,warningReasons:[]};
    await send(require('./leave-reply').renderMemberTemplate(template,{name:userName,userId:user,joins,leaves,...summary,time:formatKST(joinedAt),profileLink:saved.open_profile_link||''}));
    return;
  }
  await send(require('./leave-reply').joinNotice({
    name:userName,userId:user,joins,leaves,time:formatKST(joinedAt),bans,
    profileLink:saved.open_profile_link||'',profileImage:saved.last_profile_url||'',
    profileType:saved.open_profile_link?'오픈프로필':'확인 불가'
  }));
}


async function leave({roomId,userId,userName,send}){
  const room = key(roomId);
  const user = key(userId);

  if (!await enabled(room)) return;

  const db = getPool();

  const before = await db.query(
    `SELECT joins,leaves,last_joined_at
     FROM gl_manage_members
     WHERE room_id=$1 AND user_id=$2`,
    [room,user]
  );

  const lastJoinedAt = before.rows[0]?.last_joined_at || null;

  await db.query(`
    INSERT INTO gl_manage_members
      (room_id,user_id,user_name,joins,leaves)
    VALUES ($1,$2,$3,0,1)
    ON CONFLICT (room_id,user_id)
    DO UPDATE SET
      leaves = gl_manage_members.leaves + 1,
      user_name = $3,
      last_joined_at = NULL
  `,[room,user,userName]);

  const after = await db.query(
    `SELECT joins,leaves
     FROM gl_manage_members
     WHERE room_id=$1 AND user_id=$2`,
    [room,user]
  );

  const joins = after.rows[0].joins;
  const leaves = after.rows[0].leaves;
  const leftAt = new Date();
  const stay = formatStayDuration(lastJoinedAt,leftAt);
  const bans = await kickCount(room,user);
  const warnings = await warnCount(room,user);

  const saved=(await db.query('SELECT open_profile_link,last_profile_url FROM hz_members WHERE room_id=$1 AND user_id=$2',[room,user])).rows[0]||{};
  const template=(await db.query("SELECT data->>'leaveTemplate' AS value FROM hz_rooms WHERE room_id=$1",[room])).rows[0]?.value;
  if(template){
    const summary=template.includes('(경고사유)')
      ?await require('./warning-summary').read(db,room,user,{includeReasons:true})
      :{warnings,warningReasons:[]};
    await send(require('./leave-reply').renderMemberTemplate(template,{name:userName,userId:user,joins,leaves,...summary,time:formatKST(leftAt),profileLink:saved.open_profile_link||''}));
    return;
  }
  await send(require('./leave-reply').leaveNotice({
    name:userName,userId:user,joins,leaves,time:formatKST(leftAt),
    joinedAt:lastJoinedAt?formatKST(lastJoinedAt):'확인 불가',stay,bans,
    profileLink:saved.open_profile_link||'',profileImage:saved.last_profile_url||'',
    profileType:saved.open_profile_link?'오픈프로필':'확인 불가'
  }));
}

async function deleted({roomId,userId,userName,send}){
 if(!await enabled(key(roomId)))return;
  const setting=await getPool().query('SELECT deleted_enabled FROM gl_manage_rooms WHERE room_id=$1',[key(roomId)]);
  if(setting.rows[0]?.deleted_enabled!==true)return;
 await send(userName||userId?`🗑️ ${userName||userId}님이 메시지를 삭제했습니다.`:'🗑️ 누군가 메시지를 삭제했습니다.');
}
async function cleanup(){await getPool().query("DELETE FROM gl_manage_temp_messages WHERE created_at < NOW()-INTERVAL '12 hours'")}
module.exports={init,enabled,message,join,leave,deleted,cleanup};
