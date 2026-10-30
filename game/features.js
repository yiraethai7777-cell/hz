"use strict";
// Persistent state is supplied explicitly; this module registers no client listener.
module.exports = function createFeatures(ctx) {
function levelNeed(l){return l>=ctx.MAX_LEVEL?0:100+(l-1)*25}

function addXp(p,x){if(p.level>=ctx.MAX_LEVEL)return 0;p.xp+=x;let up=0;while(p.level<ctx.MAX_LEVEL&&p.xp>=ctx.levelNeed(p.level)){p.xp-=ctx.levelNeed(p.level);p.level++;up++}if(p.level>=ctx.MAX_LEVEL)p.xp=0;return up}

function player(d,uid,name){
  let p=d.players[uid];
  if(!p)p=d.players[uid]={id:uid,name,points:0,level:1,xp:0,wins:0,lastFish:0,inventory:[],rods:["나무"],rod:"나무"};
  p.name=name||p.name;
  p.inventory=Array.isArray(p.inventory)?p.inventory:[];
  // v15 이전 획득 물고기는 낚시 시 코인을 이미 지급했으므로 중복 지급하지 않음.
  for(const fish of p.inventory){if(fish&&fish.salePending===undefined)fish.salePending=false;}
  p.rods=Array.isArray(p.rods)?p.rods:["나무"];
  p.pets=p.pets&&typeof p.pets==="object"&&!Array.isArray(p.pets)?p.pets:{};
  p.equippedPet=p.equippedPet||"";p.rodLevels=p.rodLevels||{};p.autoUntil=Number(p.autoUntil)||0;p.luckUntil=Number(p.luckUntil)||0;
  p.protection=Math.max(0,Number(p.protection)||0);p.protectionDay=p.protectionDay||"";p.protectionBought=Math.max(0,Number(p.protectionBought)||0);p.autoDay=p.autoDay||"";p.autoBought=Math.max(0,Number(p.autoBought)||0);p.rodRestore=p.rodRestore||null;
  return p
}

function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}

function nextQuiz(d){
 if(d.quizBankVersion!=='difficulty-mix-v1'){
  d.quizQueues={};d.quizDifficultyQueue=[];d.quizBankVersion='difficulty-mix-v1';
 }
 return require('./quiz-difficulty').next(d,ctx.QUIZZES,ctx.shuffle);
}

function fishPick(luck){
  const tiers=["일반","희귀","영웅","전설","신화"];
  const base=[6000,2800,1000,180,20];
  const high=[4800,3700,1250,220,30];
  const factor=Math.min(1,Math.max(0,Math.log(Math.max(1,luck))/Math.log(30)));
  const weights=base.map((w,i)=>w+(high[i]-w)*factor);
  let roll=Math.random()*weights.reduce((a,b)=>a+b,0);
  let tier=tiers[tiers.length-1];
  for(let i=0;i<tiers.length;i++){roll-=weights[i];if(roll<0){tier=tiers[i];break}}
  const fishes=ctx.FISH_TABLE.filter(f=>f.tier===tier);
  let fishRoll=Math.random()*fishes.reduce((sum,f)=>sum+f.weight,0);
  for(const f of fishes){fishRoll-=f.weight;if(fishRoll<0)return f}
  return fishes[fishes.length-1];
}

function fishValue(f,size,luck){return Math.min(1000000,Math.max(1,Math.round(f.base*(.65+.7*(size-f.min)/Math.max(1,f.max-f.min))*Math.min(1.5,Math.sqrt(luck)))))}

function gameHelp(){return require('../shared/help').formatCommandHelp({game:true,manage:false},'게임');}

function petBonus(p){const pet=ctx.PETS.find(x=>x.name===p.equippedPet&&p.pets[x.name]!==undefined);if(!pet)return {luck:0,xp:0,points:0};const level=Number(p.pets[pet.name])||0;return {luck:pet.luck+level*2,xp:pet.xp+level*2,points:pet.points+level*2}}

function rodLuck(p){const r=ctx.RODS.find(x=>x.name===p.rod)||ctx.RODS[0],b=ctx.petBonus(p);return r.luck*(1+(Number(p.rodLevels[p.rod])||0)*.03)*(1+b.luck/100)*(Date.now()<p.luckUntil?1.5:1)}

function awardFish(p,now){const b=ctx.petBonus(p),luck=ctx.rodLuck(p),f=ctx.fishPick(luck),size=Math.round((f.min+Math.random()*(f.max-f.min))*10)/10,value=Math.round(ctx.fishValue(f,size,luck)*(1+b.points/100)),xp=Math.round(ctx.FISHING_XP*(1+b.xp/100));p.inventory.push({name:f.name,tier:f.tier,size,value,at:now,salePending:true});p.points+=value;const up=ctx.addXp(p,xp);p.lastFish=now;return {f,size,value,xp,up}}

