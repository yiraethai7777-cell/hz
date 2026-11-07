'use strict';
function questionText(q,{reward=10000,xp=30,now=Date.now(),active=false}={}){
 const seconds=Math.max(0,Math.ceil((q.expiresAt-now)/1000));
 return '🧩 NEXI | QUIZ\n'+
 '━━━━━━━━━━━━━━━━━━\n'+
 (active?'진행 중인 문제':'새로운 도전')+' · '+q.kind+' / '+(q.difficulty||'혼합')+'\n\n'+
 'Q. '+q.question+'\n\n'+
 '━━━━━━━━━━━━━━━━━━\n'+
 '⏱ 남은 시간  '+seconds+'초\n'+
 '🪙 정답 보상  '+Number(reward).toLocaleString('ko-KR')+'코인\n'+
 '✨ 경험치  +'+xp+' XP\n'+
 '━━━━━━━━━━━━━━━━━━\n'+
 '정답을 채팅에 입력하세요.\n'+
 '또는 !정답 (답)\n'+
 '가장 먼저 맞힌 한 명에게 보상이 지급됩니다.';
}
module.exports={questionText};
