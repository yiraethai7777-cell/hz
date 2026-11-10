'use strict';
const LosslessJSON=require('lossless-json');
function exactId(v){
 if(typeof v==='number')return Number.isSafeInteger(v)&&v>0?String(v):'';
 if(typeof v==='string')return /^\d+$/.test(v)&&v!=='0'?v:'';
 if(typeof v==='bigint')return v>0n?String(v):'';
 if(v&&typeof v==='object')return exactId(typeof v.value==='string'?v.value:v.toString());
 return '';
}
async function init(db){
 await db.query(`CREATE TABLE IF NOT EXISTS gl_leave_replies(
 room_id TEXT NOT NULL,log_id TEXT NOT NULL,bot_id TEXT NOT NULL,target_id TEXT NOT NULL,
 target_name TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(room_id,log_id))`);
 await db.query(`CREATE TABLE IF NOT EXISTS gl_leave_ban_confirmations(
 room_id TEXT NOT NULL,actor_id TEXT NOT NULL,notice_log_id TEXT NOT NULL,
 bot_id TEXT NOT NULL,target_id TEXT NOT NULL,target_name TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(room_id,actor_id))`);
}

function displayMember(name,userId){
 const id=exactId(userId),clean=String(name||id||'알 수 없음').replace(/[\u0002-\u0004]/g,'').trim()||id||'알 수 없음';
 return {id,clean,mention:id?'\u0002'+id+'\u0003'+clean+'\u0004':'@'+clean};
}
function renderMemberTemplate(template,{name,userId,joins=0,leaves=0,warnings=0,warningReasons=[],roomName='',time='',profileLink=''}){
 const {id,clean,mention}=displayMember(name,userId);
 const values={
  '(이름)':clean,'(멘션)':mention,'(아이디)':id||'확인 불가',
  '(해시)':id||'확인 불가','(방이름)':String(roomName||''),
  '(날짜)':String(time||''),'(옾링)':String(profileLink||'확인 불가'),
  '(입장횟수)':String(Number(joins)||0),
  '(퇴장횟수)':String(Number(leaves)||0),
  '(경고횟수)':String(Number(warnings)||0),
  '(경고사유)':Array.isArray(warningReasons)&&warningReasons.length?warningReasons.join('\n'):'없음'
 };
 return String(template).replace(/\((?:입장횟수|퇴장횟수|경고횟수|경고사유|이름|멘션|아이디|해시|방이름|날짜|옾링)\)/g,variable=>values[variable]);
}
// Keep the existing Kakao mention token, the archived reply-to-ban mapping,
// and the 1,200-character native KakaoTalk "전체보기" folding spacer.
const MEMBER_NOTICE_FOLD='\u200b'.repeat(1200);
const MEMBER_NOTICE_BRAND='💛 카카오톡 관리 매니저';
const MEMBER_NOTICE_SIGNOFF='KakaoTalk Manager';
const count=value=>Math.max(0,Number(value)||0);

// KakaoTalk truncates the zero-width spacer behind its native "전체보기" action.
// Only the person's entrance/departure line appears before the spacer.
// Keep the detailed body in the same message, so replying to a departure notice
// continues to work with the original message log ID.
function foldMemberNotice(kind,{name,userId},details){
 const {mention}=displayMember(name,userId);
 if(kind!=='join'&&kind!=='leave')throw Error('알 수 없는 입퇴장 유형입니다.');
 const line='👋 '+mention+'님이 '+(kind==='join'?'입장했습니다.':'퇴장했습니다.');
 return line+'\n'+MEMBER_NOTICE_FOLD+'\n'+String(details||'');
}
function joinNotice({
 name,userId,roomName,joins=0,leaves=0,time,
 profileLink='',profileType=null,profileImage='',bans=0,warnings=0,detail=''
}){
 const {id,clean}=displayMember(name,userId);
 const details=[
  MEMBER_NOTICE_BRAND+' | 입장 상세',
  '━━━━━━━━━━━━━━━━━━',
  '👤 닉네임 : '+clean,
  '🆔 사용자 ID : '+(id||'확인 불가'),
  '📊 입장 / 퇴장 : '+count(joins)+'회 / '+count(leaves)+'회',
  '⚠️ 누적 경고 : '+count(warnings)+'회',
  '',
  '📅 입장 시각',
  time||'확인 불가',
  '',
  '🔗 오픈프로필',
  profileLink||'확인 불가',
  '',
  '🛡️ 강퇴 기록 : '+count(bans)+'회',
  '',
  '━━━━━━━━━━━━━━━━━━',
  '💛 즐거운 채팅 부탁드립니다!',
  MEMBER_NOTICE_SIGNOFF
 ].join('\n')+(detail?'\n\n💬 '+detail:'');
 return foldMemberNotice('join',{name,userId},details);
}
function leaveNotice({
 name,userId,joins=0,leaves=0,time,detail='',
 profileLink='',profileType='확인 불가',profileImage='',
 joinedAt=null,stay='확인 불가',bans=0,warnings=0
}){
 const {id,clean}=displayMember(name,userId);
 const details=[
  MEMBER_NOTICE_BRAND+' | 퇴장 상세',
  '━━━━━━━━━━━━━━━━━━',
  '👤 닉네임 : '+clean,
  '🆔 사용자 ID : '+(id||'확인 불가'),
  '📊 입장 / 퇴장 : '+count(joins)+'회 / '+count(leaves)+'회',
  '⚠️ 누적 경고 : '+count(warnings)+'회',
  '',
  '📅 입장 시각',
  joinedAt||'확인 불가',
  '',
  '📅 퇴장 시각',
  time||'확인 불가',
  '',
  '⏱️ 체류 시간',
  stay||'확인 불가',
  '',
  '🛡️ 강퇴 기록 : '+count(bans)+'회',
  '',
  '━━━━━━━━━━━━━━━━━━',
  '🔨 퇴장 알림에 답장으로',
  'k 또는 p 입력 시 강퇴 확인 요청',
  '(방장·부방장·지정 관리자)',
  '',
  MEMBER_NOTICE_SIGNOFF
 ].join('\n')+(detail?'\n\n💬 '+detail:'');
 return foldMemberNotice('leave',{name,userId},details);
}