function drawPet(){const total=ctx.PETS.reduce((v,p)=>v+p.weight,0);let v=Math.random()*total;for(const pet of ctx.PETS){v-=pet.weight;if(v<0)return pet}return ctx.PETS[ctx.PETS.length-1]}

function enhancementCost(level,base){return Math.round(base*Math.pow(1.28,level))}

function enhancementNeed(level){return Math.min(200,1+Math.floor(level/3))}

async function autoFishTick(){
 if(!ctx.globalChat)return;
 const rows=await ctx.pool.query("SELECT room_id,data FROM hz_rooms WHERE (data->>'game')='true' AND (data->>'fishEnabled') IS DISTINCT FROM 'false'");
 const now=Date.now(),cooldown=ctx.FISHING_COOLDOWN_SECONDS*1000;
 for(const row of rows.rows){
  const rid=row.room_id;
  // Do not lock/rewrite every game room on each 10-second tick.
  // Most rooms have no active auto-fishers or none due to fish yet.
  const due=Object.values(row.data?.players||{}).some(p=>
   Number(p?.autoUntil)>now&&now-(Number(p?.lastFish)||0)>=cooldown);
  if(!due)continue;
  try{
   const results=await ctx.withRoom(rid,row.data?.name||'',async(d,c)=>{
    if(!d.game||!d.fishEnabled)return [];
    const out=[],time=Date.now();
    for(const p of Object.values(d.players)){
     if(!p.autoUntil||p.autoUntil<=time)continue;
     if(time-(Number(p.lastFish)||0)<cooldown)continue;
     const award=()=>ctx.awardFish(p,time);
     const r=ctx.economyEnabled
      ?await require('./economy').withPlayer({db:c,room:rid,user:p.id,p,botId:ctx.globalBotId,msg:{text:'자동낚시'},run:award})
      :award();
     if(!r)continue;
     out.push(`🎣 자동낚시 @${String(p.name||p.id).replace(/^@/, '')}${ctx.MORE}\n━━━━━━━━━━━━━━━━━━\n🐟 획득 물고기: ${r.f.name} (${r.size}cm)\n💰 획득 코인: +${ctx.n(r.value)}\n⭐ 획득 경험치: +${r.xp} XP\n⏱️ 남은 시간: ${Math.max(0,Math.ceil((p.autoUntil-time)/60000))}분\n🍀 행운포션: ${p.luckUntil>time?'사용 중':'미사용'}\n━━━━━━━━━━━━━━━━━━`);
    }
    return out;
   });
   for(const line of results)await ctx.send(ctx.globalChat,rid,line);
  }catch(e){console.error('[AUTO FISH]',rid,e)}
 }
}


let quizExpiryBusy=false;
async function quizExpiryTick(){
 if(quizExpiryBusy||!ctx.globalChat)return;
 quizExpiryBusy=true;
 try{
  const result=await ctx.pool.query("SELECT room_id,data->'quiz' AS quiz FROM hz_rooms WHERE (data->>'game')='true' AND (data->>'quizEnabled') IS DISTINCT FROM 'false' AND data->'quiz' IS NOT NULL");
  for(const entry of result.rows){
   if(!entry.quiz||!Number.isFinite(Number(entry.quiz.expiresAt))||Number(entry.quiz.expiresAt)>Date.now())continue;
   try {
    const room=String(entry.room_id);
    const answer=await ctx.withRoom(room,'',async d=>{
     const q=d.quiz;
     if(!d.game||!d.quizEnabled||!q||!Array.isArray(q.answers)||!q.answers.length||Number(q.expiresAt)>Date.now())return null;
     d.quizCooldownUntil=Math.max(Number(d.quizCooldownUntil)||0,Number(q.expiresAt)+ctx.QUIZ_COOLDOWN_SECONDS*1000);
     d.quiz=null;
     return String(q.answers[0]);
    });
    if(answer!==null)await ctx.send(ctx.globalChat,room,'⏰ 퀴즈 시간이 종료되었습니다.\n✅ 정답: '+answer);
   } catch(error){console.error('[QUIZ TIMEOUT]',entry.room_id,error);}
  }
 }finally{quizExpiryBusy=false;}
}

