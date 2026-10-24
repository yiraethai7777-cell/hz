'use strict';
const {profileNotice}=require('./leave-reply');
async function setEnabled(db,roomId,on){
 await db.query(`INSERT INTO hz_rooms(room_id,data)
 VALUES($1,jsonb_build_object('profileAlerts',$2::boolean))
 ON CONFLICT(room_id) DO UPDATE SET
 data=jsonb_set(hz_rooms.data,'{profileAlerts}',to_jsonb($2::boolean),true),updated_at=NOW()`,[String(roomId),on]);
}
async function sendNotice(ctx,chat,roomId,change){
 // Check again immediately before sending, including a watcher already in flight.
 // Missing settings retain the existing default: alerts enabled.
 const setting=await ctx.pool.query("SELECT data->'profileAlerts' AS profile_alerts FROM hz_rooms WHERE room_id=$1",[String(roomId)]);
 if(setting.rows[0]?.profile_alerts===false)return false;
 await ctx.send(chat,roomId,profileNotice(change,ctx.nowK()));
 return true;
}
module.exports={setEnabled,sendNotice};
