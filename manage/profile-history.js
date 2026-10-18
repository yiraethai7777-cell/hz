'use strict';
function valid(link){
 if(typeof link!=='string')return false;
 try{const u=new URL(link);return u.protocol==='https:'&&u.hostname==='open.kakao.com'&&/^\/o\/[A-Za-z0-9_-]+\/?$/.test(u.pathname);}catch{return false;}
}
async function message(db,roomId,target){
 const result=await db.query(`SELECT link,MIN(seen_at) AS first_seen FROM (
  SELECT old_open_profile_link AS link,created_at AS seen_at FROM hz_profiles WHERE room_id=$1 AND user_id=$2
  UNION ALL SELECT new_open_profile_link,created_at FROM hz_profiles WHERE room_id=$1 AND user_id=$2
  UNION ALL SELECT old_profile_url,created_at FROM hz_profiles WHERE room_id=$1 AND user_id=$2
  UNION ALL SELECT new_profile_url,created_at FROM hz_profiles WHERE room_id=$1 AND user_id=$2
  UNION ALL SELECT open_profile_link,last_seen FROM hz_members WHERE room_id=$1 AND user_id=$2
  UNION ALL SELECT observed_open_profile_link,last_seen FROM hz_members WHERE room_id=$1 AND user_id=$2
 ) history WHERE link IS NOT NULL AND link<>'' GROUP BY link ORDER BY MIN(seen_at),link`,[String(roomId),String(target.id)]);
 const links=[...new Set(result.rows.map(v=>v.link).filter(valid))];
 return `👤 ${target.name||target.id}님의 오픈프로필 기록\n${'\u200b'.repeat(1200)}\n봇이 기록한 옾링: ${links.length}개\n${links.length?links.map((link,i)=>`${i+1}. ${link}`).join('\n'):'기록된 오픈프로필 링크가 없습니다.'}\n\n※ 봇이 기록하기 전의 링크는 확인할 수 없습니다.`;
}
module.exports={message};
