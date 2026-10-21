'use strict';
const {randomInt,randomUUID}=require('node:crypto');
const {profileNotice}=require('./leave-reply');

// Enqueue with the profile history in the caller's room transaction. Historical
// rows have no outbox entry, so enabling this never replays old profile records.
async function enqueue(c,ctx,room,eventId,change){
 const bounded={...change};
 for(const key of ['oldName','newName'])bounded[key]=String(bounded[key]||'').slice(0,300);
 for(const key of ['oldOpenLink','newOpenLink'])bounded[key]=String(bounded[key]||'').slice(0,600);
 const labels=[change.nameChanged?'닉네임':'',change.imageChanged?'프로필 사진':'',change.linkChanged?'오픈프로필 링크':''].filter(Boolean);
 const body=profileNotice(bounded,ctx.nowK()).replace('\n시간:',(labels.length?'\n변경 항목: '+labels.join(' · '):'')+'\n시간:');
 await c.query(`INSERT INTO hz_profile_outbox(profile_id,room_id,bot_id,client_msg_id,body)
  VALUES($1,$2,$3,$4,$5) ON CONFLICT(profile_id) DO NOTHING`,
 [String(eventId),String(room),String(ctx.globalBotId||''),randomInt(1,2147483647),body]);
}

function exact(value){
 if(typeof value==='string'&&/^\d+$/.test(value))return value;
 if(typeof value==='bigint')return String(value);
 if(typeof value==='number'&&Number.isSafeInteger(value))return String(value);
 if(value&&typeof value==='object'&&typeof value.toString==='function'){
  const s=value.toString();if(/^\d+$/.test(s))return s;
 }
 return '';
}

// Only an exact outbound echo (room, bot, client message ID and body) confirms
// an ambiguous send. A nickname, approximate 64-bit ID or similar text cannot.
async function confirm(pool,botId,msg){
 const bot=exact(botId),sender=exact(msg?.sender?.id??msg?.senderId);
 if(!bot||sender!==bot)return;
 const raw=msg.raw?.chatLog??msg.raw?.chatlog??msg.raw?.chat??msg.raw;
 const room=exact(msg.room?.id),msgId=exact(raw?.msgId),logId=exact(msg.logId??msg.message?.logId??msg.message?.id);
 const body=msg.message?.text??msg.text;
 if(!room||!msgId||!logId||typeof body!=='string')return;
 await pool.query(`UPDATE hz_profile_outbox SET state='sent',log_id=$5,sent_at=NOW(),last_error=NULL
  WHERE room_id=$1 AND bot_id=$2 AND client_msg_id=$3 AND body=$4 AND state IN ('sending','uncertain')`,[room,bot,msgId,body,logId]);
}

function definiteRejection(error){
 // KakaoForge emits this only for an explicit server rejection of WRITE.
 // Timeout/disconnect/socket errors may follow a successful delivery.
 return /^WRITE failed: status=-?\d+$/.test(String(error?.message||''));
}

async function drain(ctx,room,{limit=5}={}){
 const pool=ctx.pool;
 const stale=await pool.query(`UPDATE hz_profile_outbox SET state='uncertain',last_error='process stopped or send acknowledgement lost'
  WHERE room_id=$1 AND state='sending' AND claimed_at<NOW()-INTERVAL '5 minutes' RETURNING profile_id`,[String(room)]);
 if(stale.rows.length)console.error('[NEXUS PROFILE WATCH] notification acknowledgement uncertain',JSON.stringify({roomId:String(room),count:stale.rows.length}));
 for(let i=0;i<limit;i++){
  if(ctx.globalClient?.connected===false||!ctx.globalChat||typeof ctx.globalChat.sendText!=='function')return;
  const token=randomUUID();
  const claimed=await pool.query(`UPDATE hz_profile_outbox SET state='sending',claim_token=$2,claimed_at=NOW(),attempts=attempts+1
   WHERE profile_id=(SELECT o.profile_id FROM hz_profile_outbox o
    JOIN hz_rooms r ON r.room_id=o.room_id
    WHERE o.room_id=$1 AND o.bot_id=$3 AND o.state='pending' AND o.retry_at<=NOW()
    AND r.data->>'manage'='true' AND COALESCE(r.data->>'locked','false')<>'true'
    ORDER BY o.profile_id FOR UPDATE OF o SKIP LOCKED LIMIT 1)
   AND state='pending' RETURNING *`,[String(room),token,String(ctx.globalBotId||'')]);
  const item=claimed.rows[0];if(!item)return;
  try{
   // One message, with a persistent correlation ID. Do not use the paginated
   // generic sender: a partly delivered multi-message notice cannot be retried.
   const result=await ctx.globalChat.sendText(String(room),item.body,{msgId:Number(item.client_msg_id)});
   const logId=exact(result?.body?.logId??result?.logId);
   if(!logId)throw new Error('WRITE acknowledgement missing exact logId');
   await pool.query(`UPDATE hz_profile_outbox SET state='sent',log_id=$3,sent_at=NOW(),last_error=NULL
    WHERE profile_id=$1 AND claim_token=$2 AND state IN ('sending','uncertain')`,[String(item.profile_id),token,logId]);
   console.log('[NEXUS PROFILE WATCH] notification sent',JSON.stringify({roomId:String(room),eventId:String(item.profile_id)}));
  }catch(error){
   const retry=definiteRejection(error),state=retry?'pending':'uncertain';
   const updated=await pool.query(`UPDATE hz_profile_outbox SET state=$3,last_error=$4,
    retry_at=NOW()+LEAST(3600,30*POWER(2,LEAST(attempts,7))) * INTERVAL '1 second'
    WHERE profile_id=$1 AND claim_token=$2 AND state='sending' RETURNING profile_id`,[String(item.profile_id),token,state,String(error?.message||'send failed').slice(0,240)]);
   if(updated.rows.length)console.error('[NEXUS PROFILE WATCH] notification '+(retry?'rejected; retry scheduled':'uncertain; automatic resend withheld'),JSON.stringify({roomId:String(room),eventId:String(item.profile_id)}));
   return;
  }
 }
}
module.exports={enqueue,confirm,drain};
