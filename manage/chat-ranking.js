'use strict';
function format(rows,all=false){
 const chunks=[];let page=[];let size=0;
 const lines=rows.length?rows.map((v,i)=>`${i+1}. ${v.user_name??v.name}: ${v.count??v.chat_count}회`):['아직 채팅 기록이 없습니다.'];
 for(const line of lines){if(size+line.length>2500&&page.length){chunks.push(page.join('\n'));page=[];size=0;}page.push(line);size+=line.length+1;}
 if(page.length)chunks.push(page.join('\n'));
 return chunks.map((body,i)=>`💬 ${all?'전체 채팅 순위 ('+rows.length+'명)':'채팅 순위 TOP 10'}${chunks.length>1?' · '+(i+1)+'/'+chunks.length:''}\n${'\u200b'.repeat(1200)}\n${body}`);
}
async function messages(db,room,all=false){
 const r=await db.query('SELECT user_name,count FROM gl_manage_chat_counts WHERE room_id=$1 ORDER BY count DESC,user_id ASC'+(all?'':' LIMIT 10'),[room]);
 return format(r.rows,all);
}
module.exports={format,messages};
