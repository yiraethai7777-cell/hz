'use strict';
const {kstDate}=require('../attendance-image/data');
async function readRanking(db,{roomId,userId,userName,botId='',now=new Date()}){
 const room=String(roomId),user=String(userId);
 if(!/^\d+$/.test(room)||!/^\d+$/.test(user))throw Error('Invalid room/user ID');
 // Compute all ranks before selecting TOP 10 plus the requesting member.
 // One statement gives the graph and personal rank the same database snapshot.
 const ranked=await require('../chat-ranking-data').getRanking(db,room,botId);
 const rows=ranked.filter(r=>r.rank<=10||r.user_id===user).map(r=>({
  userId:r.user_id,name:r.user_name,count:r.count,rank:String(r.rank)
 }));
 const me=rows.find(r=>r.userId===user)||null;
 return {today:kstDate(now),name:userName||me?.name||user,top:rows.filter(r=>BigInt(r.rank)<=10n),me};
}
module.exports={readRanking};
