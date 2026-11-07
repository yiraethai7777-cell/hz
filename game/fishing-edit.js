'use strict';

// Present a successful catch as a single KakaoTalk message updated by MODIFYMSG.
// The existing fishing command still handles rewards, cooldowns, and DB writes.
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Show the catch immediately; keep full reward/gear details behind KakaoTalk's
// '전체보기' folding marker. No rewards or inventory are changed by this formatter.
const FISH_RESULT_FOLD='\u200b'.repeat(1200);
function formatCatchResult({ctx,player,catchInfo,mention}){
 const f=catchInfo.f;
 const tierIcon={
  '일반':'⚪','희귀':'🔵','영웅':'🟣','전설':'🟡','신화':'🔴'
 }[f.tier]||'🐟';
 return '🎣 NEXI | 낚시 결과\n'+
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
 text.startsWith('🎣 NEXI | 낚시 결과\n')&&text.includes('\n🐟 ');
const editableText=text=>String(text).replace(/\u0002\d+\u0003([^\u0004]*)\u0004/g,'@$1');
const statusOf=response=>response?.status??response?.body?.status;
function requireAccepted(response,action){
 const status=statusOf(response);
 if(response===false||response?.success===false||response?.ok===false||
    (status!=null&&Number(status)!==0))
  throw Error(action+' failed, status='+String(status));
}
function editMethod(chat,client){
 if(typeof chat?.editMessage==='function')return chat.editMessage.bind(chat);
 if(typeof client?.editMessage==='function')return client.editMessage.bind(client);
 return null;
}
async function sendEditedCatch({chat,client,roomId,result,name,sendFallback,wait=sleep}){
 if(!isCatchResult(result)){
  await sendFallback(result);
  return 'normal';
 }
 const edit=editMethod(chat,client);
 if(!edit){
  await sendFallback(result);
  return 'fallback';
 }
 const displayName=String(name||'낚시꾼').replace(/[\u0000-\u001f\u007f-\u009f]/g,'').slice(0,36);
 const stages=[
  '🎣 NEXI | 낚시\n\n🌊 '+displayName+'님이 낚시를 시작했습니다.',
  '🎣 NEXI | 낚시\n\n🐟 물고기를 끌어올리고 있습니다…'
 ];
 try{
  const sent=await chat.sendText(roomId,stages[0]);
  requireAccepted(sent,'WRITE');
  const logId=sent?.body?.logId??sent?.logId;
  if(logId==null||String(logId)==='0')throw Error('WRITE response missing logId');
  await wait(1100);
  requireAccepted(await edit(roomId,logId,stages[1]),'MODIFYMSG (progress)');
  await wait(1500);
  requireAccepted(await edit(roomId,logId,editableText(result)),'MODIFYMSG (result)');
  return 'edited';
 }catch(error){
  console.warn('[NEXI FISH EDIT FALLBACK]',String(error?.message||error));
  await sendFallback(result);
  return 'fallback';
 }
}
module.exports={formatCatchResult,isCatchResult,editableText,sendEditedCatch};
