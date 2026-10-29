'use strict';
const {getPool}=require('../shared/db');
const id=v=>{const s=String(v??'');return /^[1-9]\d*$/.test(s)?s:null};
async function active(db,room){
 const q=await db.query('SELECT enabled,deleted_enabled FROM gl_manage_rooms WHERE room_id=$1',[room]);
 return q.rows[0]?.enabled===true&&q.rows[0]?.deleted_enabled===true;
}
async function observe({roomId,messageId,userId,userName,text,botId}){
 const room=id(roomId),mid=id(messageId),uid=id(userId);
 if(!room||!mid||!uid||uid===id(botId))return false;
 const db=getPool();if(!await active(db,room))return false;
 await db.query('INSERT INTO gl_manage_temp_messages(room_id,message_id,user_id,user_name,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(room_id,message_id) DO NOTHING',
 [room,mid,uid,String(userName||uid),String(text??'').slice(0,10000)]);
 return true;
}
async function onDelete({roomId,messageId,userId,userName,botId,send,cached,fetchOriginal}){
 const room=id(roomId),mid=id(messageId);if(!room||!mid)return false;
 const db=getPool();if(!await active(db,room))return false;
 const c=await db.connect();let alert=null;
 try{
  await c.query('BEGIN');
  const found=await c.query("SELECT user_id,user_name,body FROM gl_manage_temp_messages WHERE room_id=$1 AND message_id=$2 AND created_at >= NOW()-INTERVAL '24 hours'",[room,mid]);
  let saved=found.rows[0] || (cached ? {user_id:cached.userId,user_name:cached.userName,body:cached.text}:null);
  if(!saved && typeof fetchOriginal==='function'){
    try {
      const msg=await fetchOriginal(room,mid);
      const author=id(msg?.sender?.id??msg?.senderId);
      const body=msg?.message?.text??msg?.text;
      if(author && typeof body==='string')saved={user_id:author,user_name:msg?.sender?.name||author,body};
    } catch(error) {
      console.warn('[DELETE WATCH] fetchMessage unavailable',error?.message||String(error));
    }
  }
  const uid=id(saved?.user_id)||id(userId);
  if(!uid||uid===id(botId)){await c.query('ROLLBACK');return false;}
  const name=String(saved?.user_name||userName||uid);
  const once=await c.query('INSERT INTO gl_manage_deleted_processed(room_id,message_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING message_id',[room,mid]);
  if(!once.rowCount){await c.query('ROLLBACK');return false;}
  await c.query('INSERT INTO gl_manage_warnings(room_id,user_id,user_name,reason,issuer_id) VALUES($1,$2,$3,$4,$5)',[room,uid,name,'메시지 삭제',id(botId)||'0']);
  const q=await c.query('SELECT count(*)::int AS n FROM gl_manage_warnings WHERE room_id=$1 AND user_id=$2 AND NOT removed',[room,uid]);
  await c.query('COMMIT');
  alert=`🗑️ ${name}님이 메시지를 삭제했습니다.\n💬 삭제된 내용: ${saved?.body??'확인 불가'}\n⚠️ 경고 1회 지급 (누적 ${q.rows[0].n}회)`;
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 await send(alert);return true;
}
async function cleanup(){
 const db=getPool();
 await db.query("DELETE FROM gl_manage_temp_messages WHERE created_at < NOW()-INTERVAL '24 hours'");
 await db.query("DELETE FROM gl_manage_deleted_processed WHERE created_at < NOW()-INTERVAL '30 days'");
}
module.exports={observe,onDelete,cleanup};
