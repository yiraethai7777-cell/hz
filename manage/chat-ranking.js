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

const FOLD='\u200b'.repeat(1200);
function cleanName(value){
 const raw=String(value??'이름 없음').replace(/[\u0000-\u001f\u007f-\u009f\u200b\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim();
 const chars=Array.from(raw||'이름 없음');
 return chars.length>26?chars.slice(0,25).join('')+'…':chars.join('');
}
// Builds the same TOP 10 snapshot as the image, formatted for KakaoTalk's
// long-message fold. A bar length of 16 means 100% of the leading count.
function formatTopBars(snapshot){
 const rows=Array.isArray(snapshot?.top)?snapshot.top.slice(0,10):[];
 const title='💬 우리 방 채팅 순위 TOP 10';
 if(!rows.length)return title+FOLD+'\n━━━━━━━━━━━━━━━━━━\n아직 채팅 기록이 없습니다.\n━━━━━━━━━━━━━━━━━━';
 const counts=rows.map(row=>{
  const value=String(row.count??'0');
  if(!/^\d+$/.test(value))throw Error('채팅 횟수를 확인할 수 없습니다.');
  return BigInt(value);
 });
 const maximum=counts.reduce((max,n)=>n>max?n:max,0n);
 const width=16n;
 const lines=rows.map((row,i)=>{
  const count=counts[i];
  const len=maximum===0n?0:count===0n?0:Math.max(1,Number((count*width+maximum/2n)/maximum));
  const bar='█'.repeat(len)+'░'.repeat(Number(width)-len);
  const rank=/^\d+$/.test(String(row.rank??''))?String(row.rank):String(i+1);
  return rank+'. '+cleanName(row.name??row.user_name)+' · '+count.toLocaleString('ko-KR')+'회\n┃ '+bar;
 });
 return title+FOLD+'\n━━━━━━━━━━━━━━━━━━\n'+lines.join('\n\n')+'\n━━━━━━━━━━━━━━━━━━';
}

module.exports={format,messages,formatTopBars};
