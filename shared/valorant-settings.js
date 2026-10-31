'use strict';

// Per-room VALORANT switch. All rooms start OFF until the Kakao bot account
// explicitly enables the feature in that room; settings survive restarts.
const {getPool}=require('./db');
const COMMANDS=new Set(['!발로on','!발로off']);
const FLAG='valorant';

async function isEnabled(roomId,db=getPool()){
 const room=String(roomId??'');
 if(!room)return false;
 const result=await db.query(
  "SELECT COALESCE((SELECT (data->>'valorant')::boolean FROM hz_rooms WHERE room_id=$1),FALSE) AS enabled",
  [room]
 );
 return result.rows[0]?.enabled===true;
}

async function handle({text,roomId,isBotAccount,send,db}){
 if(!COMMANDS.has(text))return false;
 // Only the actual connected Kakao bot account may modify the room setting.
 // Silently consume unauthorized attempts; do not change state or reply.
 if(!isBotAccount)return true;
 const enabled=text==='!발로on';
 const pool=db||getPool();
 await pool.query(
  "INSERT INTO hz_rooms(room_id,data) VALUES($1,jsonb_build_object('valorant',$2::boolean)) "+
  "ON CONFLICT(room_id) DO UPDATE SET "+
  "data=jsonb_set(COALESCE(hz_rooms.data,'{}'::jsonb),'{valorant}',to_jsonb($2::boolean),true),updated_at=NOW()",
  [String(roomId),enabled]
 );
 await send(enabled
  ?'✅ 이 방의 발로란트 기능이 켜졌습니다.\n!발로전적, !스킨 등의 명령어를 사용할 수 있습니다.'
  :'⏹️ 이 방의 발로란트 기능이 꺼졌습니다.\n전적 조회와 스킨 검색 명령어가 작동하지 않습니다.');
 return true;
}

module.exports={COMMANDS,FLAG,isEnabled,handle};
