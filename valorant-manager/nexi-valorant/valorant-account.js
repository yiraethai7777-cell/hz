'use strict';
// Multiple Riot IDs are per-user shortcuts, not proof of Riot account ownership.
const {getPool}=require('./db');
const stats=require('./valorant-stats');
const COMMANDS=new Set(['!발로저장','!발로전적확인','!발로삭제']);
const MAX_SAVED=20,MAX_BATCH=3,BATCH_COOLDOWN_MS=30000;
const SCHEMA="CREATE TABLE IF NOT EXISTS hz_valorant_saved_accounts ("+
 "kakao_user_id TEXT PRIMARY KEY, riot_name TEXT NOT NULL, riot_tag TEXT NOT NULL, "+
 "region TEXT NOT NULL CHECK(region IN ('kr','ap','eu','na','br','latam')), "+
 "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())";
const LIST_SCHEMA="CREATE TABLE IF NOT EXISTS hz_valorant_saved_account_list ("+
 "id BIGSERIAL PRIMARY KEY,kakao_user_id TEXT NOT NULL,riot_name TEXT NOT NULL,riot_tag TEXT NOT NULL,"+
 "region TEXT NOT NULL CHECK(region IN ('kr','ap','eu','na','br','latam')),"+
 "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())";
const UNIQUE_INDEX="CREATE UNIQUE INDEX IF NOT EXISTS hz_valorant_saved_account_list_unique "+
 "ON hz_valorant_saved_account_list(kakao_user_id,lower(riot_name),lower(riot_tag),region)";
