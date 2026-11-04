'use strict';
// NEXI command-only blocks, room-scoped. Does not change KakaoTalk membership.
const {getPool}=require('./db');
const {valid}=require('./super-admin');
let initialized=null;
const clean=s=>String(s??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
function identity(value){const v=clean(value);return /^[1-9]\d{3,24}$/.test(v)?v:'';}
async function init(db=getPool()){
 if(!initialized)initialized=db.query(`CREATE TABLE IF NOT EXISTS hz_command_blocks (
 room_id TEXT NOT NULL,user_id TEXT NOT NULL,user_name TEXT NOT NULL DEFAULT '',
 actor_id TEXT NOT NULL,reason TEXT NOT NULL DEFAULT '',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,user_id)
 )`).catch(e=>{initialized=null;throw e;});
 await initialized;
}
async function blocked(roomId,userId,db=getPool()){
 const room=identity(roomId),user=identity(userId);
 if(!room||!user)return false;
 await init(db);
 const q=await db.query('SELECT 1 FROM hz_command_blocks WHERE room_id=$1 AND user_id=$2 LIMIT 1',[room,user]);
 return (q.rowCount??q.rows.length)>0;
}
async function list(roomId,db=getPool()){
 const room=identity(roomId);if(!room)throw Error('채팅방 ID가 올바르지 않습니다.');
 await init(db);
 const q=await db.query('SELECT user_id,user_name,actor_id,reason,created_at FROM hz_command_blocks WHERE room_id=$1 ORDER BY created_at DESC LIMIT 300',[room]);
 return q.rows;
}
async function set({roomId,userId,userName='',actorId,reason='',on=true,botId='',db=getPool()}){
 const room=identity(roomId),user=identity(userId);
 if(!room||!user)throw Error('채팅방 또는 사용자 ID가 올바르지 않습니다.');
 if(on&&user===identity(botId))throw Error('봇 계정은 차단할 수 없습니다.');
 if(on){
  const superRole=require('./super-admin');
  if(await superRole.isSuperAdmin(room,user,db))throw Error('해당 방 최고관리자는 차단할 수 없습니다. 먼저 권한을 해제해 주세요.');
  const administrators=await db.query('SELECT 1 FROM gl_manage_admins WHERE room_id=$1 AND user_id=$2 LIMIT 1',[room,user]);
  if(administrators.rowCount)throw Error('봇 관리자는 차단할 수 없습니다. 먼저 관리자 권한을 해제해 주세요.');
  const name=clean(userName).slice(0,80),why=clean(reason).slice(0,200);
  await init(db);
  const q=await db.query(`INSERT INTO hz_command_blocks(room_id,user_id,user_name,actor_id,reason)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(room_id,user_id) DO UPDATE SET
    user_name=CASE WHEN EXCLUDED.user_name<>'' THEN EXCLUDED.user_name ELSE hz_command_blocks.user_name END,
    actor_id=EXCLUDED.actor_id,reason=EXCLUDED.reason,created_at=NOW()
    RETURNING user_id`,[room,user,name,clean(actorId).slice(0,80)||'system',why]);
  return q.rowCount>0;
 }
 await init(db);
 const q=await db.query('DELETE FROM hz_command_blocks WHERE room_id=$1 AND user_id=$2 RETURNING user_id',[room,user]);
 return q.rowCount>0;
}
function commandLike(text){
 const value=String(text??'').trim();
 return /^[!#]/.test(value)||value==='ㅊㅅ'||value==='삭제';
}
module.exports={init,blocked,list,set,identity,commandLike};