function profileNotice(change,time){
  return `👤 ${change.newName}님이 프로필을 변경했습니다.\n${'\u200b'.repeat(1200)}\n${change.oldName||'확인 불가'} → ${change.newName||'확인 불가'}\n예전 옾링: ${change.oldOpenLink||'확인된 링크 없음'}\n현재 옾링: ${change.newOpenLink||'확인된 링크 없음'}\n시간: ${time}`;
}
async function record(db,{roomId,botId,userId,name,result}){
 const target=exactId(userId),bot=exactId(botId);
 if(!target||!bot||target===bot)return;
 for(const response of Array.isArray(result)?result:[result]){
  const log=exactId(response?.body?.logId??response?.logId);
  if(!log)continue;
  await db.query(`INSERT INTO gl_leave_replies(room_id,log_id,bot_id,target_id,target_name)
   VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[String(roomId),log,bot,target,String(name||target)]);
 }
}
function replyReference(msg,botId){
 if(!msg)return null;
 const raw=msg.raw?.chatLog??msg.raw?.chatlog??msg.raw?.chat??msg.raw;
 // Kakao comments are ordinary text messages with a thread root, not type-26 quotes.
 // The root is accepted only if the database maps it to this bot's leave notice in this room.
 const thread=exactId(raw?.threadId??raw?.tid??raw?.thread??msg.raw?.threadId??msg.message?.threadId??msg.threadId);
 if(thread)return thread;
 if(Number(msg?.message?.type??msg?.type)!==26)return null;
 const roots=[...(msg.attachmentsRaw||[]),msg.message?.attachment,raw?.attachment,raw?.extra];
 for(let root of roots){
  if(typeof root==='string'){try{root=LosslessJSON.parse(root)}catch{continue;}}
  for(const v of Array.isArray(root)?root:[root]){
   if(!v||typeof v!=='object')continue;
   const author=exactId(v.src_userId??v.srcUserId);
   const log=exactId(v.src_logId??v.srcLogId);
   if(author===exactId(botId)&&log)return log;
  }
 }
 return null;
}
// Leave-notice reply handling uses two-step confirmation and DB-backed TTL.
async function isLeaveModerator(db,roomId,userId,senderType){
 if([1,4].includes(Number(senderType)))return true;
 const row=await db.query('SELECT 1 FROM gl_manage_admins WHERE room_id=$1 AND user_id=$2',[roomId,userId]);
 return row.rowCount>0;
}
async function handle(context,db){
 const {text,msg,roomId,userId,senderType,botId,send,kick}=context;
 const command=String(text||'').trim().toLowerCase();
 if(!['k','p','y','n'].includes(command))return false;
 const room=String(roomId),actor=String(userId),bot=String(botId);
 if(command==='y'||command==='n'){
  const pending=await db.query(
   'SELECT notice_log_id,bot_id,target_id,target_name,expires_at FROM gl_leave_ban_confirmations WHERE room_id=$1 AND actor_id=$2',
   [room,actor]);
  if(!pending.rows.length)return false;
  if(!await isLeaveModerator(db,room,actor,senderType)){
   await send('⛔ 강퇴 확인 권한이 없습니다.');return true;
  }
  // Single-use approval: concurrent y messages never kick twice.
  const claimed=await db.query(
   'DELETE FROM gl_leave_ban_confirmations WHERE room_id=$1 AND actor_id=$2 RETURNING notice_log_id,bot_id,target_id,target_name,expires_at',
   [room,actor]);
  const request=claimed.rows[0];
  if(!request){await send('ℹ️ 이미 처리된 강퇴 확인 요청입니다.');return true;}
  if(new Date(request.expires_at).getTime()<=Date.now()){
   await send('⌛ 강퇴 확인 시간이 만료됐습니다. 퇴장 알림에 다시 k 또는 p로 답장해 주세요.');
   return true;
  }
  if(command==='n'){
   await send('✅ '+request.target_name+'님의 강퇴 요청을 취소했습니다.');return true;
  }
  if(request.target_id===actor||request.target_id===bot){
   await send('⛔ 봇 또는 명령 실행자 본인은 강퇴할 수 없습니다.');return true;
  }
  const inProgress=await db.query(
   "UPDATE gl_leave_replies SET state='sending' WHERE room_id=$1 AND log_id=$2 AND bot_id=$3 AND target_id=$4 AND state='pending' RETURNING target_id",
   [room,request.notice_log_id,request.bot_id,request.target_id]);
  if(!inProgress.rows.length){
   await send('ℹ️ 이미 강퇴 요청이 처리 중이거나 완료된 퇴장 알림입니다.');return true;
  }
  try{
   if(typeof kick!=='function')throw Error('강퇴 API를 사용할 수 없습니다.');
   await kick(request.target_id);
  }catch(error){
   await db.query(
    "UPDATE gl_leave_replies SET state='pending' WHERE room_id=$1 AND log_id=$2 AND bot_id=$3 AND state='sending'",
    [room,request.notice_log_id,request.bot_id]);
   await send('❌ 강퇴 요청 실패: '+String(error?.message||error));return true;
  }
  await db.query(
   "UPDATE gl_leave_replies SET state='done' WHERE room_id=$1 AND log_id=$2 AND bot_id=$3 AND state='sending'",
   [room,request.notice_log_id,request.bot_id]);
  try{
   await db.query(
    'INSERT INTO gl_manage_actions(room_id,actor_id,target_id,action,detail) VALUES($1,$2,$3,$4,$5)',
    [room,actor,request.target_id,'KICK','퇴장 알림 y 확인 후 강퇴']);
  }catch(error){console.error('[LEAVE CONFIRMED KICK LOG]',String(error?.message||error));}
  await send('🚫 '+request.target_name+'님을 강퇴했습니다.\n사용자 ID: '+request.target_id);
  return true;
 }
 // k/p must reply to an authentic, previously indexed bot departure notice.
 const log=replyReference(msg,botId);
 if(!log)return false;
 if(!await isLeaveModerator(db,room,actor,senderType)){
  await send('⛔ 방장·부방장 또는 지정 관리자만 사용할 수 있습니다.');return true;
 }
 const found=await db.query(
  'SELECT target_id,target_name,state FROM gl_leave_replies WHERE room_id=$1 AND log_id=$2 AND bot_id=$3',
  [room,log,bot]);
 const row=found.rows[0];if(!row)return false;
 if(row.target_id===actor||row.target_id===bot){
  await send('⛔ 봇 또는 명령 실행자 본인은 강퇴할 수 없습니다.');return true;
 }
 if(row.state!=='pending'){
  await send(row.state==='done'?'이미 강퇴 요청을 완료한 퇴장 알림입니다.':'이 퇴장 알림의 강퇴 요청이 처리 중입니다.');
  return true;
 }
 await db.query(
  "INSERT INTO gl_leave_ban_confirmations(room_id,actor_id,notice_log_id,bot_id,target_id,target_name,expires_at)"+
  " VALUES($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '60 seconds')"+
  " ON CONFLICT(room_id,actor_id) DO UPDATE SET"+
  " notice_log_id=EXCLUDED.notice_log_id,bot_id=EXCLUDED.bot_id,target_id=EXCLUDED.target_id,"+
  " target_name=EXCLUDED.target_name,expires_at=EXCLUDED.expires_at,created_at=NOW()",
  [room,actor,log,bot,row.target_id,row.target_name]);
 try{
  await send('❓ 정말 '+row.target_name+' 님을 강퇴하시겠습니까?\n✅ 동의: y\n❌ 취소: n\n⏱️ 60초 이내에 입력해 주세요.');
 }catch(error){
  await db.query(
   'DELETE FROM gl_leave_ban_confirmations WHERE room_id=$1 AND actor_id=$2 AND notice_log_id=$3',
   [room,actor,log]);
  throw error;
 }
 return true;
}
module.exports={init,leaveNotice,joinNotice,foldMemberNotice,renderMemberTemplate,profileNotice,record,replyReference,handle};
