'use strict';
const {getPool}=require('./db');
// Existing rooms without a subscription retain their previous botEnabled state.
// Once a plan exists, its expiration is a hard gate even for the bot account.
async function enabled(roomId,db=getPool()){
 const room=String(roomId??'');
 if(!/^\d{1,30}$/.test(room))return false;
 await require('./room-subscriptions').init(db);
 const r=await db.query(
  "SELECT (SELECT data->>'botEnabled' FROM hz_rooms WHERE room_id=$1) AS enabled,"+
  " (SELECT status='active' AND expires_at>NOW() FROM gl_room_subscriptions WHERE room_id=$1) AS subscribed",
  [room]);
 const row=r.rows[0]||{};
 return row.enabled!=='false'&&row.subscribed!==false;
}
module.exports={enabled};