function issueQuizOnly(d){
 const text='#퀴즈';
 const now=Date.now();
 const ctxQuiz=ctx;
   if(text==="#퀴즈"){
     if(d.quiz&&d.quiz.expiresAt<=now){
       d.quizCooldownUntil=Math.max(
         Number(d.quizCooldownUntil)||0,
         d.quiz.expiresAt+ctx.QUIZ_COOLDOWN_SECONDS*1000
       );
       d.quiz=null;
     }

     if(d.quiz&&d.quiz.expiresAt>now){
       return `[ # ] QUIZ\n\n`+
         `Q. ${d.quiz.question}\n`+
         `${'\u200b'.repeat(1200)}`+
         `\n[ ${d.quiz.difficulty||'혼합'} · ${d.quiz.kind} ]\n`+
         `\n━━━━━━━━━━━━━━━━━━━━\n`+
         `[ QUIZ STATUS ]\n`+
         `이미 진행 중인 문제입니다.\n`+
         `남은 시간 | ${Math.ceil((d.quiz.expiresAt-now)/1000)}초`;
     }

     const remain=Math.ceil(
       ((Number(d.quizCooldownUntil)||0)-now)/1000
     );

     if(remain>0)
       return `[ ! ] 다음 퀴즈까지 ${remain}초 남았습니다.`;

     const {q,difficulty}=ctx.nextQuiz(d);

     d.quiz={
       kind:q[0],
       difficulty,
       question:q[1],
       answers:q[2],
       expiresAt:now+ctx.QUIZ_SECONDS*1000
     };

     return `[ # ] QUIZ\n\n`+
       `Q. ${q[1]}\n`+
       `${'\u200b'.repeat(1200)}`+
       `\n[ ${difficulty} · ${q[0]} ]\n`+
       `\n━━━━━━━━━━━━━━━━━━━━\n`+
       `[ QUIZ INFORMATION ]\n\n`+
       `제한 시간  | ${ctx.QUIZ_SECONDS}초\n`+
       `정답 보상  | ${ctx.n(ctx.QUIZ_REWARD)}코인\n`+
       `경험치     | +${ctx.QUIZ_XP} XP\n\n`+
       `[ ANSWER GUIDE ]\n\n`+
       `정답을 채팅에 입력하세요.\n`+
       `첫 번째 정답자에게 보상이 지급됩니다.\n`+
       `!정답 (답) 명령어도 사용 가능합니다.\n\n`+
       `━━━━━━━━━━━━━━━━━━━━\n`+
       `QUIZ SYSTEM`;
   }


}

