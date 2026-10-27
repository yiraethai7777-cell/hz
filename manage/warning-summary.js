'use strict';
// Count and reasons share one snapshot and the same active, room-scoped records.
async function read(db,roomId,userId,{includeReasons=false}={}){
 const fields=includeReasons
  ? "COUNT(*)::integer AS n, COALESCE(array_agg(reason ORDER BY id DESC), ARRAY[]::text[]) AS reasons"
  : "COUNT(*)::integer AS n";
 const result=await db.query(
  'SELECT '+fields+' FROM gl_manage_warnings WHERE room_id=$1 AND user_id=$2 AND NOT removed',
  [String(roomId),String(userId)]);
 const row=result.rows[0]||{};
 return {warnings:Number(row.n)||0,warningReasons:Array.isArray(row.reasons)?row.reasons:[]};
}
module.exports={read};
