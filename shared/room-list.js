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
module.exports={observe,handle};
