'use strict';
const {getPool}=require('./db');
// Room-specific hard power switch. Missing rows and legacy data default to ON.
async function enabled(roomId,db=getPool()){
 const room=String(roomId??'');
 if(!/^\d{1,30}$/.test(room))return false;
 const r=await db.query("SELECT data->>'botEnabled' AS enabled FROM hz_rooms WHERE room_id=$1",[room]);
 return r.rows[0]?.enabled!=='false';
}
module.exports={enabled};
