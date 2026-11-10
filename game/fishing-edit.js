'use strict';

// Format fishing results and send the final text without progress or edits.
// The existing fishing command still handles rewards, cooldowns, and DB writes.
// Show the catch immediately; keep full reward/gear details behind KakaoTalk's
// '전체보기' folding marker. No rewards or inventory are changed by this formatter.
const FISH_RESULT_FOLD='\u200b'.repeat(1200);
function formatCatchResult({ctx,player,catchInfo,mention}){
 const f=catchInfo.f;
 const tierIcon={
  '일반':'⚪','희귀':'🔵','영웅':'🟣','전설':'🟡','신화':'🔴'
 }[f.tier]||'🐟';
 return '🎣 카카오톡 게임 매니저 | 낚시 결과\n'+
  '━━━━━━━━━━━━━━━━━━\n'+
  '👤 '+mention+'님\n'+
  '🐟 '+f.name+' · '+tierIcon+' '+f.tier+' · '+catchInfo.size+'cm\n'+
  FISH_RESULT_FOLD+'\n'+
  '━━━━━━━━━━━━━━━━━━\n'+
  '💰 낚시 보상 · +'+ctx.n(catchInfo.value)+'코인\n'+
  '⭐ 획득 경험치 · +'+catchInfo.xp+' XP'+
  (catchInfo.up?'\n⬆️ 레벨 UP · Lv.'+player.level:'')+'\n'+
  '🎣 낚시대 · '+player.rod+' +'+(player.rodLevels[player.rod]||0)+'\n'+
  '🐾 장착 펫 · '+(player.equippedPet||'없음')+'\n'+
  '💵 판매 예상가 · '+ctx.n(catchInfo.value)+'코인\n'+
  '🎒 보유 물고기 · '+player.inventory.length+'마리\n'+
  '⏱ 다음 낚시 · '+ctx.FISHING_COOLDOWN_SECONDS+'초 후\n'+
  '━━━━━━━━━━━━━━━━━━';
}
const isCatchResult=text=>typeof text==='string'&&
 text.startsWith('🎣 카카오톡 게임 매니저 | 낚시 결과\n')&&text.includes('\n🐟 ');
const editableText=text=>String(text).replace(/\u0002\d+\u0003([^\u0004]*)\u0004/g,'@$1');
async function sendCatchResult({result,sendFallback}){
 await sendFallback(result);return 'normal';
}
module.exports={formatCatchResult,isCatchResult,editableText,sendCatchResult};
