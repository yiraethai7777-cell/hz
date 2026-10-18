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
function leaveNotice({name,userId,joins,leaves,time,detail='',profileLink=''}){
 return `👋 ${name}님이 나갔습니다.\n${'\u200b'.repeat(1200)}\n👤 ${name}\n사용자 ID: ${userId}\n🚪 입장 ${joins}회 · 퇴장 ${leaves}회\n🕒 퇴장 시간: ${time}\n🔗 오픈프로필: ${profileLink||'확인된 오픈프로필 링크 없음'}${detail?'\n'+detail:''}\n\n방장·부방장: 이 알림에 답장으로 a를 보내면 벤합니다.`;
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
 if(Number(msg?.message?.type??msg?.type)!==26)return null;
 const raw=msg.raw?.chatLog??msg.raw?.chatlog??msg.raw?.chat??msg.raw;
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
 if(text!=='a')return false;
 const log=replyReference(msg,botId);if(!log)return false;
 if(![1,4].includes(Number(senderType))){await send('⛔ 방장·부방장만 퇴장 알림에 답장으로 벤할 수 있습니다.');return true;}
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
 await send(`🚫 벤 요청 완료: ${row.target_name}\n사용자 ID: ${row.target_id}`);return true;
}
module.exports={init,leaveNotice,record,replyReference,handle};
