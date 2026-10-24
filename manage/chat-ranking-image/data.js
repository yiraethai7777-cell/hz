'use strict';
const {kstDate}=require('../attendance-image/data');
async function readRanking(db,{roomId,userId,userName,now=new Date()}){
 const room=String(roomId),user=String(userId);
 if(!/^\d+$/.test(room)||!/^\d+$/.test(user))throw Error('Invalid room/user ID');
 // Compute all ranks before selecting TOP 10 plus the requesting member.
 // One statement gives the graph and personal rank the same database snapshot.
 const result=await db.query(`WITH ranked AS (
  SELECT user_id,user_name,count::text AS count,
    ROW_NUMBER() OVER(ORDER BY count DESC,user_id ASC) AS position
  FROM gl_manage_chat_counts WHERE room_id=$1
 ) SELECT user_id,user_name,count,position::text AS rank FROM ranked
 WHERE position<=10 OR user_id=$2 ORDER BY position`,[room,user]);
 const rows=result.rows.map(row=>{
  if(!/^\d+$/.test(row.count)||!/^\d+$/.test(row.rank)||BigInt(row.rank)<1n)throw Error('Invalid chat count/rank');
  return {userId:String(row.user_id),name:row.user_name||String(row.user_id),count:row.count,rank:row.rank};
 });
 const me=rows.find(r=>r.userId===user)||null;
 return {today:kstDate(now),name:userName||me?.name||user,top:rows.filter(r=>BigInt(r.rank)<=10n),me};
}
module.exports={readRanking};
