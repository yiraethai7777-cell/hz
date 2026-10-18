'use strict';
const LIMIT=5,COUNT=10,FOLD='\u200b'.repeat(1200);
function catchNet(ctx,p,msg){
 const day=ctx.dayK();
 if(p.netDay!==day){p.netDay=day;p.netUses=0;p.netMessageIds=[];}
 const key=msg.id??msg.message?.id??msg.logId;
 const ids=Array.isArray(p.netMessageIds)?p.netMessageIds:[];
 if(key!=null&&ids.includes(String(key)))return '이미 처리된 어망 요청입니다.';
 const used=Math.max(0,Math.floor(Number(p.netUses)||0));
 if(used>=LIMIT)return '🕸️ 오늘 어망 5회를 모두 사용했습니다.\n한국시간 자정에 다시 사용할 수 있습니다.';
 const beforeFish=p.lastFish,fish=[];
 // The daily net quota is separate from the normal fishing cooldown.
 for(let i=0;i<COUNT;i++)fish.push(ctx.awardFish(p,Date.now()));
 p.lastFish=beforeFish;p.netUses=used+1;
 if(key!=null)p.netMessageIds=[...ids,String(key)].slice(-LIMIT);
 const coins=fish.reduce((n,x)=>n+x.value,0),xp=fish.reduce((n,x)=>n+x.xp,0);
 const mention=`\u0002${p.id}\u0003${String(p.name).replace(/[\u0000-\u001f]/g,'')}\u0004`;
 return `🕸️ ${mention}님의 어망 결과\n오늘 ${p.netUses}/${LIMIT}회 사용\n${FOLD}\n`+
  fish.map((x,i)=>`${i+1}. ${x.f.name} [${x.f.tier}] · ${x.size}cm`).join('\n')+
  `\n\n🐟 획득 · ${COUNT}마리\n💰 코인 보상 · +${ctx.n(coins)}코인\n⭐ 경험치 · +${ctx.n(xp)} XP\n`+
  `⭐ 현재 레벨 · Lv.${p.level}\n🎒 보유 물고기 · ${p.inventory.length}마리\n🕛 사용 횟수는 한국시간 자정에 초기화됩니다.`;
}
module.exports={catchNet,LIMIT,COUNT};
