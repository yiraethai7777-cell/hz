'use strict';
const fs=require('node:fs'),path=require('node:path'),{performance}=require('node:perf_hooks');
const FIXED={
 'command-counts.json':'duke_command_counts',
 'membership-settings.json':'duke_membership_settings',
 'reply-moderation.json':'duke_reply_moderation',
 'profile-watch-settings.json':'duke_profile_watch_settings',
 'delete-watch-settings.json':'duke_delete_watch_settings',
 'edit-watch-settings.json':'duke_edit_watch_settings',
 'bot-power.json':'duke_bot_power',
 'room-modes.json':'duke_room_modes',
 'game-cooldowns.json':'duke_game_cooldowns'
};
const TABLES=[...Object.values(FIXED),'duke_management_logs','duke_warnings','duke_activity','duke_game_accounts','duke_quiz_history','duke_attendance'];
function tableFor(key){return Object.hasOwn(FIXED,key)?FIXED[key]:/^management-logs\/[1-9]\d*\.json$/.test(key)?'duke_management_logs':/^warnings\/[1-9]\d*\.json$/.test(key)?'duke_warnings':/^activity\/[1-9]\d*\.json$/.test(key)?'duke_activity':/^game-accounts\/[1-9]\d*\.json$/.test(key)?'duke_game_accounts':/^quiz-history\/[1-9]\d*\.json$/.test(key)?'duke_quiz_history':/^attendance\/[1-9]\d*-\d{4}-(?:0[1-9]|1[0-2])\.json$/.test(key)?'duke_attendance':null;}
function createDatabase({dir,pool,logger=console,expectedDatabase='duke',intervalMs=1000}={}){
 if(!dir||!pool)throw Error('database configuration required');
 const dirty=new Map();let seq=0,connected=false,dbMs=null,lastHealth=0,timer=null,inFlight=null;
 function mark(key){if(tableFor(key))dirty.set(key,++seq);}
 function status(){return {database:connected?(dirty.size?'연결됨 (저장 대기 '+dirty.size+'건)':'정상'):'연결 끊김 (로컬 저장 유지)',dbMs:connected?dbMs:null};}
 function localKeys(){
  const keys=Object.keys(FIXED).filter(k=>fs.existsSync(path.join(dir,k)));
  for(const folder of ['management-logs','warnings','activity','game-accounts','quiz-history','attendance'])try{for(const name of fs.readdirSync(path.join(dir,folder)))if(tableFor(folder+'/'+name))keys.push(folder+'/'+name);}catch(e){if(e.code!=='ENOENT')throw e;}
  return keys;
 }
 function restore(key,payload){if(!tableFor(key))return;const file=path.join(dir,key);if(fs.existsSync(file))return;fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const tmp=file+'.restore';fs.writeFileSync(tmp,JSON.stringify(payload),{mode:0o600});fs.renameSync(tmp,file);}
 async function check(){
  const at=performance.now(),res=await pool.query('SELECT current_database() AS name');
  if(res.rows[0]?.name!==expectedDatabase)throw Error('unexpected database');
  dbMs=Math.round((performance.now()-at)*1000)/1000;lastHealth=Date.now();connected=true;
 }
 async function writeBatch(table,rows){
  if(!rows.length)return;
  await pool.query('INSERT INTO '+table+' (storage_key,payload,updated_at) SELECT x.storage_key,x.payload,now() FROM jsonb_to_recordset($1::jsonb) AS x(storage_key text,payload jsonb) ON CONFLICT(storage_key) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()', [JSON.stringify(rows)]);
 }
 async function flushImpl(forceHealth=false){
  try{
   if(forceHealth||!connected||Date.now()-lastHealth>=30000)await check();
   const batch=[...dirty.entries()];const groups=new Map();
   for(const [key,version] of batch){const table=tableFor(key);if(!table)continue;const payload=JSON.parse(await fs.promises.readFile(path.join(dir,key),'utf8'));const entries=groups.get(table)||[];entries.push({key,version,payload});groups.set(table,entries);}
   for(const [table,entries] of groups){await writeBatch(table,entries.map(e=>({storage_key:e.key,payload:e.payload})));for(const e of entries)if(dirty.get(e.key)===e.version)dirty.delete(e.key);}
   connected=true;return true;
  }catch(e){connected=false;dbMs=null;logger.error('[DUKE DB] synchronization failed',e?.code||e?.name||'Error');return false;}
 }
 function flush(forceHealth=false){if(!inFlight)inFlight=flushImpl(forceHealth).finally(()=>{inFlight=null;});return inFlight;}
 async function init(){
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  await check();
  for(const table of TABLES)await pool.query('CREATE TABLE IF NOT EXISTS '+table+' (storage_key TEXT PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  // Local durable snapshots are the write-ahead recovery source. Never overwrite a
  // surviving local file with a possibly lagging database copy.
  for(const table of TABLES){const res=await pool.query('SELECT storage_key,payload FROM '+table);for(const row of res.rows)if(tableFor(row.storage_key)===table)restore(row.storage_key,row.payload);}
  for(const key of localKeys())mark(key);
  if(!await flush(true))throw Error('initial DB migration failed');
  logger.log('[DUKE DB] connected; schema and local migration verified');
  timer=setInterval(()=>{void flush();},intervalMs);timer.unref?.();
 }
 async function close(){if(timer)clearInterval(timer);await flush();await pool.end?.();}
 return {init,mark,status,flush,close};
}
async function connectDatabase({dir,url,logger=console}){
 if(!url)throw Error('DUKE_DATABASE_URL not configured');
 const {Pool}=require('pg');
 const pool=new Pool({connectionString:url,max:2,connectionTimeoutMillis:5000,idleTimeoutMillis:30000,query_timeout:10000,application_name:'duke-bot'});
 pool.on('error',e=>logger.error('[DUKE DB] idle connection error',e?.code||e?.name||'Error'));
 const db=createDatabase({dir,pool,logger});
 try{await db.init();return db;}catch(e){await pool.end();throw e;}
}
module.exports={createDatabase,connectDatabase,tableFor};
