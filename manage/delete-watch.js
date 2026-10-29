'use strict';
const {getPool}=require('../shared/db');
const {id,original,safeError}=require('../shared/delete-message');
const fs=require('node:fs/promises');
const path=require('node:path');
const ROOT=process.env.DELETE_LOG_DIR||path.join(process.cwd(),'message-logs');
const fileFor=room=>path.join(ROOT,room+'.jsonl');
const queues=new Map();
function writeRoom(room,line){
 const previous=queues.get(room)||Promise.resolve();
 const next=previous.catch(()=>{}).then(async()=>{
  await fs.mkdir(ROOT,{recursive:true,mode:0o700});
  await fs.appendFile(fileFor(room),JSON.stringify(line)+'\n',{encoding:'utf8',mode:0o600});
 });
 queues.set(room,next);
 next.finally(()=>{if(queues.get(room)===next)queues.delete(room);}).catch(()=>{});
 return next;
}
async function readRoom(room,mid){
 await (queues.get(room)||Promise.resolve()).catch(()=>{});
 let contents;
 try{contents=await fs.readFile(fileFor(room),'utf8');}
 catch(e){if(e.code==='ENOENT')return null;throw e;}
 const lines=contents.split('\n');
 for(let i=lines.length-1;i>=0;i--){
  if(!lines[i])continue;
  try{const item=JSON.parse(lines[i]);if(String(item.message_id)===mid&&!isDeletionFeed(item.body))return item;}
  catch{}
 }
 return null;
}
async function active(db,room,requireDelete=true){
 const q=await db.query('SELECT enabled,deleted_enabled FROM gl_manage_rooms WHERE room_id=$1',[room]);
 return q.rows[0]?.enabled===true&&(!requireDelete||q.rows[0]?.deleted_enabled===true);
}
async function observe({roomId,messageId,userId,userName,text,botId}){
 const room=id(roomId),mid=id(messageId),uid=id(userId);
 if(!room||!mid||!uid||uid===id(botId)||!String(text??'').length||isDeletionFeed(text))return false;
 let stage='active';
 try{
  const db=getPool();
  if(!await active(db,room,false)){
   console.log('[DELETE WATCH STORE]',JSON.stringify({status:'skipped',reason:'room_disabled'}));return false;
  }
  // A local disk failure must not prevent durable PostgreSQL persistence.
  try{await writeRoom(room,{message_id:mid,user_id:uid,user_name:String(userName||uid),body:String(text).slice(0,10000),at:Date.now()});}
  catch(error){console.warn('[DELETE WATCH FILE]',JSON.stringify({status:'failed',code:safeError(error)}));}
  stage='insert';
  const result=await db.query('INSERT INTO gl_manage_temp_messages(room_id,message_id,user_id,user_name,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(room_id,message_id) DO NOTHING',
   [room,mid,uid,String(userName||uid),String(text).slice(0,10000)]);
  console.log('[DELETE WATCH STORE]',JSON.stringify({status:result.rowCount?'inserted':'duplicate'}));
 }catch(error){
  console.error('[DELETE WATCH STORE]',JSON.stringify({status:'failed',stage,code:safeError(error)}));throw error;
 }
 return true;
}
function isDeletionFeed(body){
  if(typeof body!=='string')return false;
  try {const data=JSON.parse(body);return data && typeof data==='object' && (Number(data.feedType)===14 || data.hidden===true && data.logId!=null);}
  catch{return false;}
}
async function onDelete({roomId,messageId,userId,userName,botId,send,cached,fetchOriginal}){
 const room=id(roomId),mid=id(messageId);if(!room||!mid)return false;
 const db=getPool();if(!await active(db,room))return false;
 const c=await db.connect();let alert=null;
 try{
  await c.query('BEGIN');
  const found=await c.query("SELECT user_id,user_name,body FROM gl_manage_temp_messages WHERE room_id=$1 AND message_id=$2 AND created_at >= NOW()-INTERVAL '24 hours'",[room,mid]);
  let saved=found.rows[0] || (cached && !isDeletionFeed(cached.text) ? {user_id:cached.userId,user_name:cached.userName,body:cached.text}:null);
  if(saved && isDeletionFeed(saved.body))saved=null;
  if(!saved)saved=await readRoom(room,mid);
  console.log('[DELETE WATCH LOOKUP]',JSON.stringify({db:!!found.rows[0],cache:!!cached,found:!!saved,hasBody:!!saved?.body}));
  if(!saved && typeof fetchOriginal==='function'){
    try {
      const msg=await fetchOriginal(room,mid);
      const record=original(msg);
      const author=record.userId,body=record.text;
      if(record.roomId===room && record.messageId===mid && record.comparison.idLogMatch!==false && record.comparison.idMatch!==false && record.comparison.roomMatch!==false && author && typeof body==='string' && !isDeletionFeed(body))saved={user_id:author,user_name:record.userName||author,body};
    } catch(error) {
      console.warn('[DELETE WATCH] fetchMessage unavailable',safeError(error));
    }
  }
  console.log('[DELETE WATCH] lookup',JSON.stringify({foundOriginal:!!saved?.body}));
  const uid=id(saved?.user_id)||id(userId);
  if(!uid||uid===id(botId)){await c.query('ROLLBACK');return false;}
  const name=String(saved?.user_name||userName||uid);
  const once=await c.query('INSERT INTO gl_manage_deleted_processed(room_id,message_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING message_id',[room,mid]);
  if(!once.rowCount){await c.query('ROLLBACK');return false;}
  if(saved?.body)await c.query('INSERT INTO gl_manage_warnings(room_id,user_id,user_name,reason,issuer_id) VALUES($1,$2,$3,$4,$5)',[room,uid,name,'메시지 삭제',id(botId)||'0']);
  const q=await c.query('SELECT count(*)::int AS n FROM gl_manage_warnings WHERE room_id=$1 AND user_id=$2 AND NOT removed',[room,uid]);
  await c.query('COMMIT');
  alert=`🗑️ ${name}님이 메시지를 삭제했습니다.\n💬 삭제된 내용: ${saved?.body??'확인 불가'}\n${saved?.body ? `⚠️ 경고 1회 지급 (누적 ${q.rows[0].n}회)` : '⚠️ 원문 미확인으로 경고 미지급'}`;
 }catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
 await send(alert);return true;
}
async function cleanup(){
 const db=getPool();
 await db.query("DELETE FROM gl_manage_temp_messages WHERE created_at < NOW()-INTERVAL '24 hours'");
 await db.query("DELETE FROM gl_manage_deleted_processed WHERE created_at < NOW()-INTERVAL '30 days'");
}
module.exports={observe,onDelete,cleanup};
