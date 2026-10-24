'use strict';
// Read-only snapshots shared by the live attendance command and preview renderer.
function kstDate(now=new Date()){
 const date=new Date(now);if(!Number.isFinite(date.getTime()))throw Error('Invalid date');
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const part=type=>parts.find(p=>p.type===type).value;return `${part('year')}-${part('month')}-${part('day')}`;
}
function validDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Invalid date');
 const date=new Date(value+'T00:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value||Number(value.slice(0,4))<1)throw Error('Invalid date');
 return value;
}
function calendar({year,month,dates=[],today=kstDate()}){
 if(!Number.isInteger(year)||year<1||year>9999)throw Error('Invalid year');
 if(!Number.isInteger(month)||month<1||month>12)throw Error('Invalid month');
 validDate(today);const attended=new Set(dates.map(validDate)),prefix=String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0');
 const start=new Date(prefix+'-01T00:00:00Z').getUTCDay();
 const end=new Date(0);end.setUTCFullYear(year,month,0);const count=end.getUTCDate();
 const cells=Array.from({length:42},(_,index)=>{
  const day=index-start+1;if(day<1||day>count)return null;
  const date=prefix+'-'+String(day).padStart(2,'0'),weekday=index%7,checked=attended.has(date);
  return {day,date,row:Math.floor(index/7),column:weekday,weekday,attended:checked,isToday:date===today,highlightToday:date===today&&checked,weekend:weekday===0?'sunday':weekday===6?'saturday':null};
 });return {year,month,weekdays:['일','월','화','수','목','금','토'],cells};
}
function escapeXml(value){return String(value).toWellFormed().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function previousDay(value){const d=new Date(value+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);}
async function readSnapshot(pool,{roomId,userId,now=new Date(),attendanceDate}){
 const room=String(roomId),user=String(userId);if(!/^\d+$/.test(room)||!/^\d+$/.test(user))throw Error('Invalid room/user ID');
 const today=kstDate(now),year=Number(today.slice(0,4)),month=Number(today.slice(5,7)),requested=validDate(attendanceDate??today);
 if(requested>today)throw Error('Future attendance date');
 const db=await pool.connect();
 try{
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const result=await db.query('SELECT user_name,attend_date::text AS day,attended_at::text AS attended_at FROM hz_new_attendance WHERE room_id=$1 AND user_id=$2 ORDER BY attend_date DESC',[room,user]);
  const rows=result.rows,record=rows.find(r=>r.day===requested),dates=rows.map(r=>validDate(r.day));
  let reward=null;
  if(record){
   // Both records use PostgreSQL NOW() in the same transaction. Keep timestamp microseconds as text.
   const rewards=await db.query("SELECT amount::text AS amount FROM hz_coin_logs WHERE room_id=$1 AND user_id=$2 AND type='ATTENDANCE' AND created_at=$3::timestamptz",[room,user,record.attended_at]);
   // Missing or ambiguous audit records must not be replaced by an estimated reward.
   if(rewards.rows.length===1&&/^\d+$/.test(rewards.rows[0].amount))reward=rewards.rows[0].amount;
  }
  // Rank all members before filtering this user; ordering matches !출석순위.
  const ranked=await db.query(`SELECT day,position FROM (
    SELECT user_id,attend_date::text AS day,
      ROW_NUMBER() OVER(PARTITION BY attend_date ORDER BY attended_at,user_id)::int AS position
    FROM hz_new_attendance WHERE room_id=$1
      AND attend_date >= $3::date AND attend_date < ($3::date + INTERVAL '1 month')
  ) ranked WHERE user_id=$2`,[room,user,today.slice(0,7)+'-01']);
  const ranks=Object.fromEntries(ranked.rows.map(r=>[r.day,Number(r.position)]));
  const days=new Set(dates);let expected=requested,streak=0;while(days.has(expected)){streak++;expected=previousDay(expected);}
  const snapshot={roomId:room,userId:user,name:record?.user_name??rows[0]?.user_name??'',today,attendanceDate:record?requested:null,attendedAt:record?.attended_at??null,total:rows.length,streak,reward,dates,ranks,calendar:calendar({year,month,dates,today})};
  await db.query('COMMIT');return snapshot;
 }catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}
}
module.exports={kstDate,calendar,escapeXml,readSnapshot};