let defaultSchemaPromise=null;
const lastBatch=new Map();
function validUser(value){
 const user=String(value??'').trim();
 return user.length>0&&user.length<=128&&!/[\u0000-\u001f\u007f]/.test(user)?user:'';
}
async function ensureSchema(db,shared){
 const migrate=async()=>{await db.query(SCHEMA);await db.query(LIST_SCHEMA);await db.query(UNIQUE_INDEX)};
 if(!shared){await migrate();return}
 if(!defaultSchemaPromise)defaultSchemaPromise=migrate().catch(error=>{defaultSchemaPromise=null;throw error});
 await defaultSchemaPromise;
}
async function prepare(userId,db){
 const user=validUser(userId);
 if(!user)throw Error('사용자 ID를 확인할 수 없습니다.');
 const pool=db||getPool();
 await ensureSchema(pool,!db);
 // Import a user's last single-account save exactly once; do not re-import deleted saves.
 await pool.query("INSERT INTO hz_valorant_saved_account_list(kakao_user_id,riot_name,riot_tag,region) "+
  "SELECT old.kakao_user_id,old.riot_name,old.riot_tag,old.region "+
  "FROM hz_valorant_saved_accounts old WHERE old.kakao_user_id=$1 "+
  "AND NOT EXISTS (SELECT 1 FROM hz_valorant_saved_account_list newer WHERE newer.kakao_user_id=$1) "+
  "ON CONFLICT DO NOTHING",[user]);
 return {pool,user};
}
async function list({userId,db}){
 const {pool,user}=await prepare(userId,db);
 const found=await pool.query("SELECT id,riot_name,riot_tag,region FROM hz_valorant_saved_account_list "+
  "WHERE kakao_user_id=$1 ORDER BY id ASC LIMIT 21",[user]);
 return found.rows.map((r,i)=>({id:r.id,name:r.riot_name,tag:r.riot_tag,region:r.region,index:i+1}));
}
async function syncLegacy(pool,user){
 const latest=await pool.query("SELECT riot_name,riot_tag,region FROM hz_valorant_saved_account_list "+
  "WHERE kakao_user_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 1",[user]);
 if(latest.rows[0]){
  const x=latest.rows[0];
  await pool.query("INSERT INTO hz_valorant_saved_accounts(kakao_user_id,riot_name,riot_tag,region) "+
   "VALUES($1,$2,$3,$4) ON CONFLICT(kakao_user_id) DO UPDATE SET "+
   "riot_name=$2,riot_tag=$3,region=$4,updated_at=NOW()",[user,x.riot_name,x.riot_tag,x.region]);
 }else{
  await pool.query('DELETE FROM hz_valorant_saved_accounts WHERE kakao_user_id=$1',[user]);
 }
}
async function save({userId,target,db}){
 const {pool,user}=await prepare(userId,db);
 const current=await list({userId:user,db:pool});
 const same=x=>x.name.toLocaleLowerCase('en-US')===target.name.toLocaleLowerCase('en-US')&&
  x.tag.toLocaleLowerCase('en-US')===target.tag.toLocaleLowerCase('en-US')&&x.region===target.region;
 if(!current.some(same)&&current.length>=MAX_SAVED){
  const error=Error('계정은 최대 '+MAX_SAVED+'개까지 저장할 수 있습니다. !발로삭제 번호로 정리해 주세요.');
  error.code='MAX_SAVED';throw error;
 }
 await pool.query("INSERT INTO hz_valorant_saved_account_list(kakao_user_id,riot_name,riot_tag,region) "+
  "VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[user,target.name,target.tag,target.region]);
 await pool.query("UPDATE hz_valorant_saved_account_list SET updated_at=NOW() "+
  "WHERE kakao_user_id=$1 AND lower(riot_name)=lower($2) AND lower(riot_tag)=lower($3) AND region=$4",
  [user,target.name,target.tag,target.region]);
 await syncLegacy(pool,user);
 const all=await list({userId:user,db:pool});
 const saved=all.find(same);
 return {index:saved?.index||1,count:all.length,already:current.some(same)};
}
async function load({userId,db}){
 const {pool,user}=await prepare(userId,db);
 const r=await pool.query("SELECT riot_name,riot_tag,region FROM hz_valorant_saved_account_list "+
  "WHERE kakao_user_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 1",[user]);
 return r.rows[0]?{name:r.rows[0].riot_name,tag:r.rows[0].riot_tag,region:r.rows[0].region}:null;
}
async function remove({userId,db,index}){
 const {pool,user}=await prepare(userId,db);
 const entries=await list({userId:user,db:pool});
 const position=index==null?entries.length:Number(index);
 if(!Number.isSafeInteger(position)||position<1||position>entries.length)return false;
 const target=entries[position-1];
 const deleted=await pool.query('DELETE FROM hz_valorant_saved_account_list WHERE kakao_user_id=$1 AND id=$2 RETURNING id',
  [user,target.id]);
 if(!deleted.rowCount)return false;
 await syncLegacy(pool,user);
 return true;
}
function parseSelection(raw,max){
 const value=String(raw||'').trim();
 if(!/^\d+(?:\s*,\s*\d+)*$/.test(value))return {error:'사용법: !발로전적확인 1 또는 !발로전적확인 1,2'};
 const numbers=value.split(',').map(x=>Number(x.trim()));
 if(numbers.length>MAX_BATCH)return {error:'한 번에 최대 '+MAX_BATCH+'개 계정까지 조회할 수 있습니다. (API 요청 제한)'};
 if(numbers.some(n=>!Number.isSafeInteger(n)||n<1||n>max))return {error:'존재하지 않는 계정 번호입니다. !발로전적확인으로 목록을 확인해 주세요.'};
 if(new Set(numbers).size!==numbers.length)return {error:'같은 계정 번호를 중복 선택할 수 없습니다.'};
 return {numbers};
}
function listing(entries){
 return '🎯 저장한 발로란트 계정 ('+entries.length+'/'+MAX_SAVED+')\n━━━━━━━━━━━━━━\n'+
  entries.map(p=>p.index+'. '+p.name+'#'+p.tag+' · '+p.region.toUpperCase()).join('\n')+
  '\n\n📊 조회: !발로전적확인 1 또는 !발로전적확인 1,2'+
  '\n🗑️ 삭제: !발로삭제 번호\n※ 한 번에 최대 '+MAX_BATCH+'개 전적 조회 가능';
}
async function inspect(entries,raw,{send,userId,env,fetcher}){
 const selection=parseSelection(raw,entries.length);
 if(selection.error){await send('❌ '+selection.error);return true}
 const key=validUser(userId),now=Date.now(),last=lastBatch.get(key)||0;
 if(now-last<BATCH_COOLDOWN_MS){
  await send('⏳ 여러 계정 전적 조회는 '+Math.ceil((BATCH_COOLDOWN_MS-(now-last))/1000)+'초 후 다시 이용할 수 있습니다.');
  return true;
 }
 const apiKey=String(env.HENRIKDEV_API_KEY||env.VALORANT_API_KEY||'').trim();
 if(!apiKey){await send('⚙️ 발로란트 전적 API가 설정되지 않았습니다.');return true}
 lastBatch.set(key,now);
 if(lastBatch.size>1000)lastBatch.delete(lastBatch.keys().next().value);
 for(const number of selection.numbers){
  const target=entries[number-1];
  try{
   const report=await stats.lookup(target,'!발로전적',{key:apiKey,fetcher});
   await send('📌 저장된 계정 '+number+'번 전적\n'+report);
  }catch(e){
   console.warn('[VALORANT SAVED BATCH]',String(e?.code||'LOOKUP_FAILED'));
   await send('❌ '+number+'번 '+target.name+'#'+target.tag+' 전적 조회 실패: '+
    String(e?.message||'전적 서비스를 이용할 수 없습니다.').slice(0,120));
   if(e?.code==='LIMIT'||e?.code==='HTTP_429')break;
  }
 }
 return true;
}
async function handle({text,userId,send,env=process.env,db,fetcher,roomId}){
 const trimmed=String(text||'').trim(),command=trimmed.split(/\s+/)[0];
 if(!COMMANDS.has(command))return false;
 const user=validUser(userId);
 if(!user){await send('❌ 카카오톡 사용자 정보를 확인할 수 없습니다.');return true}
 const tail=trimmed.slice(command.length).trim();
 try{
  if(command==='!발로저장'){
   const target=stats.parse('!발로전적 '+tail);
   if(!target||target.usage||target.error){
    await send('❌ '+(target?.error||'Riot ID를 입력해 주세요.')+
     '\n사용법: !발로저장 닉네임#태그 [서버]\n예: !발로저장 bsh#3333 kr');return true;
   }
   const result=await save({userId:user,target,db});
   await send((result.already?'ℹ️ 이미 저장된 계정입니다.':'✅ 계정 저장 완료')+
    '\n'+result.index+'번. '+target.name+'#'+target.tag+' · '+target.region.toUpperCase()+' 서버'+
    '\n현재 저장: '+result.count+'/'+MAX_SAVED+'개'+
    '\n목록: !발로전적확인');return true;
  }
  if(command==='!발로삭제'){
   const entries=await list({userId:user,db});
   if(!entries.length){await send('저장된 발로란트 계정이 없습니다.');return true}
   if(!tail&&entries.length>1){await send(listing(entries)+'\n\n삭제할 번호를 지정하세요: !발로삭제 2');return true}
   const index=tail===''?1:/^[1-9]\d*$/.test(tail)?Number(tail):null;
   if(!Number.isSafeInteger(index)||index>entries.length){await send('사용법: !발로삭제 (번호)\n!발로전적확인으로 번호를 확인해 주세요.');return true}
   const target=entries[index-1];
   const removed=await remove({userId:user,db,index});
   await send(removed?'✅ '+index+'번 '+target.name+'#'+target.tag+' 계정을 삭제했습니다.':'❌ 계정을 삭제하지 못했습니다.');
   return true;
  }
  const entries=await list({userId:user,db});
  if(!entries.length){
   await send('등록된 발로란트 계정이 없습니다.\n!발로저장 닉네임#태그 [서버]로 먼저 저장해 주세요.');return true;
  }
  if(!tail){await send(listing(entries));return true}
  return inspect(entries,tail,{send,userId:user,env,fetcher});
 }catch(error){
  if(error?.code==='MAX_SAVED'){await send('❌ '+error.message);return true}
  console.warn('[VALORANT SAVED ACCOUNTS]',String(error?.code||'DB_ERROR'));
  await send('❌ 발로란트 계정 저장/조회에 실패했습니다. 데이터베이스 연결을 확인해 주세요.');
  return true;
 }
}
module.exports={COMMANDS,handle,save,load,remove,list,validUser,parseSelection,listing,MAX_SAVED,MAX_BATCH};
