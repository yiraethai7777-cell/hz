'use strict';
const {readRanking}=require('./data');
const {renderRanking}=require('./render');
const {sendPng}=require('../attendance-image/send');
const {formatTopBars}=require('../chat-ranking');
const running=new Set();
async function sendRankingImage(db,ctx){
 const key=String(ctx.roomId)+':'+String(ctx.userId);
 if(running.has(key)){
  await ctx.send('⏳ 채팅 순위 이미지를 전송하고 있습니다. 잠시 후 다시 요청해 주세요.');
  return false;
 }
 running.add(key);
 try{
  // Take one DB snapshot so photo and the following text have identical ranks.
  let snapshot;
  try{
   snapshot=await readRanking(db,ctx);
  }catch(error){
   console.error('[CHAT RANKING DATA]',error);
   await ctx.send('❌ 채팅 순위 기록을 불러오지 못했습니다. Railway 로그를 확인해 주세요.');
   return false;
  }
  let imageSent=false;
  try{
   const buffer=await renderRanking(snapshot);
   await sendPng(ctx.client,ctx.roomId,buffer,{
    caption:'💬 우리 방 채팅 순위 TOP 10 · '+snapshot.today,
    width:1200,height:1370,filename:'chat-ranking.png'
   });
   imageSent=true;
  }catch(error){
   console.error('[CHAT RANKING IMAGE]',error);
   // Image failure must not prevent the text ranking from being delivered.
   try{await ctx.send('⚠️ 채팅 순위 이미지를 전송하지 못해 글로 안내드립니다.');}
   catch(sendError){console.error('[CHAT RANKING IMAGE NOTICE]',sendError);}
  }
  try{
   await ctx.send(formatTopBars(snapshot));
  }catch(error){
   console.error('[CHAT RANKING TEXT]',error);
   return false;
  }
  return imageSent;
 }finally{running.delete(key);}
}
module.exports={sendRankingImage};
