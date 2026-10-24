'use strict';
const {readRanking}=require('./data');
const {renderRanking}=require('./render');
const {sendPng}=require('../attendance-image/send');
const {messages}=require('../chat-ranking');
const running=new Set();
async function sendRankingImage(db,ctx){
 const key=String(ctx.roomId)+':'+String(ctx.userId);
 if(running.has(key)){await ctx.send('⏳ 채팅 순위 이미지를 전송하고 있습니다. 잠시 후 다시 요청해 주세요.');return false;}
 running.add(key);
 try{
  const snapshot=await readRanking(db,ctx);
  const buffer=await renderRanking(snapshot);
  await sendPng(ctx.client,ctx.roomId,buffer,{
   caption:'💬 우리 방 채팅 순위 TOP 10 · '+snapshot.today,
   width:1200,height:1370,filename:'chat-ranking.png'
  });
  return true;
 }catch(error){
  console.error('[CHAT RANKING IMAGE]',error);
  await ctx.send('⚠️ 채팅 순위 이미지를 전송하지 못해 글로 안내드립니다.');
  for(const part of await messages(db,String(ctx.roomId),false))await ctx.send(part);
  return false;
 }finally{running.delete(key);}
}
module.exports={sendRankingImage};
