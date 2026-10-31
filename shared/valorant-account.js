'use strict';
// A saved Riot ID is a per-user shortcut, never evidence of Riot ownership/consent.
const {getPool}=require('./db');
const stats=require('./valorant-stats');
const COMMANDS=new Set(['!발로저장','!발로전적확인','!발로삭제']);
const SCHEMA="CREATE TABLE IF NOT EXISTS hz_valorant_saved_accounts ("+
 "kakao_user_id TEXT PRIMARY KEY, riot_name TEXT NOT NULL, riot_tag TEXT NOT NULL, "+
 "region TEXT NOT NULL CHECK(region IN ('kr','ap','eu','na','br','latam')), "+
 "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())";
let defaultSchemaPromise=null;
function validUser(value){
 const user=String(value??'').trim();
 return user.length>0&&user.length<=128&&!/[\u0000-\u001f\u007f]/.test(user)?user:'';
}
async function ensureSchema(db,shared){
 if(!shared){await db.query(SCHEMA);return;}
 if(!defaultSchemaPromise)defaultSchemaPromise=db.query(SCHEMA).catch(error=>{defaultSchemaPromise=null;throw error;});
 await defaultSchemaPromise;
}
async function save({userId,target,db}){
 const user=validUser(userId);
 if(!user)throw Error('사용자 ID를 확인할 수 없습니다.');
 const pool=db||getPool();
 await ensureSchema(pool,!db);
 await pool.query(
  "INSERT INTO hz_valorant_saved_accounts(kakao_user_id,riot_name,riot_tag,region) VALUES($1,$2,$3,$4) "+
  "ON CONFLICT(kakao_user_id) DO UPDATE SET riot_name=EXCLUDED.riot_name,riot_tag=EXCLUDED.riot_tag,region=EXCLUDED.region,updated_at=NOW()",
  [user,target.name,target.tag,target.region]
 );
}
async function load({userId,db}){
 const user=validUser(userId);
 if(!user)throw Error('사용자 ID를 확인할 수 없습니다.');
 const pool=db||getPool();
 await ensureSchema(pool,!db);
 const result=await pool.query(
  "SELECT riot_name,riot_tag,region FROM hz_valorant_saved_accounts WHERE kakao_user_id=$1",[user]);
 const row=result.rows[0];
 return row?{name:row.riot_name,tag:row.riot_tag,region:row.region}:null;
}
async function remove({userId,db}){
 const user=validUser(userId);
 if(!user)throw Error('사용자 ID를 확인할 수 없습니다.');
 const pool=db||getPool();
 await ensureSchema(pool,!db);
 const result=await pool.query("DELETE FROM hz_valorant_saved_accounts WHERE kakao_user_id=$1",[user]);
 return result.rowCount>0;
}
async function handle({text,userId,send,env=process.env,db,fetcher,roomId}){
 const trimmed=String(text||'').trim();
 const command=trimmed.split(/\s+/)[0];
 if(!COMMANDS.has(command))return false;
 const user=validUser(userId);
 if(!user){await send('❌ 카카오톡 사용자 정보를 확인할 수 없습니다.');return true;}
 try{
  if(command==='!발로저장'){
   const tail=trimmed.slice(command.length).trim();
   const target=stats.parse('!발로전적 '+tail);
   if(target.usage||target.error){
    await send('❌ '+(target.error||'Riot ID를 입력해 주세요.')+'\n사용법: !발로저장 닉네임#태그 [서버]\n예: !발로저장 bsh#3333 kr');
    return true;
   }
   await save({userId:user,target,db});
   await send('✅ 발로란트 계정 저장: '+target.name+'#'+target.tag+' · '+target.region.toUpperCase()+' 서버\n'+
    '!발로전적확인으로 저장한 계정을 바로 조회할 수 있습니다.');
   return true;
  }
  if(trimmed!==command){
   await send('사용법: '+command);
   return true;
  }
  if(command==='!발로삭제'){
   const removed=await remove({userId:user,db});
   await send(removed?'✅ 저장된 발로란트 계정을 삭제했습니다.':'저장된 발로란트 계정이 없습니다.');
   return true;
  }
  const target=await load({userId:user,db});
  if(!target){
   await send('등록된 발로란트 계정이 없습니다.\n!발로저장 닉네임#태그 [서버]로 먼저 저장해 주세요.');
   return true;
  }
  // Saved shortcut is only valid for this sender's exact DB record;
  // stats.handle re-verifies it and retains external API rate limits.
  await stats.handle({text:'!발로전적 '+target.name+'#'+target.tag+' '+target.region,
   roomId,userId:user,send,env,fetcher,db,allowSavedAccount:true});
  return true;
 }catch(error){
  console.warn('[NEXI VALORANT SAVE]',String(error?.code||'DB_ERROR'));
  await send('❌ 발로란트 계정 저장/조회에 실패했습니다. 데이터베이스 연결을 확인해 주세요.');
  return true;
 }
}
module.exports={COMMANDS,handle,save,load,remove,validUser};