async function handleGame(d,c,msg,isSelf){
 const text=String(msg.message?.text??msg.text??'').trim();
 const userId=ctx.id(msg.sender?.id??msg.senderId);
 const restoring=['네','아니요'].includes(text)&&d.players?.[userId]?.rodRestore;
 if(!text.startsWith('#')&&!restoring&&(!d.game||!d.quizEnabled||d.locked||!require('./quiz').plainAnswer(d.quiz,text)))return null;
 // Read-only operations never need wallet synchronization or extra row locks.
 const command=text.split(/\s+/,1)[0];
 if(new Set(['#퀴즈정보','#퀴즈순위','#낚시정보','#인벤','#물고기도감','#보호권','#펫인벤','#펫도감','#펫기능','#상점']).has(command))
   return handleGameCore(d,c,msg,isSelf);
 // Starting or viewing a quiz does not modify the wallet.
 if(command==='#퀴즈')return d.quizEnabled?issueQuizOnly(d):'[ X ] 이 방은 퀴즈 기능이 꺼져 있습니다.';
 if(!ctx.economyEnabled)return handleGameCore(d,c,msg,isSelf);
 const user=ctx.id(msg.sender?.id??msg.senderId),p=ctx.player(d,user,msg.sender?.name||user);
 return require('./economy').withPlayer({db:c,room:ctx.id(msg.room.id),user,p,msg,botId:ctx.globalBotId,run:()=>handleGameCore(d,c,msg,isSelf)});
}
async function handleGameCore(d,c,msg,isSelf){
  let text=String(msg.message?.text??msg.text??'').trim();
  const uid=ctx.id(msg.sender?.id??msg.senderId),name=String(msg.sender?.name||uid),p=ctx.player(d,uid,name),now=Date.now();
  if(d.quiz?.kind==='넌센스')d.quiz=null;
  if(require('./quiz').plainAnswer(d.quiz,text))text='#정답 '+text;
  if(text==="#명령어")return null;
  
   if(text==='#퀴즈정보'){
     return `[ # ] QUIZ\n`+
       `━━━━━━━━━━━━━━━━━━━━\n`+
       `[ QUIZ INFORMATION ]\n\n`+
       `문제 수    | ${ctx.QUIZZES.length}개\n`+
       `출제 분야  | 일반상식 · 수학\n`+
       `제한 시간  | ${ctx.QUIZ_SECONDS}초\n`+
       `정답 보상  | ${ctx.n(ctx.QUIZ_REWARD)}코인\n`+
       `경험치     | +${ctx.QUIZ_XP} XP\n`+
       `난이도     | 쉬움 60% · 도전 40%\n`+
       `작동 상태  | ${d.quizEnabled?'ON':'OFF'}\n`+
       `진행 상태  | ${d.quiz?'진행 중':'대기 중'}\n`+
       `━━━━━━━━━━━━━━━━━━━━\n`+
       `QUIZ SYSTEM`;
   }

   if(text==='#퀴즈순위'){
     const ranking=Object.values(d.players)
       .filter(x=>x.id!==ctx.globalBotId)
       .sort((a,b)=>(b.wins||0)-(a.wins||0))
       .slice(0,10);

     return `[ # ] QUIZ RANKING\n`+
       `━━━━━━━━━━━━━━━━━━━━\n`+
       (ranking.length
         ?ranking.map((x,i)=>
           `[ ${i+1} ] ${x.name} | ${x.wins||0}회`
         ).join('\n')
         :'아직 기록이 없습니다.')+
       `\n━━━━━━━━━━━━━━━━━━━━`;
   }

  const blockedFishing=/^#(?:어망|낚시|낚시정보|인벤|물고기도감|물고기|물고기판매|상점|낚시대구매|낚시장착|강화|보호권구매|보호권|구매행운|구매자동)(?:\s|$)/.test(text)||text==='네'||text==='아니요';
  if(blockedFishing&&!d.fishEnabled)return '🎣 이 방은 낚시 기능이 꺼져 있습니다.';
  if(p.rodRestore&&now>p.rodRestore.expires){const old=p.rodRestore;p.rodRestore=null;p.rod="나무";p.rods=p.rods.filter(x=>x!==old.rod);if(!p.rods.includes("나무"))p.rods.push("나무");delete p.rodLevels[old.rod];}
  if(p.rodRestore&&text!=="네"&&text!=="아니요")return "🛡️ 낚시대 파괴 복구 대기 중입니다. 60초 이내 네 또는 아니요를 입력하세요.";

  
   if((text==="#퀴즈"||text.startsWith("#정답"))&&!d.quizEnabled)
     return '[ X ] 이 방은 퀴즈 기능이 꺼져 있습니다.';

   if(text==="#낚시"&&!d.fishEnabled)
     return "🎣 이 방은 낚시 기능이 꺼져 있습니다.";

   if(text==="#퀴즈"){
     if(d.quiz&&d.quiz.expiresAt<=now){
       d.quizCooldownUntil=Math.max(
         Number(d.quizCooldownUntil)||0,
         d.quiz.expiresAt+ctx.QUIZ_COOLDOWN_SECONDS*1000
       );
       d.quiz=null;
     }

     if(d.quiz&&d.quiz.expiresAt>now){
       return `[ # ] QUIZ\n\n`+
         `Q. ${d.quiz.question}\n`+
         `${'\u200b'.repeat(1200)}`+
         `\n[ ${d.quiz.difficulty||'혼합'} · ${d.quiz.kind} ]\n`+
         `\n━━━━━━━━━━━━━━━━━━━━\n`+
         `[ QUIZ STATUS ]\n`+
         `이미 진행 중인 문제입니다.\n`+
         `남은 시간 | ${Math.ceil((d.quiz.expiresAt-now)/1000)}초`;
     }

     const remain=Math.ceil(
       ((Number(d.quizCooldownUntil)||0)-now)/1000
     );

     if(remain>0)
       return `[ ! ] 다음 퀴즈까지 ${remain}초 남았습니다.`;

     const {q,difficulty}=ctx.nextQuiz(d);

     d.quiz={
       kind:q[0],
       difficulty,
       question:q[1],
       answers:q[2],
       expiresAt:now+ctx.QUIZ_SECONDS*1000
     };

     return `🧩 퀴즈\nQ. ${q[1]}\n⏱ ${ctx.QUIZ_SECONDS}초\n정답을 채팅에 입력하세요.`;
   }

   const m=/^#정답(?:\s+([\s\S]+))?$/.exec(text);

   if(m){
     if(!d.quiz)
       return '[ ! ] 현재 진행 중인 퀴즈가 없습니다.';

     if(now>=d.quiz.expiresAt){
       const answer=d.quiz.answers[0];

       d.quizCooldownUntil=Math.max(
         now,d.quiz.expiresAt
       )+ctx.QUIZ_COOLDOWN_SECONDS*1000;

       d.quiz=null;

       return `[ ! ] 퀴즈 제한 시간이 종료되었습니다.\n`+
         `${'\u200b'.repeat(1200)}`+
         `\n━━━━━━━━━━━━━━━━━━━━\n`+
         `[ QUIZ TIMEOUT ]\n\n`+
         `정답 | ${answer}\n\n`+
         `━━━━━━━━━━━━━━━━━━━━\n`+
         `QUIZ SYSTEM`;
     }

     if(!m[1])
       return '[ ! ] 사용법: #정답 (답)';

     if(!d.quiz.answers.some(a=>
       require('./quiz').answerMatches(a,m[1])
     )){
       return '[ X ] 오답입니다.';
     }

     const answer=d.quiz.answers[0];

     d.quizCooldownUntil=
       now+ctx.QUIZ_COOLDOWN_SECONDS*1000;

     d.quiz=null;

     p.points+=ctx.QUIZ_REWARD;
     p.wins++;

     const up=ctx.addXp(p,ctx.QUIZ_XP);

     const cleanName=name.replace(/[\u0000-\u001f]/g,'');
     const mention=/^\d+$/.test(String(uid))
       ?`\u0002${uid}\u0003${cleanName}\u0004`
       :`@${cleanName}`;

     return `[ ✓ ] ${mention} 님이 정답을 맞혔습니다.\n`+
       `${'\u200b'.repeat(1200)}`+
       `\n━━━━━━━━━━━━━━━━━━━━\n`+
       `[ QUIZ RESULT ]\n\n`+
       `정답        | ${answer}\n`+
       `획득 코인   | +${ctx.n(ctx.QUIZ_REWARD)}코인\n`+
       `획득 경험치 | +${ctx.QUIZ_XP} XP\n\n`+
       `${up?`\n[ LEVEL UP ] Lv.${p.level}\n`:''}`+
       `\n━━━━━━━━━━━━━━━━━━━━\n`+
       `QUIZ SYSTEM`;
   }
  
  if(text==='#어망')return require('./net').catchNet(ctx,p,msg);
  if(text==="#낚시"){
    const remain=ctx.FISHING_COOLDOWN_SECONDS-Math.floor((now-p.lastFish)/1000);
    if(remain>0)return `🎣 아직 낚시 준비 중입니다. ${remain}초 후 다시 시도하세요.`;
    const r=ctx.awardFish(p,Date.now());
    const mention=`\u0002${uid}\u0003${name.replace(/[\u0000-\u001f]/g,'')}\u0004`;
    return `🎣 ${mention}님의 낚시 결과\n🐟 ${r.f.name} [${r.f.tier}] · ${r.size}cm\n${'\u200b'.repeat(1200)}\n💰 낚시 보상 · +${ctx.n(r.value)}코인\n`+
      `⭐ 획득 경험치 · +${r.xp} XP${r.up?`\n⬆️ 레벨 상승 · Lv.${p.level}`:''}\n`+
      `🎣 낚시대 · ${p.rod} +${p.rodLevels[p.rod]||0}\n🐾 장착 펫 · ${p.equippedPet||'없음'}\n`+
      `💰 판매 예상가 · ${ctx.n(r.value)}코인\n🎒 보유 물고기 · ${p.inventory.length}마리\n⏱ 다음 낚시 · ${ctx.FISHING_COOLDOWN_SECONDS}초 후`;
  }
  if(text==="네"||text==="아니요"){
    const pending=p.rodRestore;
    if(!pending)return null;
    p.rodRestore=null;
    if(now>pending.expires){p.rod="나무";p.rods=p.rods.filter(x=>x!==pending.rod);if(!p.rods.includes("나무"))p.rods.push("나무");delete p.rodLevels[pending.rod];return "⏰ 복구 시간이 지나 낚시대가 파괴되었습니다. 나무 낚시대 +0 지급";}
    if(text==="네"&&p.protection>0){p.protection--;p.rod=pending.rod;p.rodLevels[pending.rod]=pending.level;return `🛡️ 보호권 1개 사용!\n🎣 ${pending.rod} +${pending.level} 복구 완료\n남은 보호권: ${p.protection}개`;}
    p.rod="나무";p.rods=p.rods.filter(x=>x!==pending.rod);if(!p.rods.includes("나무"))p.rods.push("나무");delete p.rodLevels[pending.rod];return "💥 낚시대 파괴 확정. 나무 낚시대 +0 지급";
  }
  if(text==="#보호권")return `🛡️ 보유 보호권: ${p.protection}개\n오늘 구매: ${p.protectionDay===ctx.dayK()?p.protectionBought:0}/5개`;
  let protectMatch=/^#보호권구매(?:\s+(\S+))?$/.exec(text);
  if(protectMatch){const qty=protectMatch[1]===undefined?1:Number(protectMatch[1]);if(!Number.isSafeInteger(qty)||qty<1||qty>5)return "🛡️ 구매 수량은 1~5개로 입력하세요.";if(p.protectionDay!==ctx.dayK()){p.protectionDay=ctx.dayK();p.protectionBought=0;}if(p.protectionBought+qty>5)return `🛡️ 하루 5개까지만 구매할 수 있습니다. 오늘 남은 수량: ${5-p.protectionBought}개`;const cost=qty*100000;if(p.points<cost&&!isSelf)return `💰 ${ctx.n(cost)}코인이 필요합니다.`;if(!isSelf)p.points-=cost;p.protection+=qty;p.protectionBought+=qty;return `🛡️ 보호권 ${qty}개 구매 완료\n💰 비용 ${ctx.n(cost)}코인\n보유 ${p.protection}개 · 오늘 ${p.protectionBought}/5개`;}
  if(/^#강화(?:\s+\S+)?$/.test(text)){
    if(p.rodRestore)return "🛡️ 파괴된 낚시대의 복구를 먼저 결정하세요. 네 / 아니요";
    const countText=text.split(/\s+/)[1]||"1",count=Number(countText);
    if(!Number.isSafeInteger(count)||count<1||count>100)return "사용법: #강화 또는 #강화 10 / 50 / 100 (최대 100회)";
    const lines=[],rod=p.rod;let spent=0,success=0,fail=0;
    for(let i=0;i<count;i++){
      const lv=Number(p.rodLevels[rod])||0;
      if(lv>=30){lines.push("최대 강화 +30 도달");break;}
      const cost=ctx.enhancementCost(lv,10000),need=ctx.enhancementNeed(lv);
      if(p.level<need){lines.push(`Lv.${need} 이상 필요`);break;}
      if(p.points<cost&&!isSelf){lines.push(`코인 부족 (${ctx.n(cost)} 필요)`);break;}
      if(!isSelf)p.points-=cost;spent+=cost;
      const chance=lv<6?.95:lv<11?.85:lv<16?.70:lv<21?.55:lv<26?.35:.20;
      const destroy=lv<6?0:lv<11?.01:lv<16?.03:lv<21?.05:lv<26?.10:.15;
      if(Math.random()<chance){p.rodLevels[rod]=lv+1;success++;lines.push(`${i+1}회: 성공 +${lv+1}`);}
      else if(Math.random()<destroy){fail++;lines.push(`${i+1}회: 💥 파괴 판정 +${lv}`);if(p.protection>0){p.rodRestore={rod,level:lv,expires:now+60000};lines.push(`🛡️ 보호권 ${p.protection}개 보유\n60초 이내 네 / 아니요 로 복구 결정`);}else{p.rod="나무";p.rods=p.rods.filter(x=>x!==rod);if(!p.rods.includes("나무"))p.rods.push("나무");delete p.rodLevels[rod];lines.push("보호권 없음 · 나무 낚시대 +0 지급");}break;}
      else{fail++;lines.push(`${i+1}회: 실패 (+${lv} 유지)`);}
    }
    return `🎣 ${rod} 낚시대 강화\n성공 ${success}회 · 실패 ${fail}회\n💰 사용 ${ctx.n(spent)}코인\n현재 ${p.rod} +${p.rodLevels[p.rod]||0}\n${ctx.MORE}\n${lines.join("\n")}`;
  }
  if(text==="#구매행운"){if(p.luckUntil>now)return `🍀 행운 효과 종료까지 ${Math.ceil((p.luckUntil-now)/60000)}분 남았습니다.`;if(p.points<40000&&!isSelf)return "💰 40,000코인이 필요합니다.";if(!isSelf)p.points-=40000;p.luckUntil=now+600000;return "🍀 행운 구매 완료! 10분간 낚시 행운 50% 상승"}
  if(text==="#구매자동"){if(p.autoUntil>now)return `⏳ 자동 낚시가 작동 중입니다. 남은 시간 ${Math.ceil((p.autoUntil-now)/1000)}초`;if(p.autoDay!==ctx.dayK()){p.autoDay=ctx.dayK();p.autoBought=0;}if(p.autoBought>=3)return "🤖 오늘 자동 낚시 구매 3회를 모두 사용했습니다. 내일 다시 구매하세요.";if(p.points<ctx.AUTO_COST&&!isSelf)return "💰 50,000코인이 필요합니다.";if(!isSelf)p.points-=ctx.AUTO_COST;p.autoBought++;p.autoUntil=now+ctx.AUTO_DURATION;return `🤖 자동 낚시 구매 완료!\n작동 시간: 10분\n오늘 구매 ${p.autoBought}/3회\n🎣 ${ctx.FISHING_COOLDOWN_SECONDS}초마다 자동 낚시`;}
  if(text==="#펫뽑기"||/^#펫뽑기\s+(10|50|100)$/.test(text)){const count=Number(text.split(/\s+/)[1]||1),cost=count*ctx.PET_COST;if(p.points<cost&&!isSelf)return `💰 ${ctx.n(cost)}코인이 필요합니다.`;if(!isSelf)p.points-=cost;let dup=0;const results=[];for(let i=0;i<count;i++){const pet=ctx.drawPet();if(Object.prototype.hasOwnProperty.call(p.pets,pet.name)){dup++;p.points+=1000;results.push(`${i+1}. ${pet.name} [중복 +1,000]`)}else{p.pets[pet.name]=0;results.push(`${i+1}. ${pet.name} [NEW]`)}}return `🐾 펫 ${count}회 뽑기\n💰 사용 ${ctx.n(cost)}코인 · 중복 ${dup}마리 환급 ${ctx.n(dup*1000)}코인\n보유 ${Object.keys(p.pets).length}/20종\n${count>1?ctx.MORE:""}\n${results.join("\n")}`}
  if(text.startsWith("#펫뽑기"))return "사용법: #펫뽑기 또는 #펫뽑기 10 / 50 / 100";
  if(text==="#펫도감")return `📖 펫 도감 (${Object.keys(p.pets).length}/20)\n${ctx.MORE}\n`+ctx.PETS.map((x,i)=>`${i+1}. ${Object.prototype.hasOwnProperty.call(p.pets,x.name)?x.name:"???"}`).join("\n");
  if(text==="#펫인벤")return `🐾 펫 인벤 (${Object.keys(p.pets).length}/20)\n장착: ${p.equippedPet||"없음"}\n${ctx.MORE}\n`+(Object.keys(p.pets).length?Object.entries(p.pets).map(([x,lv],i)=>`${i+1}. ${x} +${lv}${p.equippedPet===x?" [장착]":""}`).join("\n"):"보유한 펫이 없습니다.");
  let pm=/^#펫기능\s+(.+)$/.exec(text);if(pm){const pet=ctx.PETS.find(x=>x.name===pm[1].trim());if(!pet)return "없는 펫입니다.";const level=p.pets[pet.name]||0,owned=Object.prototype.hasOwnProperty.call(p.pets,pet.name);return `🐾 ${pet.name}\n뽑기 가중치: ${pet.weight} (전체 가중치 중 비율 ${(pet.weight/ctx.PETS.reduce((v,x)=>v+x.weight,0)*100).toFixed(4)}%)\n🍀 행운 +${pet.luck+(owned?level*2:0)}%\n⭐ 경험치 +${pet.xp+(owned?level*2:0)}%\n💰 포인트 +${pet.points+(owned?level*2:0)}%\n강화: +${owned?level:0}/20`}
  pm=/^#펫장착\s+(.+)$/.exec(text);if(pm){let pet=pm[1].trim();if(pet==="최고"){const choices=ctx.PETS.filter(x=>Object.prototype.hasOwnProperty.call(p.pets,x.name));choices.sort((a,b)=>(b.luck+b.xp+b.points+6*p.pets[b.name])-(a.luck+a.xp+a.points+6*p.pets[a.name]));pet=choices[0]?.name||""}if(!Object.prototype.hasOwnProperty.call(p.pets,pet))return "보유한 펫이 없습니다.";p.equippedPet=pet;return `🐾 ${pet} +${p.pets[pet]} 장착 완료!`}
  if(text==="#펫강화"){if(!p.equippedPet)return "먼저 #펫장착 (이름)으로 펫을 장착하세요.";const lv=p.pets[p.equippedPet]||0;if(lv>=20)return "🐾 최대 강화(+20)입니다.";const cost=ctx.enhancementCost(lv,15000),need=ctx.enhancementNeed(lv);if(p.level<need)return `⭐ Lv.${need} 이상 필요합니다.`;if(p.points<cost&&!isSelf)return `💰 ${ctx.n(cost)}코인이 필요합니다.`;if(!isSelf)p.points-=cost;p.pets[p.equippedPet]=lv+1;return `🐾 ${p.equippedPet} +${lv+1}/20 강화 완료!\n💰 비용 ${ctx.n(cost)}코인`}
  if(text==="#물고기판매"||text.startsWith("#물고기판매 ")){
    const args=text.trim().split(/\s+/).slice(1);
    if(!args.length)return "사용법: #물고기판매 (이름) (수량/all) 또는 #물고기판매 all";
    let targets=[];
    if(args.length===1&&args[0].toLowerCase()==="all")targets=p.inventory.slice();
    else {
      if(args.length<2)return "사용법: #물고기판매 (이름) (수량/all)";
      const qtyText=args[args.length-1],fishName=args.slice(0,-1).join(" ");
      const matched=p.inventory.filter(x=>x.name===fishName);
      if(!matched.length)return `🐟 ${fishName}을(를) 보유하지 않았습니다.`;
      if(qtyText.toLowerCase()==="all")targets=matched;
      else {
        if(!/^[1-9]\d*$/.test(qtyText))return "판매 수량은 1 이상의 정수 또는 all로 입력하세요.";
        const count=Number(qtyText);
        if(!Number.isSafeInteger(count)||count>matched.length)return `🐟 보유 수량이 부족합니다. (${matched.length}마리)`;
        targets=matched.slice().sort((a,b)=>(Number(a.size)||0)-(Number(b.size)||0)).slice(0,count);
      }
    }
    if(!targets.length)return "🎒 판매할 물고기가 없습니다.";
    let total=0,alreadyPaid=0;
    const details=[];
    for(const fish of targets){
      const value=Math.max(0,Math.floor(Number(fish.value)||0));
      total+=value;
      details.push(`${fish.name} ${fish.size}cm → ${ctx.n(value)}코인`);
    }
    const selected=new Set(targets);
    p.inventory=p.inventory.filter(x=>!selected.has(x));
    p.points+=total;
    return `🐟 물고기 판매 완료!\n판매 수량: ${targets.length}마리\n💰 판매 금액: +${ctx.n(total)}코인\n💵 보유 코인: ${ctx.n(p.points)}\n${ctx.MORE}\n${details.join("\n")}`;
  }
  if(text==="#낚시정보")return `🎣 낚시 정보\n쿨타임 ${ctx.FISHING_COOLDOWN_SECONDS}초 · 결과 즉시 표시\n장착 낚시대: ${p.rod}\n잡은 물고기: ${p.inventory.length}마리`;
  if(text==="#인벤"){if(!p.inventory.length)return "🎒 인벤토리가 비어 있습니다.";return "🎒 내 물고기 인벤토리\n"+ctx.MORE+"\n"+p.inventory.map((x,i)=>`#${i+1} ${x.name} [${x.tier}] · ${x.size}cm · ${ctx.n(x.value)}코인`).join("\n")}
  if(text==="#물고기 도감"||text==="#물고기도감"){const caught=new Set(p.inventory.map(x=>x.name));return "📖 물고기 도감\n"+ctx.MORE+"\n"+ctx.FISH_TABLE.map(x=>caught.has(x.name)?`[${x.tier}] ${x.name} · ${x.min}~${x.max}cm`:"❓ ???").join("\n")};

  if(text==="#포인트")return isSelf?"🤖\n💰 코인: ∞":`💰 ${name}님의 코인: ${ctx.n(p.points)}`;
  if(text==="#퀴즈점수")return `⭐ LEVEL\n👤 ${name}\n🏆 Lv.${p.level} / 200\n✨ ${p.xp} / ${ctx.levelNeed(p.level)} XP\n📊 진행률: ${p.level>=200?100:Math.min(100,Math.floor(p.xp/ctx.levelNeed(p.level)*100))}%\n🧩 정답 ${p.wins}회`;

  if(text==="#게임순위"||text==="#퀴즈순위"){const a=Object.values(d.players).filter(x=>x.id!==ctx.globalBotId).sort((a,b)=>b.points-a.points).slice(0,10);return "🏆 게임 순위\n"+(a.length?a.map((x,i)=>`${i+1}등 ${x.name} · ${ctx.n(x.points)}코인`).join("\n"):"아직 기록이 없습니다.")}
  if(text==="#상점")return "🛒 낚시대 상점\n"+ctx.RODS.map(x=>`${x.name} 낚시대 · ${ctx.n(x.price)}코인${p.rods.includes(x.name)?" [보유]":""}`).join("\n");

  m=/^#낚시대구매\s+(.+)$/.exec(text);if(m){const r=ctx.RODS.find(x=>x.name===m[1].trim());if(!r)return "존재하지 않는 낚시대입니다.";if(p.rods.includes(r.name))return "이미 보유한 낚시대입니다.";if(p.points<r.price&&!isSelf)return "코인이 부족합니다.";if(!isSelf)p.points-=r.price;p.rods.push(r.name);return `✅ ${r.name} 낚시대를 구매했습니다.`}
  m=/^#낚시장착\s+(.+)$/.exec(text);if(m){const x=m[1].trim();if(!p.rods.includes(x))return "보유하지 않은 낚시대입니다.";p.rod=x;return `🎣 ${x} 낚시대를 장착했습니다.`}
  return null
}
return {levelNeed,addXp,player,shuffle,nextQuiz,fishPick,fishValue,gameHelp,petBonus,rodLuck,awardFish,drawPet,enhancementCost,enhancementNeed,autoFishTick,quizExpiryTick,handleGame};
};
