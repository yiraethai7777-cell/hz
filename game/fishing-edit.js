'use strict';

// Present a successful catch as a single KakaoTalk message updated by MODIFYMSG.
// The existing fishing command still handles rewards, cooldowns, and DB writes.
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const isCatchResult=text=>typeof text==='string'&&
 text.startsWith('🎣 ')&&text.includes('님의 낚시 결과\n🐟 ');
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
  '🎣 NEXI | 낚시\n\n🌊 '+displayName+'님이 낚싯줄을 던졌습니다.\n🪝 찌를 띄우고 입질을 기다립니다…\n🐠 물고기를 기다리고 있습니다…',
  '🎣 NEXI | 낚시\n\n🐟 입질이 왔습니다!\n💦 물살이 거세지고 있습니다!\n🎣 낚싯줄을 끌어올리는 중입니다…'
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
module.exports={isCatchResult,editableText,sendEditedCatch};
