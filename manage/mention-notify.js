'use strict';
// Only verified Kakao mention targets are recorded. Message bodies are never stored.
const {randomUUID}=require('node:crypto');
const {mentions}=require('./targets');
const FOLD='\u200b'.repeat(1200);
const activeDeliveries=new Set();
let initializing=null;

function clean(value,fallback='알 수 없음'){
  const s=String(value??'').replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').replace(/\s+/g,' ').trim().slice(0,60);
  return s||fallback;
}
function formatTime(value){
  const d=new Date(value);
  if(!Number.isFinite(d.getTime()))return '시간 확인 불가';
  const p=new Intl.DateTimeFormat('en-US',{
    timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hour12:false,hourCycle:'h23'
  }).formatToParts(d);
  const get=k=>p.find(x=>x.type===k)?.value||'??';
  return get('month')+'.'+get('day')+' '+get('hour')+':'+get('minute');
}
function formatNotification(displayName,records,realMention){
  const n=records.length;
  const heading=(realMention||'@'+clean(displayName))+'님, 부재중 멘션이 '+n+'개 있었어요.';
  const lines=['┃ 부재중 멘션 '+n+'개','┣━━━━━━━━━━━━━━━━━━┫'];
  records.forEach((r,i)=>{
    lines.push('┃ '+(i+1)+'. ['+formatTime(r.created_at)+'] '+clean(r.sender_name,r.sender_id||'알 수 없음'));
    if(i!==records.length-1)lines.push('┃');
  });
  lines.push('┗━━━━━━━━━━━━━━━━━━┛');
  // KakaoTalk decides whether to fold a long message. This uses the existing
  // zero-width-space convention, not a fabricated interactive 'more' button.
  return heading+FOLD+'\n'+lines.join('\n');
}
async function init(db){
  if(!initializing){
    initializing=db.query("CREATE TABLE IF NOT EXISTS hz_mention_settings(room_id TEXT PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT TRUE);"+
      "ALTER TABLE hz_mention_alerts ADD COLUMN IF NOT EXISTS room_name TEXT;"+
      "ALTER TABLE hz_mention_alerts ADD COLUMN IF NOT EXISTS message_key TEXT;"+
      "ALTER TABLE hz_mention_alerts ADD COLUMN IF NOT EXISTS claim_token TEXT;"+
      "ALTER TABLE hz_mention_alerts ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;"+
      "CREATE UNIQUE INDEX IF NOT EXISTS hz_mention_alerts_message_dedupe "+
      "ON hz_mention_alerts(room_id,target_id,message_key) WHERE message_key IS NOT NULL;")
      .catch(e=>{initializing=null;throw e;});
  }
  await initializing;
}
async function isEnabled(db,roomId){
  await init(db);
  const r=await db.query("SELECT COALESCE((SELECT enabled FROM hz_mention_settings WHERE room_id=$1),TRUE) AS enabled",[String(roomId)]);
  return r.rows[0]?.enabled===true;
}
async function setEnabled(db,roomId,on){
  await init(db);
  await db.query('INSERT INTO hz_mention_settings(room_id,enabled) VALUES($1,$2) ON CONFLICT(room_id) DO UPDATE SET enabled=EXCLUDED.enabled',[String(roomId),!!on]);
}
function messageKey(msg){
  const raw=msg?.raw?.chatLog??msg?.raw?.chatlog??msg?.raw?.chat??msg?.raw;
  const candidate=msg?.message?.logId??msg?.logId??raw?.logId??msg?.message?.id??msg?.id;
  const value=candidate==null?'':String(candidate);
  return /^[a-zA-Z0-9:_-]{4,128}$/.test(value)?value:null;
}
function actualMention(chat,roomId,targetId,name){
  if(typeof chat?.mention!=='function')return null;
  try{
    const marker=chat.mention(String(targetId),clean(name),roomId);
    if(typeof marker==='string'&&marker.startsWith('\u0002')&&marker.includes('\u0003')&&marker.endsWith('\u0004'))return marker;
  }catch(e){console.warn('[MENTION MARKER]',String(e?.message||e));}
  return null;
}
async function deliver({db,chat,roomId,userId,userName,send}){
  const room=String(roomId),user=String(userId),key=room+':'+user;
  if(activeDeliveries.has(key))return;
  activeDeliveries.add(key);
  try{
    if(!await isEnabled(db,room))return;
    const token=randomUUID();
    const r=await db.query(
      "WITH picked AS (SELECT id FROM hz_mention_alerts "+
      "WHERE room_id=$1 AND target_id=$2 AND notified_at IS NULL "+
      "AND (claimed_at IS NULL OR claimed_at < NOW()-INTERVAL '5 minutes') "+
      "ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED) "+
      "UPDATE hz_mention_alerts a SET claim_token=$3,claimed_at=NOW() FROM picked "+
      "WHERE a.id=picked.id RETURNING a.id,a.sender_id,a.sender_name,a.created_at",
      [room,user,token]
    );
    if(!r.rows.length)return;
    const rows=r.rows.sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:BigInt(a.id)>BigInt(b.id)?1:0);
    const real=actualMention(chat,room,user,userName);
    try{
      await send(formatNotification(userName,rows,real));
      await db.query('UPDATE hz_mention_alerts SET notified_at=NOW(),claim_token=NULL,claimed_at=NULL WHERE room_id=$1 AND target_id=$2 AND claim_token=$3',[room,user,token]);
    }catch(error){
      try{await db.query('UPDATE hz_mention_alerts SET claim_token=NULL,claimed_at=NULL WHERE room_id=$1 AND target_id=$2 AND claim_token=$3',[room,user,token]);}
      catch(releaseError){console.error('[MENTION RELEASE]',releaseError);}
      throw error;
    }
  }finally{activeDeliveries.delete(key);}
}
async function observe({db,chat,roomId,msg,senderId,senderName,botId,mentionTargets,send}){
  const room=String(roomId),sender=String(senderId);
  if(!/^\d{4,}$/.test(sender)||sender===String(botId))return;
  if(!await isEnabled(db,room))return;
  // A new message by the recipient is the measurable "return" signal.
  // Actual offline status is not exposed by KakaoForge.
  await deliver({db,chat,roomId:room,userId:sender,userName:senderName,send});
  const targets=new Map();
  for(const m of Array.isArray(mentionTargets)?mentionTargets:mentions(msg)){
    const id=String(m.id??m.userId??'');
    if(id!==sender&&id!==String(botId)&&/^\d{4,}$/.test(id))targets.set(id,m);
  }
  const key=messageKey(msg);
  for(const id of targets.keys()){
    await db.query(
      'INSERT INTO hz_mention_alerts(room_id,target_id,sender_id,sender_name,message_key) VALUES($1,$2,$3,$4,$5) '+
      'ON CONFLICT DO NOTHING',
      [room,id,sender,clean(senderName,sender),key]
    );
  }
}
module.exports={init,isEnabled,setEnabled,observe,deliver,formatNotification,formatTime,messageKey};
