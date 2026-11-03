'use strict';
// Single ranking source used by both KakaoTalk and the customer portal.
// The database stores BIGINT counts; keep them as decimal strings to avoid
// precision loss in JavaScript.
async function getRanking(db,roomId,botId=''){
 const room=String(roomId),bot=String(botId??'');
 if(!/^[1-9]\d*$/.test(room))throw Error('Invalid chat room ID');
 const result=await db.query(`
 SELECT user_id,user_name,count::text AS count
 FROM gl_manage_chat_counts
 WHERE room_id=$1 AND ($2='' OR user_id<>$2)
 ORDER BY count DESC,user_id ASC`,[room,bot]);
 return result.rows.map((r,i)=>({
  user_id:String(r.user_id),
  user_name:String(r.user_name||r.user_id),
  count:String(r.count),
  rank:i+1
 }));
}
module.exports={getRanking};
