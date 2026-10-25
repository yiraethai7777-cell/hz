'use strict';
const LosslessJSON=require('lossless-json');
function exactId(v){
 if(typeof v==='number')return Number.isSafeInteger(v)&&v>0?String(v):'';
 if(typeof v==='string')return /^\d+$/.test(v)&&v!=='0'?v:'';
 if(typeof v==='bigint')return v>0n?String(v):'';
 if(v&&typeof v==='object')return exactId(typeof v.value==='string'?v.value:v.toString());
 return '';
}
async function init(db){await db.query(`CREATE TABLE IF NOT EXISTS gl_leave_replies(
 room_id TEXT NOT NULL,log_id TEXT NOT NULL,bot_id TEXT NOT NULL,target_id TEXT NOT NULL,
 target_name TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(room_id,log_id))`);}

function displayMember(name,userId){
 const id=exactId(userId),clean=String(name||id||'알 수 없음').replace(/[\u0002-\u0004]/g,'').trim()||id||'알 수 없음';
 return {id,clean,mention:id?'\u0002'+id+'\u0003'+clean+'\u0004':'@'+clean};
}
function renderMemberTemplate(template,{name,userId,joins=0,leaves=0,roomName='',time='',profileLink=''}){
 const {id,clean,mention}=displayMember(name,userId);
 const values={
  '(이름)':clean,'(멘션)':mention,'(아이디)':id||'확인 불가',
  '(해시)':id||'확인 불가','(방이름)':String(roomName||''),
  '(날짜)':String(time||''),'(옾링)':String(profileLink||'확인 불가'),
  '(입장횟수)':String(Number(joins)||0),
  '(퇴장횟수)':String(Number(leaves)||0)
 };
 return String(template).replace(/\((?:입장횟수|퇴장횟수|이름|멘션|아이디|해시|방이름|날짜|옾링)\)/g,variable=>values[variable]);
}
function leaveNotice({
 name,userId,joins=0,leaves=0,time,detail='',
 profileLink='',profileType='확인 불가',profileImage='',
 joinedAt=null,stay='확인 불가',bans=0
}){
 const {id,clean,mention}=displayMember(name,userId);
 return (
  mention+' 님이 채팅방에서 퇴장하셨습니다.\n'+ '\u200b'.repeat(1200)+
  '\n┏━━━━━━━━━━━━━━━━━━━━'+
  '\n┃회원 프로필'+
  '\n┣━━━━━━━━━━━━━━━━━━━━'+
  '\n┃└ 닉네임       '+clean+
  '\n┃└ 유저 ID      '+(id||'확인 불가')+
  '\n┃└ 프로필       '+profileType+
  '\n┃└ 프사 URL     '+(profileImage||'확인 불가')+
  '\n┃└ 오픈프로필 URL '+(profileLink||'확인 불가')+
  '\n┃'+
  '\n┣━━━━━━━━━━━━━━━━━━━━'+
  '\n┃세션 기록'+
  '\n┣━━━━━━━━━━━━━━━━━━━━'+
  '\n┃└ 입장 시각    '+(joinedAt||'확인 불가')+
  '\n┃└ 퇴장 시각    '+(time||'확인 불가')+
  '\n┃└ 체류 시간    '+(stay||'확인 불가')+
  '\n┣━━━━━━━━━━━━━━━━━━━━'+
  '\n┃활동 기록'+
  '\n┣━━━━━━━━━━━━━━━━━━━━'+
  '\n┃└ 누적 입장    '+Number(joins||0)+'회'+
  '\n┃└ 누적 퇴장    '+Number(leaves||0)+'회'+
  '\n┃└ 강퇴 기록    '+Number(bans||0)+'회'+
  '\n┗━━━━━━━━━━━━━━━━━━━━'+
  '\n퇴장 알림에 답장으로 k 입력 시 벤합니다. (방장·부방장·지정 관리자)'+
  (detail?'\n\n💬 '+detail:'')
 );
}
function joinNotice({
 name,userId,roomName,joins=0,leaves=0,time,
 profileLink='',profileType=null,profileImage='',bans=0,detail=''
}){
 const {id,clean,mention}=displayMember(name,userId);
 const typeName=['기본프로필','오픈프로필','확인 불가'].includes(profileType)?profileType:
  profileType==null?(profileLink?'오픈프로필':'확인 불가'):
  [1,2,4].includes(Number(profileType))?'기본프로필':
  Number(profileType)===0?'오픈프로필':'확인 불가';
 return (
  mention+' 님이 채팅방에 입장하셨습니다.\n'+'\u200b'.repeat(1200)+
  '\n┏━━━━━━━━━━━━━━━━━━━━'+
  '\n┃회원 프로필'+
  '\n┣━━━━━━━━━━━━━━━━━━━━'+
  '\n┃└ 닉네임       '+clean+
  '\n┃└ 유저 ID      '+(id||'확인 불가')+
  '\n┃└ 프로필       '+typeName+
  '\n┃└ 프사 URL     '+(profileImage||'확인 불가')+
  '\n┃└ 오픈프로필 URL '+(profileLink||'확인 불가')+
  '\n┃'+
  '\n┣━━━━━━━━━━━━━━━━━━━━'+
  '\n┃세션 기록'+
  '\n┣━━━━━━━━━━━━━━━━━━━━'+
  '\n┃└ 입장 시각    '+(time||'확인 불가')+
  '\n┣━━━━━━━━━━━━━━━━━━━━'+
  '\n┃활동 기록'+
  '\n┣━━━━━━━━━━━━━━━━━━━━'+
  '\n┃└ 누적 입장    '+Number(joins||0)+'회'+
  '\n┃└ 누적 퇴장    '+Number(leaves||0)+'회'+
  '\n┃└ 강퇴 기록    '+Number(bans||0)+'회'+
  '\n┗━━━━━━━━━━━━━━━━━━━━'+
  (detail?'\n\n💬 '+detail:'')
 );
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
async function handle(context,db){
 const {text,msg,roomId,userId,senderType,botId,send,kick}=context;
 if(text!=='k')return false;
 const log=replyReference(msg,botId);if(!log)return false;
 const isManager=[1,4].includes(Number(senderType));
 const assigned=isManager?false:(await db.query('SELECT 1 FROM gl_manage_admins WHERE room_id=$1 AND user_id=$2',[String(roomId),String(userId)])).rowCount>0;
 if(!isManager&&!assigned){await send('⛔ 방장·부방장 또는 지정 관리자만 사용할 수 있습니다.');return true;}
 const found=await db.query(`SELECT target_id,target_name,state FROM gl_leave_replies WHERE room_id=$1 AND log_id=$2 AND bot_id=$3`,[String(roomId),log,String(botId)]);
 const row=found.rows[0];if(!row)return false;
 if(row.target_id===String(userId)||row.target_id===String(botId)){await send('⛔ 봇 또는 명령 실행자 본인은 벤할 수 없습니다.');return true;}
 const claimed=await db.query(`UPDATE gl_leave_replies SET state='sending' WHERE room_id=$1 AND log_id=$2 AND bot_id=$3 AND state='pending' RETURNING target_id`,[String(roomId),log,String(botId)]);
 if(!claimed.rows.length){await send(row.state==='done'?'이미 벤 요청을 완료한 퇴장 알림입니다.':'이 퇴장 알림의 벤 요청이 처리 중입니다.');return true;}
 try{
  await kick(row.target_id);
 }catch(e){
  await db.query(`UPDATE gl_leave_replies SET state='pending' WHERE room_id=$1 AND log_id=$2 AND bot_id=$3`,[String(roomId),log,String(botId)]);
  await send('벤 요청 실패: '+e.message);return true;
 }
 await db.query(`UPDATE gl_leave_replies SET state='done' WHERE room_id=$1 AND log_id=$2 AND bot_id=$3`,[String(roomId),log,String(botId)]);
 try{
  await db.query('INSERT INTO gl_manage_actions(room_id,actor_id,target_id,action,detail) VALUES($1,$2,$3,$4,$5)',
    [String(roomId),String(userId),row.target_id,'KICK','퇴장 알림 k 답장 강퇴']);
 }catch(e){console.error('[LEAVE K LOG]',String(e?.message||e));}
 await send(`🚫 ${row.target_name}님을 벤했습니다.\n사용자 ID: ${row.target_id}`);return true;
}
module.exports={init,leaveNotice,joinNotice,renderMemberTemplate,profileNotice,record,replyReference,handle};
