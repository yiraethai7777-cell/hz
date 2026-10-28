'use strict';
// Observed open chat rooms only; never claim a verified live membership roster.
const rooms=new Map();
function observe(msg){
 const room=msg?.room;
 if(room?.isOpenChat!==true||room.id==null)return;
 const name=String(room.name||room.title||'').trim();
 if(!name)return;
 rooms.set(String(room.id),{name,seen:Date.now()});
}
async function handle({client,chat,roomId}){
 const send=typeof chat?.sendText==='function'?chat.sendText.bind(chat):client.sendText.bind(client);
 const rows=[...rooms].sort((a,b)=>a[1].name.localeCompare(b[1].name,'ko'));
 const body=rows.length?
  '📋 봇이 메시지를 확인한 오픈채팅방\n━━━━━━━━━━━━━━━━\n'+
  rows.map(([id,r],i)=>(i+1)+'. '+r.name+'\n🆔 방 ID: '+id).join('\n\n')+
  '\n━━━━━━━━━━━━━━━━\n총 '+rows.length+'개 방\n※ 현재 참여 여부는 별도 확인이 필요합니다.':
  '📋 아직 확인된 오픈채팅방이 없습니다.\n봇이 해당 방에서 메시지를 수신한 뒤 다시 시도해 주세요.';
 await send(roomId,body);
}
async function search({client,chat,roomId,query}){
 const send=typeof chat?.sendText==='function'?chat.sendText.bind(chat):client.sendText.bind(client);
 const needle=String(query||'').normalize('NFKC').trim().toLocaleLowerCase('ko');
 if(!needle){await send(roomId,'사용법: !방아이디검색 (방이름)');return;}
 const rows=[...rooms].filter(([,r])=>r.name.normalize('NFKC').toLocaleLowerCase('ko').includes(needle))
   .sort((a,b)=>a[1].name.localeCompare(b[1].name,'ko')).slice(0,20);
 if(!rows.length){await send(roomId,'🔎 검색 결과가 없습니다.\\n봇이 해당 오픈채팅방에서 메시지를 수신해야 검색됩니다.');return;}
 await send(roomId,'🔎 방 아이디 검색 결과\\n━━━━━━━━━━━━━━━━\\n'+
  rows.map(([id,r],i)=>(i+1)+'. '+r.name+'\\n🆔 '+id).join('\\n\\n')+
  '\\n━━━━━━━━━━━━━━━━\\n※ 최근 메시지로 확인한 방이며 현재 참여 여부는 보장되지 않습니다.');
}
module.exports={observe,handle,search};
