"use strict";
// Persistent state is supplied explicitly; this module registers no client listener.
module.exports = function createFeatures(ctx) {
function n(v){return Number(v||0).toLocaleString("ko-KR")}

function norm(s){return String(s||"").toLowerCase().replace(/\s+/g,"").replace(/[.,!?~'\"·]/g,"")}

function nowK(){return new Date().toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}

function dayK(){const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const x=Object.fromEntries(parts.map(p=>[p.type,p.value]));return `${x.year}-${x.month}-${x.day}`}

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}

function id(v){return v===undefined||v===null?"":String(v)}

function blankRoom(name){
  return {name:name||"",game:false,quizEnabled:true,fishEnabled:true,manage:false,locked:false,players:{},attendance:{},quiz:null,quizQueue:[],lastQuiz:-1}
}

function fixRoom(d,name){
  d=d&&typeof d==="object"?d:ctx.blankRoom(name);
  d.name=name||d.name||"";
  d.game=!!d.game; d.quizEnabled=d.quizEnabled!==false; d.fishEnabled=d.fishEnabled!==false; d.manage=!!d.manage; d.locked=!!d.locked;
  d.players=d.players||{}; d.attendance=d.attendance||{};
  d.quizQueue=Array.isArray(d.quizQueue)?d.quizQueue:[];
  d.promo=d.promo&&typeof d.promo==="object"?d.promo:{};
  d.promo.enabled=!!d.promo.enabled;
  d.promo.antiSpam=d.promo.antiSpam!==false;
  d.promo.sentTimes=Array.isArray(d.promo.sentTimes)?d.promo.sentTimes:[];
  return d
}

async function initDb(){await ctx.pool.query(`
CREATE TABLE IF NOT EXISTS hz_rooms(room_id TEXT PRIMARY KEY,data JSONB NOT NULL DEFAULT '{}'::jsonb,updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE TABLE IF NOT EXISTS hz_members(room_id TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT,join_count INT NOT NULL DEFAULT 0,leave_count INT NOT NULL DEFAULT 0,last_profile_url TEXT,last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,user_id));
ALTER TABLE hz_members ADD COLUMN IF NOT EXISTS open_profile_link TEXT;
ALTER TABLE hz_members ADD COLUMN IF NOT EXISTS observed_open_profile_link TEXT;
ALTER TABLE hz_members ADD COLUMN IF NOT EXISTS observed_profile_name TEXT;
CREATE TABLE IF NOT EXISTS hz_events(id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT,event_type TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),meta JSONB NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE IF NOT EXISTS hz_ban_registry(
 room_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 name TEXT,
 registered_by TEXT NOT NULL,
 registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(room_id,user_id)
);
CREATE TABLE IF NOT EXISTS hz_warnings(id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,target_id TEXT NOT NULL,target_name TEXT,count INT NOT NULL,reason TEXT NOT NULL,issuer_id TEXT NOT NULL,issuer_name TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),deleted_at TIMESTAMPTZ,deleted_by TEXT);
CREATE TABLE IF NOT EXISTS hz_profiles(id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,user_id TEXT NOT NULL,old_name TEXT,new_name TEXT,old_profile_url TEXT,new_profile_url TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
ALTER TABLE hz_profiles ADD COLUMN IF NOT EXISTS old_open_profile_link TEXT;
ALTER TABLE hz_profiles ADD COLUMN IF NOT EXISTS new_open_profile_link TEXT;
CREATE TABLE IF NOT EXISTS hz_profile_outbox(
 profile_id BIGINT PRIMARY KEY REFERENCES hz_profiles(id),room_id TEXT NOT NULL,bot_id TEXT NOT NULL,
 client_msg_id INTEGER NOT NULL,body TEXT NOT NULL CHECK(length(body)<=4500),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','uncertain')),
 claim_token TEXT,attempts INTEGER NOT NULL DEFAULT 0,retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 claimed_at TIMESTAMPTZ,sent_at TIMESTAMPTZ,log_id TEXT,last_error TEXT,
 UNIQUE(room_id,bot_id,client_msg_id)
);
CREATE INDEX IF NOT EXISTS hz_profile_outbox_pending_idx ON hz_profile_outbox(room_id,profile_id) WHERE state='pending';
CREATE TABLE IF NOT EXISTS hz_attendance(
  room_id TEXT NOT NULL,
  day_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  display_time TEXT,
  PRIMARY KEY(room_id,day_key,user_id)
);
CREATE INDEX IF NOT EXISTS hz_attendance_rank_idx
  ON hz_attendance(room_id,day_key,checked_at,user_id);
CREATE TABLE IF NOT EXISTS hz_mention_alerts(
 id BIGSERIAL PRIMARY KEY, room_id TEXT NOT NULL, target_id TEXT NOT NULL,
 sender_id TEXT NOT NULL, sender_name TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), notified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS hz_mention_alerts_pending_idx ON hz_mention_alerts(room_id,target_id,id) WHERE notified_at IS NULL;
CREATE TABLE IF NOT EXISTS hz_chat_stats(room_id TEXT NOT NULL,user_id TEXT NOT NULL,name TEXT,chat_count BIGINT NOT NULL DEFAULT 0,first_chat_at TIMESTAMPTZ,last_chat_at TIMESTAMPTZ,PRIMARY KEY(room_id,user_id));
CREATE TABLE IF NOT EXISTS hz_message_cache(room_id TEXT NOT NULL,message_id TEXT NOT NULL,message_text TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,message_id));
CREATE INDEX IF NOT EXISTS hz_message_cache_created_idx ON hz_message_cache(created_at);
CREATE TABLE IF NOT EXISTS hz_deleted_messages(id BIGSERIAL PRIMARY KEY,room_id TEXT NOT NULL,deleter_id TEXT,deleter_name TEXT,message_text TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),meta JSONB NOT NULL DEFAULT '{}'::jsonb);
CREATE INDEX IF NOT EXISTS hz_events_user_idx ON hz_events(room_id,user_id,id DESC);
CREATE INDEX IF NOT EXISTS hz_warn_user_idx ON hz_warnings(room_id,target_id,id);
CREATE INDEX IF NOT EXISTS hz_profile_user_idx ON hz_profiles(room_id,user_id,id DESC);
CREATE INDEX IF NOT EXISTS hz_chat_rank_idx ON hz_chat_stats(room_id,chat_count DESC);
`)}

async function withRoom(rid,rname,fn){
  const c=await ctx.pool.connect();
  try{
    await c.query("BEGIN");
    await c.query("INSERT INTO hz_rooms(room_id,data) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING",[rid,JSON.stringify(ctx.blankRoom(rname))]);
    const q=await c.query("SELECT data FROM hz_rooms WHERE room_id=$1 FOR UPDATE",[rid]);
    const d=ctx.fixRoom(q.rows[0].data,rname);
    const out=await fn(d,c);
    await c.query("UPDATE hz_rooms SET data=$2::jsonb,updated_at=NOW() WHERE room_id=$1",[rid,JSON.stringify(d)]);
    await c.query("COMMIT");
    return out
  }catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
}

async function roomFlags(rid){const q=await ctx.pool.query("SELECT data FROM hz_rooms WHERE room_id=$1",[rid]);return q.rows[0]?ctx.fixRoom(q.rows[0].data):ctx.blankRoom()}

async function send(chat,rid,text){
 if(!text)return;const source=String(text),pages=[];let rest=source;
 while(rest.length>4500){let at=rest.lastIndexOf('\n',4400);if(at<200)at=4400;pages.push(rest.slice(0,at));rest=rest.slice(at).replace(/^\n/,'');}pages.push(rest);
 const results=[];
 for(let i=0;i<pages.length;i++)results.push(await chat.sendText(rid,(pages.length>1?'['+(i+1)+'/'+pages.length+']\n':'')+pages[i]));
 return results;
}
return {n,norm,nowK,dayK,sleep,id,blankRoom,fixRoom,initDb,withRoom,roomFlags,send};
};
