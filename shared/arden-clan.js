'use strict';
// ARDEN membership gate: opt-in per room, never changes other rooms' NEXI behavior.
const {getPool}=require('./db');
const {commandLike}=require('./command-blocks');
let schemaPromise=null;
const notices=new Map();
async function init(db=getPool()){
 if(!schemaPromise){
  schemaPromise=db.query(
   "CREATE TABLE IF NOT EXISTS hz_arden_members ("+
   "room_id TEXT NOT NULL,user_id TEXT NOT NULL,user_name TEXT NOT NULL DEFAULT '',"+
   "joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(room_id,user_id))"
  ).catch(error=>{schemaPromise=null;throw error;});
 }
 await schemaPromise;
}
function accepted(result){
 if(result===false||result?.success===false||result?.ok===false)return false;
 if(typeof result?.status==='number'&&result.status!==0)return false;
 if(typeof result?.body?.status==='number'&&result.body.status!==0)return false;
 return true;
}
function validUser(value){return /^[1-9]\d{3,24}$/.test(String(value??''));}
async function handle({client,chat,roomId,userId,userName,text,isBotAccount=false,active=false,management,ready,msg}){
 const command=String(text||'').trim().split(/\s+/,1)[0];
 const room=String(roomId),user=String(userId??'');
 if(!active&&command!=='!클랜설정on'&&command!=='!클랜설정off')return false;
 const send=body=>chat.sendText(roomId,body);
 const db=getPool();
 try{
  if(command==='!클랜설정on'||command==='!클랜설정off'){
   // The Kakao bot account alone may activate membership gating in this room.
   if(!isBotAccount)return true;
   if(text!==command){await send('사용법: '+command);return true;}
   const on=command==='!클랜설정on';
   if(on)await init(db);
   await db.query(
    "INSERT INTO hz_rooms(room_id,data) VALUES($1,jsonb_build_object('ardenClan',$2::boolean)) "+
    "ON CONFLICT(room_id) DO UPDATE SET data=jsonb_set(hz_rooms.data,'{ardenClan}',to_jsonb($2::boolean),true),updated_at=NOW()",
    [room,on]
   );
   await send(on?'⚜️ 𝑨𝑹𝑫𝑬𝑵 | 클랜 가입 제한 활성화\n!클랜가입 후 게임·출석 등 명령어를 사용할 수 있습니다.':'⚜️ 𝑨𝑹𝑫𝑬𝑵 | 클랜 가입 제한 비활성화');
   return true;
  }
  if(!active)return false;
  if(command==='!클랜가입'){
   if(text!==command){await send('사용법: !클랜가입');return true;}
   if(!validUser(user)){await send('❌ 카카오 사용자 ID를 확인할 수 없습니다.');return true;}
   await init(db);
   const result=await db.query(
    "INSERT INTO hz_arden_members(room_id,user_id,user_name) VALUES($1,$2,$3) "+
    "ON CONFLICT(room_id,user_id) DO NOTHING RETURNING joined_at",
    [room,user,String(userName||'').slice(0,80)]
   );
   await send(result.rowCount
    ?'⚜️ 𝑨𝑹𝑫𝑬𝑵 | 클랜 가입 완료\n👤 '+String(userName||'클랜원')+'님, 환영합니다!\n✅ 승인 없이 즉시 가입되었습니다.\n🎮 이제 출석·낚시·채굴·퀴즈 등 봇 기능을 사용할 수 있습니다.'
    :'ℹ️ 이미 ARDEN 클랜에 가입되어 있습니다.');
   return true;
  }
  if(command==='!클랜탈퇴'){
   if(text!==command){await send('사용법: !클랜탈퇴');return true;}
   if(!validUser(user)){await send('❌ 카카오 사용자 ID를 확인할 수 없습니다.');return true;}
   await init(db);
   const removed=await db.query("DELETE FROM hz_arden_members WHERE room_id=$1 AND user_id=$2 RETURNING user_id",[room,user]);
   if(!removed.rowCount){await send('ℹ️ 현재 ARDEN 클랜에 가입되어 있지 않습니다.');return true;}
   // Revoke access before the kick. Never let an API failure restore membership.
   if(typeof client?.openChatKick!=='function'||typeof client?.openChatUnkick!=='function'){
    await send('⚠️ 클랜 탈퇴는 완료했지만, 자동 내풀에 필요한 카카오톡 API가 없습니다.\n관리자에게 직접 내보내기를 요청해 주세요.');
    return true;
   }
   let kicked=false;
   try{
    const result=await client.openChatKick(room,user);
    if(!accepted(result))throw Error('카카오톡 서버가 내보내기 요청을 거부했습니다.');
    kicked=true;
    const release=await client.openChatUnkick(room,user);
    if(!accepted(release))throw Error('카카오톡 서버가 내보내기 해제를 거부했습니다.');
    try{
     await db.query("INSERT INTO gl_manage_actions(room_id,actor_id,target_id,action,detail) VALUES($1,$2,$3,'KICK_RELEASE',$4)",[room,user,user,'ARDEN 자발적 클랜 탈퇴 · 자동 내풀']);
    }catch(logError){console.warn('[ARDEN LEAVE LOG]',String(logError?.message||logError));}
    await send('⚜️ 𝑨𝑹𝑫𝑬𝑵 | 클랜 탈퇴 완료\n'+String(userName||'클랜원')+'님의 자동 내풀(내보내기 후 해제)을 요청했습니다.\n언제든 재입장 후 다시 가입할 수 있습니다.');
   }catch(error){
    console.error('[ARDEN AUTO KICK RELEASE]',String(error?.message||error));
    await send(kicked
     ?'⚠️ 클랜 탈퇴와 내보내기 요청은 처리했지만 해제 요청에 실패했습니다.\n관리자에게 !벤해제 '+user+' 처리를 요청해 주세요.'
     :'⚠️ 클랜 탈퇴는 완료했지만 자동 내풀 요청에 실패했습니다.\n봇의 방장·부방장 권한을 확인해 주세요.');
   }
   return true;
  }
  if(command==='!클랜정보'){
   await init(db);
   const [count,mine]=await Promise.all([
    db.query('SELECT count(*)::int AS count FROM hz_arden_members WHERE room_id=$1',[room]),
    db.query('SELECT 1 FROM hz_arden_members WHERE room_id=$1 AND user_id=$2',[room,user])
   ]);
   await send('⚜️ 𝑨𝑹𝑫𝑬𝑵 | 클랜 정보\n👥 정식 클랜원: '+count.rows[0].count+'명\n📋 내 가입 상태: '+(mine.rowCount?'가입 완료':'미가입')+'\n!클랜가입 / !클랜탈퇴');
   return true;
  }
  if(isBotAccount)return false;
  // All player-facing commands, replies to games, and hidden quiz interactions
  // must pass the membership gate before any downstream handler runs.
  if(!validUser(user))return true;
  await init(db);
  const member=await db.query('SELECT 1 FROM hz_arden_members WHERE room_id=$1 AND user_id=$2',[room,user]);
  if(member.rowCount)return false;
  if(commandLike(text)){
   // Rate-limit denial text while still blocking every command.
   const key=room+':'+user,now=Date.now();
   if(now-(notices.get(key)||0)>10000){
    notices.set(key,now);
    if(notices.size>2000)notices.clear();
    await send('⛔ ARDEN 정식 클랜원만 NEXI 명령어를 사용할 수 있습니다.\n⚜️ !클랜가입 입력 시 승인 없이 즉시 가입됩니다.');
   }
  }else if(management){
   // Preserve passive moderation/chat counts, but never dispatch game replies.
   await ready;
   await management.message({client,roomId,userId:user,userName,text,msg,send,senderType:msg?.sender?.type,botId:client?.userId,isBotAccount});
  }
  return true;
 }catch(error){
  console.error('[ARDEN CLAN GATE]',String(error?.message||error));
  if(commandLike(text))try{await send('❌ 클랜 시스템 오류로 명령어를 처리하지 못했습니다.');}catch{}
  // Fail closed in an ARDEN room: DB failures must not open the game gate.
  return true;
 }
}
module.exports={init,handle};
