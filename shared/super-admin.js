'use strict';
const {getPool}=require('./db');
const SCHEMA="CREATE TABLE IF NOT EXISTS hz_super_admins ("+
 "room_id TEXT NOT NULL,user_id TEXT NOT NULL,granted_by TEXT NOT NULL,"+
 "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,user_id))";
let schemaReady;
function valid(value){const s=String(value??'');return /^[1-9]\d{3,23}$/.test(s)?s:'';}
async function init(db,shared=true){
 if(!shared){await db.query(SCHEMA);return;}
 if(!schemaReady) schemaReady=db.query(SCHEMA).catch(error=>{schemaReady=null;throw error;});
 await schemaReady;
}
async function isSuperAdmin(roomId,userId,db){
 const room=valid(roomId),user=valid(userId);
 if(!room||!user)return false;
 const pool=db||getPool();
 await init(pool,!db);
 const r=await pool.query('SELECT 1 FROM hz_super_admins WHERE room_id=$1 AND user_id=$2',[room,user]);
 return (r.rowCount??r.rows?.length??0)>0;
}
async function list(roomId,db){
 const room=valid(roomId);if(!room)throw Error('채팅방 ID가 올바르지 않습니다.');
 const pool=db||getPool();await init(pool,!db);
 const r=await pool.query('SELECT user_id,granted_by,created_at FROM hz_super_admins WHERE room_id=$1 ORDER BY created_at,user_id',[room]);
 return r.rows;
}
async function update(roomId,userId,actor,action,db){
 const room=valid(roomId),user=valid(userId),by=String(actor??'').trim();
 if(!room||!user||!by||!['add','remove'].includes(action))throw Error('최고관리자 설정을 확인해 주세요.');
 const pool=db||getPool();await init(pool,!db);
 if(action==='add'){
  const r=await pool.query('INSERT INTO hz_super_admins(room_id,user_id,granted_by) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[room,user,by]);
  return r.rowCount>0;
 }
 const r=await pool.query('DELETE FROM hz_super_admins WHERE room_id=$1 AND user_id=$2',[room,user]);
 return r.rowCount>0;
}
module.exports={init,isSuperAdmin,list,update,valid};
