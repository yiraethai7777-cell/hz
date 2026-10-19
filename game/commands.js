'use strict';
const {handleCoinCommand}=require('./coin');
const {joinGame}=require('./members');
async function message({text,msg,chat,isBotAccount=false}) {
 const roomId=msg.room?.id;
 if(roomId==null)return;
 if(text==='!게임가입') {
  if(msg.sender?.id==null){await chat.sendText(roomId,'사용자 ID를 확인할 수 없습니다.');return;}
  await chat.sendText(roomId,await joinGame(roomId,msg.sender.id,msg.sender.name||'알 수 없음'));return;
 }
 if(await handleCoinCommand({text,msg,roomId,chat,isBotAccount}))return;
 if(text==='!핑')await chat.sendText(roomId,'🏓 NEXUS · 퐁!');
}
module.exports={message};
