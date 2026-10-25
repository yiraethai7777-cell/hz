'use strict';
// Room-scoped bot-admin grant; never confers the Kakao bot's identity.
async function isRoomBotAdmin(roomId,userId,db) {
 const room=String(roomId??''),user=String(userId??'');
 if(!/^[1-9]\d*$/.test(room)||!/^[1-9]\d*$/.test(user))return false;
 const pool=db||require('./db').getPool();
 const result=await pool.query('SELECT 1 FROM gl_manage_admins WHERE room_id=$1 AND user_id=$2 LIMIT 1',[room,user]);
 return (result.rowCount??result.rows?.length??0)>0;
}
module.exports={isRoomBotAdmin};
