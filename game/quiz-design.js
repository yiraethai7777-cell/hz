'use strict';
const FOLD='\u200b'.repeat(1200);
function questionText(q,{reward=10000,xp=30,now=Date.now(),active=false}={}){
 const seconds=Math.max(0,Math.ceil((q.expiresAt-now)/1000));
 return '🧩 NEXI | QUIZ\nQ. '+q.question+'\n'+FOLD+'\n'+
 '━━━━━\n'+
 (active?'진행 중인 문제':'새로운 도전')+' · '+q.kind+' / '+(q.difficulty||'혼합')+'\n'+
 '⏱ '+seconds+'초 · 🪙 '+Number(reward).toLocaleString('ko-KR')+'코인 · ✨ +'+xp+' XP\n'+
 '정답만 입력하거나 !정답 (답)\n'+
 '첫 정답자 1명에게 보상이 지급됩니다.';
}
module.exports={questionText};
