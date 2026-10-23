"use strict";
// Persistent state is supplied explicitly; this module registers no client listener.
module.exports = function createFeatures(ctx) {
function formatMemberTemplate(template, info){
  const values={"(이름)":info.name,"(해시)":info.uid,"(방이름)":info.roomName,"(날짜)":ctx.nowK()};
  return String(template).replace(/\(이름\)|\(해시\)|\(방이름\)|\(날짜\)/g, key=>values[key]||"");
}

function isManagerType(t){return Number(t)===1||Number(t)===4}

function isOwnerType(t){return Number(t)===1}

function isSubManagerType(t){return Number(t)===4}

function safeUserId(v){
  if(typeof v==="string" && /^\d{4,}$/.test(v))return v;
  if(typeof v==="bigint" && v>0n)return v.toString();
  if(typeof v==="number" && Number.isSafeInteger(v) && v>=1000)return String(v);
  return "";
}

function parseExactAttachment(raw){
  if(typeof raw==="string"){
    try{return ctx.LosslessJSON.parse(raw)}catch(_){return null}
  }
  return raw&&typeof raw==="object"?raw:null;
}

function exactId(v){
  if(v&&typeof v==="object"&&typeof v.value==="string")return ctx.safeUserId(v.value);
  return ctx.safeUserId(v);
}

function attachmentRoots(msg){
  const chatLog=msg.raw?.chatLog??msg.raw?.chatlog??msg.raw?.chat??msg.raw;
  const raw=[chatLog?.attachment,chatLog?.attachments,chatLog?.extra,
    msg.raw?.attachment,msg.message?.attachment,...(msg.attachmentsRaw||[])];
  return raw.map(ctx.parseExactAttachment).filter(Boolean);
}

function rawMentions(msg){
  const out=[],seen=new Set();
  const roots=[msg.mentions,msg.message?.mentions,msg.message?.mentionList,
    msg.raw?.mentions,msg.raw?.chat?.mentions,...ctx.attachmentRoots(msg)];
  function collect(v,mentionContext=false,depth=0){
    if(!v||depth>5)return;
    if(Array.isArray(v)){for(const x of v)collect(x,mentionContext,depth+1);return}
    if(typeof v!=="object")return;
    if(mentionContext){
      const uid=ctx.exactId(v.userId??v.user_id??v.memberId??v.user?.id??v.id);
      if(uid&&!seen.has(uid)){seen.add(uid);out.push({id:uid,name:String(v.name??v.nickname??v.nickName??v.displayName??"").replace(/^@/,"")})}
    }
    for(const [key,val] of Object.entries(v)){
      if(/mention/i.test(key))collect(val,true,depth+1);
    }
  }
  for(let i=0;i<roots.length;i++)collect(roots[i],i<5);
  return out;
}

function targetFrom(msg,text){
  const explicit=String(text||"").trim().match(/^#\S+\s+(\d{4,})\s*$/);
  if(explicit)return {id:explicit[1],name:""};
  const ms=ctx.rawMentions(msg);
  return ms.length===1?ms[0]:null;
}

async function resolveTarget(c,rid,t){
  if(!t)return null;
  const uid=ctx.safeUserId(t.id);
  if(!uid)return null;
  const q=await c.query(`SELECT name FROM hz_members WHERE room_id=$1 AND user_id=$2
    UNION ALL SELECT name FROM hz_chat_stats WHERE room_id=$1 AND user_id=$2 LIMIT 1`,[rid,uid]);
  return {id:uid,name:q.rows[0]?.name||t.name||uid};
}

async function commandTarget(c,rid,msg,text){
  const raw=String(text||"").trim();
  const arg=raw.replace(/^#\S+/,"").trim();
  if(/^\d{4,}$/.test(arg))return ctx.resolveTarget(c,rid,{id:arg,name:""});
  const mentions=require('./targets').mentions(msg);
  if(mentions.length===1){
    const found=await ctx.resolveTarget(c,rid,mentions[0]);
    if(found)return found;
  }
  if(arg.startsWith("@")){
    const wanted=arg.slice(1).trim();
    if(!wanted)return null;
    const q=await c.query(`SELECT DISTINCT user_id,name FROM (
      SELECT user_id,name FROM hz_members WHERE room_id=$1 AND name=$2
      UNION ALL SELECT user_id,name FROM hz_chat_stats WHERE room_id=$1 AND name=$2
    ) matches`,[rid,wanted]);
    if(q.rows.length===1)return {id:String(q.rows[0].user_id),name:q.rows[0].name};
  }
  const replied=await require('./targets').resolve({msg,text,roomId:rid,client:ctx.globalClient,db:c});
  return replied?ctx.resolveTarget(c,rid,replied):null;
}

function senderExactId(msg){
  const candidates=[msg.sender?.id,msg.sender?.userId,msg.sender?.user_id,msg.senderId,msg.userId,msg.raw?.sender?.id];
  for(const v of candidates){const x=ctx.exactId(v);if(x)return x}
  return "";
}

async function processMentionAlerts(chat,rid,msg,uid,name){
  if(!uid||uid===ctx.globalBotId)return;
  // 메시지에 실제로 포함된 멘션 정보만 수집한다. 닉네임 텍스트로 추측하지 않는다.
  const mentions=ctx.rawMentions(msg).filter(x=>x.id!==uid&&x.id!==ctx.globalBotId);
  const unique=new Set();
  for(const m of mentions){
    if(unique.has(m.id))continue;unique.add(m.id);
    await ctx.pool.query(`INSERT INTO hz_mention_alerts(room_id,target_id,sender_id,sender_name)
      VALUES($1,$2,$3,$4)`,[rid,m.id,uid,name]);
  }
  // 동일 대상의 미전달 알림을 원자적으로 수거한다. 최대 20건씩 처리한다.
  const pending=await ctx.pool.query(`WITH picked AS (
    SELECT id FROM hz_mention_alerts WHERE room_id=$1 AND target_id=$2
      AND notified_at IS NULL ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED
  ) UPDATE hz_mention_alerts a SET notified_at=NOW() FROM picked
    WHERE a.id=picked.id RETURNING a.sender_id,a.sender_name`,[rid,uid]);
  if(pending.rows.length){
    const names=[...new Set(pending.rows.map(x=>x.sender_name||x.sender_id))];
    const who=names.length<=3?names.map(x=>`${x}님`).join(", "):names.slice(0,3).map(x=>`${x}님`).join(", ")+` 외 ${names.length-3}명`;
    try{await ctx.send(chat,rid,`📢 ${name}님, ${who}이 회원님을 멘션했습니다.\n미확인 멘션: ${pending.rows.length}건`)}
    catch(e){console.error("[NEXUS MENTION NOTIFY]",e)}
  }
}



function deepFindUserId(v, preferReply=false){
  let found="";
  function walk(x,key="",depth=0){
    if(found||!x||typeof x!=="object"||depth>8)return;
    if(Array.isArray(x)){for(const y of x)walk(y,key,depth+1);return}
    const k=String(key||"").toLowerCase();
    const replyish=/reply|quote|refer|origin|source/.test(k);
    if(!preferReply||replyish){
      const u=ctx.id(x.userId??x.user_id??x.memberId??x.senderId??x.authorId??x.id);
      if(u && /^\d+$/.test(u)){found=u;return}
    }
    for(const [a,b] of Object.entries(x)){
      if(typeof b==="object")walk(b,a,depth+1);
      if(found)return;
    }
  }
  walk(v,"",0);
  return found;
}

function replyTargetFrom(msg){
  // 카카오 답장 메시지(type 26)의 src_userId만 원본 작성자로 인정한다.
  const roots=ctx.attachmentRoots(msg);
  for(const obj of roots){
    const arr=Array.isArray(obj)?obj:[obj];
    for(const v of arr){
      if(!v||typeof v!=="object")continue;
      const uid=ctx.exactId(v.src_userId??v.srcUserId??v.src_user_id);
      if(uid)return {id:uid,name:""};
      const nested=v.reply??v.quote??v.replyTo;
      if(nested&&typeof nested==="object"){
        const nestedId=ctx.exactId(nested.src_userId??nested.userId??nested.sender?.id);
        if(nestedId)return {id:nestedId,name:""};
      }
    }
  }
  return null;
}

async function idCommandTarget(c,rid,msg,text){
  // 1순위: 명령어의 @닉네임/숫자 ID
  let t=await ctx.commandTarget(c,rid,msg,text);
  if(t)return t;
  // 2순위: 답장한 원본 메시지 작성자
  t=ctx.replyTargetFrom(msg);
  return t?await ctx.resolveTarget(c,rid,t):null;
}

async function lastJoinAt(c,rid,uid){
  const q=await c.query(
    "SELECT created_at FROM hz_events WHERE room_id=$1 AND user_id=$2 AND event_type='join' ORDER BY id DESC LIMIT 1",
    [rid,uid]
  );
  return q.rows[0]?.created_at||null;
}

async function activeWarningCount(c,rid,uid){
  const q=await c.query("SELECT COALESCE(SUM(count),0)::int AS total FROM hz_warnings WHERE room_id=$1 AND target_id=$2 AND deleted_at IS NULL",[rid,uid]);
  return Number(q.rows[0]?.total||0);
}

function validOpenProfileLink(v){
  if(typeof v!=="string")return "";
  try{
    const u=new URL(v);
    if(u.protocol!=="https:")return "";
    // Do not confuse profile images or room invitations with a personal open-profile URL.
    if(u.hostname==="open.kakao.com" && /^\/o\/[A-Za-z0-9_-]+\/?$/.test(u.pathname))return v;
    return "";
  }catch(_){return ""}
}

function findOpenProfileLink(raw){
  let found="";
  const seen=new Set();
  function walk(v,depth=0){
    if(!v||depth>5||found||typeof v!=="object"||seen.has(v))return;
    seen.add(v);
    if(Array.isArray(v)){for(const x of v)walk(x,depth+1);return}
    for(const [k,x] of Object.entries(v)){
      if(/^(openProfileUrl|open_profile_url|openProfileLink|open_profile_link|profileLink|profile_link)$/i.test(k)){
        const link=ctx.validOpenProfileLink(x);if(link){found=link;return}
      }
      if(typeof x==="object")walk(x,depth+1)
    }
  }
  walk(raw);return found;
}

function profileDiagnostic(msg){
  // Report field names and link presence only; do not expose raw payloads, auth or other members.
  const roots=[['sender',msg.sender],['raw.sender',msg.raw?.sender],['raw.chat.sender',msg.raw?.chat?.sender]];
  const lines=['🔍 내 오픈프로필 진단','실제 수신된 본인 프로필 필드만 확인합니다.'];
  for(const [label,root] of roots){
    if(!root||typeof root!=='object'){lines.push(label+': 없음');continue;}
    const keys=Object.keys(root).filter(k=>/profile|open|link|url|nickname|name/i.test(k)).slice(0,25);
    const link=ctx.findOpenProfileLink(root);
    lines.push(label+': '+(keys.length?keys.join(', '):'관련 필드 없음'));
    lines.push('  오픈프로필 링크: '+(link?'확인됨':'없음'));
  }
  lines.push('※ 프로필 이미지 URL과 오픈프로필 공유 링크는 다릅니다.');
  return lines.join('\n');
}

async function saveOpenProfileLink(rid,uid,name,source){
  if(!rid||!uid||!source)return;
  const link=ctx.findOpenProfileLink(source);
  if(!link)return;
  await ctx.pool.query(`INSERT INTO hz_members(room_id,user_id,name,open_profile_link)
    VALUES($1,$2,$3,$4)
    ON CONFLICT(room_id,user_id) DO UPDATE SET
    open_profile_link=EXCLUDED.open_profile_link`,[rid,uid,name||uid,link]);
}

function extractProfile(raw){
  let best=null;
  function walk(v){
    if(!v||typeof v!=="object")return;
    if(Array.isArray(v)){v.forEach(walk);return}
    const uid=ctx.id(v.userId??v.user_id??v.memberId??v.id);
    const name=v.nickName??v.nickname??v.name??v.displayName;
    const url=v.openProfileUrl??v.open_profile_url??v.profileUrl??v.fullProfileImageUrl??v.profileImageUrl;
    if(uid&&(name||url))best={id:uid,name:name?String(name):"",url:url?String(url):""};
    for(const x of Object.values(v))if(typeof x==="object")walk(x)
  }
  walk(raw);return best
}



function pickDeleteRoom(evt){
  return ctx.id(evt?.room?.id??evt?.roomId??evt?.chat?.room?.id??evt?.chat?.roomId??evt?.channelId);
}

function pickDeleteActor(evt){
  const a=evt?.actor??evt?.deleter??evt?.sender??evt?.user??evt?.member??null;
  if(!a)return {id:"",name:""};
  const uid=ctx.id(a.id??a.userId??a.user_id??a.memberId??a.senderId);
  return {id:uid,name:String(a.name??a.nickname??a.nickName??a.displayName??uid??"")};
}

function pickDeletedText(evt){
  const vals=[evt?.message?.text,evt?.chat?.text,evt?.deletedMessage?.text,evt?.deletedChat?.text,evt?.originalMessage?.text,evt?.originalChat?.text,evt?.text,evt?.content];
  for(const v of vals)if(typeof v==="string"&&v.trim())return v.trim();
  return "";
}

function originalMessageId(msg){
  const m=msg?.message;
  const v=m?.id??m?.logId??msg?.logId??msg?.messageId;
  return v===undefined||v===null||v===""?"":String(v);
}

function deletedMessageId(evt){
  const v=evt?.message?.id??evt?.message?.logId??evt?.deletedMessage?.id??evt?.deletedMessage?.logId??evt?.deletedChat?.logId??evt?.originalMessage?.id??evt?.logId??evt?.messageId;
  return v===undefined||v===null||v===""?"":String(v);
}

async function saveDeleteCache(rid,msg,text){
  const mid=ctx.originalMessageId(msg);
  if(!mid||!text||text.length>2000)return;
  await ctx.pool.query("INSERT INTO hz_message_cache(room_id,message_id,message_text) VALUES($1,$2,$3) ON CONFLICT(room_id,message_id) DO NOTHING",[rid,mid,text]);
  // Purge old content; no indefinite archive.
  await ctx.pool.query("DELETE FROM hz_message_cache WHERE created_at < NOW() - INTERVAL '24 hours'");
}

async function lookupDeleteCache(rid,mid){
  if(!mid)return "";
  const q=await ctx.pool.query("DELETE FROM hz_message_cache WHERE room_id=$1 AND message_id=$2 AND created_at >= NOW() - INTERVAL '24 hours' RETURNING message_text",[rid,mid]);
  return q.rows[0]?.message_text||"";
}

function manageHelp(){return require('../shared/help').formatCommandHelp({manage:true,game:false},'관리')}

async function profileObserve(c,rid,uid,name,url,openLink){
  if(!uid)return;
  
const validLink = openLink !== undefined
  ? ctx.validOpenProfileLink(openLink)
  : null;

const hasLink = typeof validLink === 'string' && validLink.length > 0;
const link = hasLink ? validLink : null;

  const q=await c.query("SELECT name,last_profile_url,observed_open_profile_link FROM hz_members WHERE room_id=$1 AND user_id=$2",[rid,uid]);
  if(!q.rows.length){await c.query("INSERT INTO hz_members(room_id,user_id,name,last_profile_url,observed_open_profile_link) VALUES($1,$2,$3,$4,$5)",[rid,uid,name||uid,url||null,link]);return null}
  
  const old = q.rows[0];

  const nameChanged = Boolean(
    name && old.name && name !== old.name
  );

  function normalizeProfileUrl(value) {
    if (!value || typeof value !== 'string') return '';

    try {
      const parsed = new URL(value);
      return parsed.origin + parsed.pathname;
    } catch {
      return value.trim();
    }
  }

  const imageChanged = Boolean(
    url &&
    old.last_profile_url &&
    normalizeProfileUrl(url) !==
      normalizeProfileUrl(old.last_profile_url)
  );

  const linkChanged = Boolean(
    hasLink &&
    old.observed_open_profile_link &&
    old.observed_open_profile_link !== link
  );

  const changed = nameChanged || imageChanged || linkChanged;

  await c.query(
    "UPDATE hz_members SET name=COALESCE(NULLIF($3,''),name),last_profile_url=COALESCE(NULLIF($4,''),last_profile_url),observed_open_profile_link=CASE WHEN $5::boolean THEN $6::text ELSE observed_open_profile_link END,last_seen=NOW() WHERE room_id=$1 AND user_id=$2",
    [rid,uid,name||"",url||"",hasLink,link]
  );

  if(changed){
    const nextLink=hasLink?link:old.observed_open_profile_link;
    await c.query("INSERT INTO hz_profiles(room_id,user_id,old_name,new_name,old_profile_url,new_profile_url,old_open_profile_link,new_open_profile_link) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[rid,uid,old.name,name||old.name,old.last_profile_url,url||old.last_profile_url,old.observed_open_profile_link,nextLink]);
    return {oldName:old.name,newName:name||old.name,oldUrl:old.last_profile_url,newUrl:url||old.last_profile_url,oldOpenLink:old.observed_open_profile_link,newOpenLink:nextLink,profileChanged:imageChanged||linkChanged}
  }
  return null
}

async function addChatCount(rid,uid,name){
  if(!uid||uid===ctx.globalBotId)return;
  await ctx.pool.query(`INSERT INTO hz_chat_stats(room_id,user_id,name,chat_count,first_chat_at,last_chat_at)
    VALUES($1,$2,$3,1,NOW(),NOW())
    ON CONFLICT(room_id,user_id) DO UPDATE SET
      name=EXCLUDED.name,
      chat_count=hz_chat_stats.chat_count+1,
      last_chat_at=NOW()`,[rid,uid,name||uid])
}

async function chatInfo(rid,uid){
  const q=await ctx.pool.query(`SELECT name,chat_count,first_chat_at,last_chat_at,
    (SELECT COUNT(*)+1 FROM hz_chat_stats b WHERE b.room_id=a.room_id AND b.chat_count>a.chat_count) AS rank
    FROM hz_chat_stats a WHERE room_id=$1 AND user_id=$2`,[rid,uid]);
  if(!q.rows.length)return {count:0,rank:null,days:0,avg:0};
  const r=q.rows[0],count=Number(r.chat_count||0);
  const first=new Date(r.first_chat_at),last=new Date(r.last_chat_at);
  const days=Math.max(1,Math.floor((last-first)/86400000)+1);
  return {count,rank:Number(r.rank),days,avg:count/days}
}

async function chatRanking(rid){
  return (await ctx.pool.query("SELECT user_id,name,chat_count FROM hz_chat_stats WHERE room_id=$1 AND user_id<>$2 ORDER BY chat_count DESC,last_chat_at ASC LIMIT 10",[rid,ctx.globalBotId])).rows
}

function messageFingerprint(msg,text){return require('./spam').fingerprint(msg,text);}

async function kickMember(msg,targetId){
  if(!ctx.globalChat || typeof ctx.globalChat.openChatKick!=="function")
    throw new Error("KakaoForge openChatKick 함수를 사용할 수 없습니다.");
  const rid=ctx.id(msg.room?.id), uid=ctx.id(targetId);
  if(!rid || !/^\d{4,}$/.test(uid))throw new Error("방 ID 또는 대상 사용자 ID가 올바르지 않습니다.");
  const result=await ctx.globalChat.openChatKick(rid,uid);
  // Some implementations resolve a promise without actually removing a member.
  console.log("[NEXUS KICK API]",JSON.stringify({roomId:rid,targetId:uid,result:result===undefined?"undefined":result}));
  if(result===false || result?.success===false || result?.ok===false || result?.status==="error" || (typeof result?.status==="number" && result.status!==0))
    throw new Error("강퇴 API가 실패를 반환했습니다: "+JSON.stringify(result).slice(0,400));
  return result;
}

async function autoSpamCheck(msg,chat,rid,uid,name,text,isSelf,flags){return require('./spam').check(ctx,msg,chat,rid,uid,name,text,isSelf,flags);}

async function handleManageStats(d,c,msg){
  const text=String(msg.message?.text??msg.text??"").trim();
  const uid=ctx.senderExactId(msg),name=String(msg.sender?.name||uid);
  if(text==="#채팅순위"){
    const a=await ctx.chatRanking(msg.room.id);
    return "💬 채팅 순위 TOP 10\n\n"+(a.length?a.map((x,i)=>`${i+1}위 ${x.name||x.user_id} · ${ctx.n(x.chat_count)}회`).join("\n"):"아직 채팅 기록이 없습니다.");
  }
  if(text==="#채팅정보"){
    const s=await ctx.chatInfo(msg.room.id,uid);
    return `💬 ${name}님의 채팅 정보\n\n🏆 채팅 순위: ${s.rank?s.rank+"위":"기록 없음"}\n💬 총 채팅: ${ctx.n(s.count)}회\n📅 활동 일수: ${ctx.n(s.days)}일\n📊 일평균: ${s.avg.toFixed(1)}회`;
  }
  if(text==="#출석" || text==="#출석순위" || /^#출석확인(?:\s|$)/.test(text)){
     if(/^#출석확인(?:\s|$)/.test(text) &&
       !ctx.isManagerType(msg.sender?.type) && ctx.senderExactId(msg)!==ctx.globalBotId)
       return "⛔ 방장·부방장 또는 봇 계정만 사용할 수 있습니다.";
    const today=ctx.dayK();
    // Import legacy JSON attendance once, preserving original order and check-in time.
    const legacy=Array.isArray(d.attendance?.[today])?d.attendance[today]:[];
    for(let i=0;i<legacy.length;i++){
      const old=legacy[i];
      const oldId=ctx.id(old?.id);
      if(!/^\d{4,}$/.test(oldId))continue;
      await c.query(
        `INSERT INTO hz_attendance(room_id,day_key,user_id,name,checked_at,display_time)
         VALUES($1,$2,$3,$4,($5::date + ($6::int * interval '1 millisecond')) AT TIME ZONE 'Asia/Seoul',$7)
         ON CONFLICT(room_id,day_key,user_id) DO NOTHING`,
        [ctx.id(msg.room.id),today,oldId,String(old.name||oldId),today,i,old.time||""]
      );
    }
    // The new table is the source of truth; never rewrite old check-ins.
    const roomId=ctx.id(msg.room.id);
    if(text==="#출석"){
      if(!/^\d{4,}$/.test(uid))return "사용자 ID를 확인할 수 없어 출석할 수 없습니다. #내아이디 결과를 확인해 주세요.";
      const existing=await c.query(
        "SELECT name,display_time FROM hz_attendance WHERE room_id=$1 AND day_key=$2 AND user_id=$3",
        [roomId,today,uid]
      );
      if(existing.rows.length){
        const ranking=await c.query(
          `SELECT user_id,ROW_NUMBER() OVER(ORDER BY checked_at,user_id) AS place
           FROM hz_attendance WHERE room_id=$1 AND day_key=$2`,[roomId,today]);
        const place=ranking.rows.find(x=>x.user_id===uid)?.place;
        return `${name}님은 오늘 이미 출석했습니다.\n출석 순위: ${place||"확인 중"}등`;
      }
      const time=ctx.nowK();
      await c.query(
        `INSERT INTO hz_attendance(room_id,day_key,user_id,name,display_time)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [roomId,today,uid,name,time]
      );
      const ranking=await c.query(
        `SELECT user_id,ROW_NUMBER() OVER(ORDER BY checked_at,user_id) AS place
         FROM hz_attendance WHERE room_id=$1 AND day_key=$2`,[roomId,today]);
      const place=ranking.rows.find(x=>x.user_id===uid)?.place;
      return `✅ ${name}님 출석 완료!\n오늘 ${place}번째입니다.`;
    }
    if(text==="#출석순위"){
      const q=await c.query(
        `SELECT name,display_time,checked_at FROM hz_attendance
         WHERE room_id=$1 AND day_key=$2 ORDER BY checked_at,user_id LIMIT 10`,
        [roomId,today]
      );
      return "📅 오늘의 출석 순위\n"+(q.rows.length
        ?q.rows.map((x,i)=>`${i+1}등 ${x.name} · ${x.display_time||new Date(x.checked_at).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}`).join("\n")
        :"아직 출석자가 없습니다.");
    }
    let t=await ctx.commandTarget(c,roomId,msg,text);
    if(!t)return "사용법: #출석확인 @(멘션) 또는 사용자 ID";
    t=await ctx.resolveTarget(c,roomId,t);
    const q=await c.query(
      `SELECT user_id,name,display_time,ROW_NUMBER() OVER(ORDER BY checked_at,user_id) AS place
       FROM hz_attendance WHERE room_id=$1 AND day_key=$2`,[roomId,today]);
    const found=q.rows.find(x=>x.user_id===t.id);
    return found?`${found.name}님 출석 완료 · ${found.place}등 · ${found.display_time||"시간 확인 불가"}`
      :`${t.name||t.id}님은 오늘 출석하지 않았습니다.`;
  }
  return null;
}

async function handleManage(d,c,msg,isSelf){
  const text=String(msg.message?.text??msg.text??"").trim(),uid=ctx.id(msg.sender?.id??msg.senderId),name=String(msg.sender?.name||uid);
  if(!ctx.isManagerType(msg.sender?.type)&&!isSelf)return null;
  let t=await ctx.commandTarget(c,msg.room.id,msg,text),m;

  m=/^#경고\s+[\s\S]*?\s+(\d+)\s+(.+)$/.exec(text);
  if(m){
    if(!t)return "실제 멘션 또는 해시로 대상을 지정해주세요.";
    if(Number(ctx.globalClient?._resolveMemberType?.(msg.room.id,t.id))===8)return "🤖 오픈채팅봇에는 경고를 주지 않습니다.";
    const cnt=Number(m[1]);if(cnt<1||cnt>100)return "경고 개수는 1~100으로 입력해주세요.";
    if(t.id===ctx.globalBotId)return "봇 계정에는 경고를 줄 수 없습니다.";
    await c.query("INSERT INTO hz_warnings(room_id,target_id,target_name,count,reason,issuer_id,issuer_name) VALUES($1,$2,$3,$4,$5,$6,$7)",[msg.room.id,t.id,t.name||t.id,cnt,m[2],uid,name]);
    const wc=await ctx.activeWarningCount(c,msg.room.id,t.id);
    if(wc>=4){
      try{
        await ctx.kickMember(msg,t.id);
        return `🚫 ${t.name||t.id}님이 경고 ${wc}개에 도달하여 자동 벤 처리되었습니다.\n마지막 사유: ${m[2]}`;
      }catch(e){console.error("[HZ WARNING BAN]",e);return `⚠️ ${t.name||t.id}님 경고 ${wc}개\n벤 기준에 도달했지만 강퇴에 실패했습니다.`}
    }
    return `⚠️ ${t.name||t.id}님에게 경고 ${cnt}개 지급\n이유: ${m[2]}\n현재 경고: ${wc}/4`;
  }
  m=/^#경고삭제\s+[\s\S]*?\s+(\d+)\s*$/.exec(text);
  if(m){if(!t)return "실제 멘션 또는 해시로 대상을 지정해주세요.";const q=await c.query("SELECT id FROM hz_warnings WHERE room_id=$1 AND target_id=$2 AND deleted_at IS NULL ORDER BY id ASC",[msg.room.id,t.id]),i=Number(m[1])-1;if(i<0||i>=q.rows.length)return "해당 경고 번호가 없습니다.";await c.query("UPDATE hz_warnings SET deleted_at=NOW(),deleted_by=$2 WHERE id=$1",[q.rows[i].id,uid]);return `🗑️ ${t.name||t.id}님의 ${m[1]}번째 경고 기록을 삭제했습니다.`}
  if(text.startsWith("#경고내역")){if(!t)return "사용법: #경고내역 @(멘션) 또는 해시";const q=await c.query("SELECT count,reason,issuer_name,created_at FROM hz_warnings WHERE room_id=$1 AND target_id=$2 AND deleted_at IS NULL ORDER BY id ASC",[msg.room.id,t.id]),sum=q.rows.reduce((s,x)=>s+x.count,0);return `⚠️ ${t.name||t.id} 경고: 총 ${sum}개\n${ctx.MORE}\n`+(q.rows.length?q.rows.map((x,i)=>`#${i+1} +${x.count} | ${x.reason} | ${x.issuer_name||"?"} | ${new Date(x.created_at).toLocaleString("ko-KR")}`).join("\n"):"경고 기록 없음")}
  if(text.startsWith("#입퇴장로그")){
    if(!t)return "사용법: #입퇴장로그 @(멘션) 또는 해시";
    const a=await c.query("SELECT join_count,leave_count,name FROM hz_members WHERE room_id=$1 AND user_id=$2",[msg.room.id,t.id]);
    const q=await c.query("SELECT event_type,created_at,name,meta FROM hz_events WHERE room_id=$1 AND user_id=$2 ORDER BY id DESC LIMIT 500",[msg.room.id,t.id]);
    const r=a.rows[0]||{join_count:0,leave_count:0,name:t.name};
    const latestJoin=q.rows.find(x=>x.event_type==="join");
    const came=latestJoin?new Date(latestJoin.created_at).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"}):"기록 없음";
    return `🚪 ${r.name||t.name||t.id} 입퇴장 로그\n입장 ${r.join_count}회 · 퇴장 ${r.leave_count}회\n🕒 최근 입장: ${came}\n${ctx.MORE}\n`+
      (q.rows.length?q.rows.map(x=>{
        const actor=x.meta?.actorName||x.meta?.actor||"";
        const label=x.event_type==="join"?"입장":x.event_type==="leave"?"퇴장":"강퇴";
        return `${label}${x.event_type==="kick"&&actor?` | 실행자: ${actor}`:""} | ${new Date(x.created_at).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}`
      }).join("\n"):"기록 없음")
  }
  if(/^#프로필로그(?:\s|$)/.test(text)){if(!t)return "사용법: #프로필로그 @(실제 멘션), 사용자 ID 또는 대상 메시지에 답장·댓글";return require("./profile-history").message(c,msg.room.id,t);}
  if(text==="#아이디"||text.startsWith("#아이디 ")){
    if(!ctx.isManagerType(msg.sender?.type))return "⛔ 방장·부방장만 사용할 수 있습니다.";
    const it=await ctx.idCommandTarget(c,msg.room.id,msg,text);
    if(!it)return "❌ 대상의 정확한 ID를 확인하지 못했습니다.\n실제 멘션 또는 답장으로 시도해 주세요.\n채팅 기록에 없는 사용자는 ID를 확인할 수 없을 수 있습니다.";
    return `🔎 아이디 확인\n${ctx.MORE}\n👤 ${it.name||it.id}\n카카오 사용자 ID: ${it.id}`;
  }
  if(/^#(?:kick|k)(?:\s|$)/.test(text)){
    // 명시적 ID/멘션을 우선하고, 답장만 있는 경우 원작성자 ID를 추출한다.
    if(!t){
      const replyBan=ctx.replyTargetFrom(msg);
      if(replyBan)t=await ctx.resolveTarget(c,msg.room.id,replyBan);
    }
    if(!t)return "❌ 강퇴 대상을 확인하지 못했습니다.\n사용법: #kick @닉네임 또는 #k (카카오 사용자 ID)\n답장 대상 ID가 확인되지 않으면 강퇴하지 않습니다.";
    if(!/^\d{4,}$/.test(String(t.id)))return "❌ 올바른 카카오 사용자 ID가 아닙니다.";
    if(t.id===ctx.globalBotId)return "봇 계정은 벤할 수 없습니다.";
    if(t.id===uid)return "자기 자신은 벤할 수 없습니다.";
    // DB에서 실제 이 방에서 관측된 사용자 ID인지 확인한다.
    const known=await c.query(`SELECT 1 FROM hz_members WHERE room_id=$1 AND user_id=$2
      UNION ALL SELECT 1 FROM hz_chat_stats WHERE room_id=$1 AND user_id=$2 LIMIT 1`,[msg.room.id,t.id]);
    if(!known.rows.length)return "❌ 이 방에서 대상 ID를 검증하지 못했습니다. 대상자가 메시지를 보낸 후 다시 시도해 주세요.";
    if(!ctx.globalChat||typeof ctx.globalChat.openChatKick!=="function")return "❌ 현재 KakaoForge 연결에서 openChatKick 기능을 사용할 수 없습니다.";
    try{
      const key=ctx.id(msg.room.id)+":"+ctx.id(t.id);
      const oldPending=ctx.pendingManualKicks.get(key);
      if(oldPending)clearTimeout(oldPending.timer);
      const pending={name:t.name||t.id,confirmed:false,timer:null};
      ctx.pendingManualKicks.set(key,pending);
      try{
        await ctx.kickMember(msg,t.id);
      }catch(e){
        ctx.pendingManualKicks.delete(key);
        throw e;
      }
      if(pending.confirmed)return `🚫 벤 완료\n대상: ${pending.name}\n아이디: ${t.id}`;
      pending.timer=setTimeout(async()=>{
        if(ctx.pendingManualKicks.get(key)!==pending)return;
        ctx.pendingManualKicks.delete(key);
        try{await ctx.send(ctx.globalChat,ctx.id(msg.room.id),`⚠️ ${pending.name}님 강퇴 확인 실패\n강퇴 이벤트가 감지되지 않았습니다. 실제 퇴장 여부와 봇의 방장/부방장 권한을 확인해 주세요.\nRailway 로그의 [NEXUS KICK API] 반환값도 확인해 주세요.`)}
        catch(e){console.error("[NEXUS KICK VERIFY]",e)}
      },12000);
      return `⏳ ${pending.name}님 벤 요청 중\n아이디: ${t.id}`;
    }catch(e){
      console.error("[NEXUS BAN]",e);
      const reason=String(e?.message||e||"알 수 없는 오류").slice(0,240);
      return `❌ 강퇴 실패: ${reason}\n봇이 해당 오픈채팅방의 방장/부방장인지 확인해 주세요.`;
    }
  }
  return null
}

function promoSlot(now,minutes){
  const seoul=now+9*3600000;
  const dayStart=Math.floor(seoul/86400000)*86400000;
  const interval=minutes*60000;
  return Math.floor((seoul-dayStart)/interval)*interval+dayStart-9*3600000;
}

async function promoTick(){if(!ctx.economyEnabled)return;await require("../promotion").tick(ctx.globalChat);}

return {formatMemberTemplate,isManagerType,isOwnerType,isSubManagerType,safeUserId,parseExactAttachment,exactId,attachmentRoots,rawMentions,targetFrom,resolveTarget,commandTarget,senderExactId,processMentionAlerts,deepFindUserId,replyTargetFrom,idCommandTarget,lastJoinAt,activeWarningCount,validOpenProfileLink,findOpenProfileLink,profileDiagnostic,saveOpenProfileLink,extractProfile,pickDeleteRoom,pickDeleteActor,pickDeletedText,originalMessageId,deletedMessageId,saveDeleteCache,lookupDeleteCache,manageHelp,profileObserve,addChatCount,chatInfo,chatRanking,messageFingerprint,kickMember,autoSpamCheck,handleManageStats,handleManage,promoSlot,promoTick};
};
