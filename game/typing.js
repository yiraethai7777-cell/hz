'use strict';
const rounds=new Map();
const phrases=['오늘도 즐거운 하루 보내세요','정확하게 입력하는 것이 중요합니다','빠른 손가락이 승리를 만듭니다','새로운 기록을 향해 도전하세요','친구들과 함께하는 타자 대결 시간'];
async function handle(ctx,enabled){
 const id=String(ctx.roomId),text=String(ctx.text||'');
 if(text==='!타자게임'){
  if(!enabled)return true;
  if(rounds.has(id)){await ctx.send('이미 진행 중인 게임입니다.');return true;}
  const phrase=phrases[Math.floor(Math.random()*phrases.length)];
  const shown=Array.from(phrase).map((ch,i)=>ch!==' '&&i%3===1?ch+'\u200b':ch).join('');
  const round={phrase,start:0,timer:null};rounds.set(id,round);
  try{await ctx.send('[ 타자 게임 ]\n━━━━━━━━━━━━━━━━\n'+shown+'\n\n제한 시간: 30초\n보이는 문장을 직접 입력하세요.');}
  catch(e){rounds.delete(id);throw e;}
  round.start=process.hrtime.bigint();
  round.timer=setTimeout(()=>{if(rounds.get(id)!==round)return;rounds.delete(id);Promise.resolve(ctx.send('[ 타자 게임 종료 ]\n정답: '+phrase)).catch(console.error);},30000);
  round.timer.unref?.();return true;
 }
 const round=rounds.get(id);
 if(!round||!round.start||ctx.isBotAccount||text.normalize('NFC')!==round.phrase.normalize('NFC'))return false;
 const sec=Number(process.hrtime.bigint()-round.start)/1e9;
 if(sec>30)return false;
 rounds.delete(id);clearTimeout(round.timer);
 const chars=Array.from(round.phrase).length;
 await ctx.send('[ 타자 게임 결과 ]\n━━━━━━━━━━━━━━━━\n🏆 1등: '+String(ctx.userName||ctx.msg?.sender?.name||ctx.userId||'참가자')+'\n소요 시간: '+sec.toFixed(2)+'초\n분당 타수: '+Math.round(chars/sec*60)+'타\n정확도: 100%\n글자 수: '+chars+'자');
 return true;
}
module.exports={handle};
