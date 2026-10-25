'use strict';
const {getPool}=require('../shared/db');
// Authority is scoped to one open-chat room and one Kakao account.
// Never rewrite isBotAccount, which identifies the actual logged-in bot.
async function isRoomAdmin(roomId,userId,msg,client){
 if(msg?.room?.isOpenChat!==true)return false;
 const room=String(roomId??''),user=String(userId??'');
 if(!/^\d+$/.test(room)||!/^\d+$/.test(user))return false;
 if(String(client?.userId)===user)return true;
 if([1,4].includes(Number(msg?.sender?.type)))return true;
 const r=await getPool().query(
  'SELECT 1 FROM gl_manage_admins WHERE room_id=$1 AND user_id=$2 LIMIT 1',[room,user]);
 return (r.rowCount??r.rows?.length??0)>0;
}
module.exports={isRoomAdmin};
