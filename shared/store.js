'use strict';
const {getPool}=require('./db');
function id(v){const s=String(v??'');if(!/^\d{1,24}$/.test(s))throw Error('채팅방 또는 사용자 ID가 올바르지 않습니다.');return s;}
async function transaction(run){const db=await getPool().connect();try{await db.query('BEGIN');const result=await run(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
async function roomTransaction(roomId,run){return transaction(async db=>{const r=await db.query('SELECT data FROM hz_rooms WHERE room_id=$1 FOR UPDATE',[id(roomId)]);if(!r.rowCount)throw Error('등록되지 않은 채팅방입니다.');const d=r.rows[0].data||{};const result=await run(d,db);await db.query('UPDATE hz_rooms SET data=$2::jsonb,updated_at=NOW() WHERE room_id=$1',[String(roomId),JSON.stringify(d)]);return result;});}
async function audit(db,actor,action,room,target,detail){await db.query('INSERT INTO gl_audit(actor,action,room_id,target_id,detail) VALUES($1,$2,$3,$4,$5::jsonb)',[String(actor),action,room||null,target||null,JSON.stringify(detail||{})]);}
module.exports={id,transaction,roomTransaction,audit};
