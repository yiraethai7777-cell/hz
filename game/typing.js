'use strict';
const rounds=new Map();
const phrases=["오늘도 즐거운 하루 보내세요","정확하게 입력하는 것이 중요합니다","빠른 손가락이 승리를 만듭니다","새로운 기록을 향해 도전하세요","친구들과 함께하는 타자 대결 시간","햇살이 따뜻하게 창문을 비춥니다","작은 습관이 큰 변화를 만듭니다","오늘의 노력은 내일의 실력이 됩니다","천천히 해도 끝까지 도전하세요","맑은 하늘 아래 산책을 즐겨요","친구와 함께 웃으면 더 즐겁습니다","새로운 하루가 우리를 기다립니다","꾸준한 연습이 좋은 결과를 만듭니다","즐거운 마음으로 하루를 시작해요","빠르게보다 정확하게 입력하세요","반짝이는 별들이 밤하늘을 채웁니다","시원한 바람이 나뭇잎을 흔듭니다","맛있는 간식을 먹으며 쉬어 가요","어려운 문제도 차근차근 풀어 봐요","작은 목표부터 하나씩 이루어 봅시다","멋진 기록을 세울 준비가 되었나요","포기하지 않는 마음이 중요합니다","웃는 얼굴에는 좋은 일이 찾아옵니다","책 한 권으로 새로운 세상을 만나요","오늘도 최선을 다해 달려 봅시다","서로 응원하며 즐겁게 경쟁해요","기분 좋은 음악이 방 안에 울립니다","집중력을 발휘해 정답을 입력하세요","눈 깜짝할 사이에 시간이 지나갑니다","고요한 새벽에 새로운 생각이 떠올라요","푸른 바다를 보며 여름을 떠올립니다","노력한 만큼 실력도 조금씩 자랍니다","실수해도 다시 도전하면 괜찮아요","재미있는 이야기를 친구에게 들려줘요","따뜻한 차 한 잔으로 여유를 즐겨요","높은 산 정상에서 풍경을 바라봅니다","기다리던 주말이 드디어 찾아왔습니다","새로운 취미를 배우는 것은 즐겁습니다","우리 모두 함께 멋진 추억을 만들어요","정확한 한 글자가 승부를 결정합니다","눈을 크게 뜨고 문장을 확인하세요","손가락을 움직이며 속도를 높여 봐요","마지막 순간까지 집중력을 유지하세요","오늘의 승자는 과연 누가 될까요","친절한 한마디가 큰 힘이 됩니다","좋은 생각은 좋은 행동으로 이어집니다","시간을 소중하게 사용하는 습관을 길러요","작은 성공을 모아 큰 꿈을 이뤄 봐요","상쾌한 아침 공기가 기분을 깨웁니다","끝까지 집중하면 좋은 결과가 있습니다"];
async function handle(ctx,enabled){
 const id=String(ctx.roomId),text=String(ctx.text||'');
 if(text==='!타자게임'){
  if(!enabled)return true;
  if(rounds.has(id)){await ctx.send('이미 진행 중인 게임입니다.');return true;}
  const phrase=phrases[Math.floor(Math.random()*phrases.length)];
  // Replace ordinary spaces with non-breaking spaces in the displayed challenge.
  // Exact pasted text retains different code points from a manually typed answer.
  const shown=phrase.replace(/ /g,String.fromCharCode(0x00a0));
  const round={phrase,start:0,timer:null};rounds.set(id,round);
  try{await ctx.send('[ 타자 게임 ]\n━━━━━━━━━━━━━━━━\n'+shown+'\n\n제한 시간: 30초');}
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
