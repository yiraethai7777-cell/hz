'use strict';

// KakaoTalk VoiceRoom command controller.
// IMPORTANT: There is no confirmed KakaoForge create-voice-room packet.
// Do not send guessed LOCO methods (such as CREATE_VOICEROOM).
// An explicitly installed, verified client.voiceRoomAdapter is required.
const running=new Set();
const MANAGERS=new Set([1,4]);
const MAX_TITLE=40;

function managerRole(value) {
  return MANAGERS.has(Number(value));
}
function roomKey(id) {
  const value=String(id??'');
  if(!/^[1-9]\d*$/.test(value)) throw Error('정확한 채팅방 ID가 필요합니다.');
  return value;
}
function botMemberType(client,roomId) {
  if(!client || client.userId==null)return null;
  let value=null;
  if(typeof client._getCachedMemberType==='function'){
    try{value=client._getCachedMemberType(roomId,client.userId);}
    catch(err){console.warn('[보이스룸] 캐시 권한 확인 실패:',String(err?.message||err));}
  }
  // Only the current chatroom may use client.type as a fallback.
  if(value==null && String(client._activeChatId??'')===String(roomId))
    value=client.type;
  return value==null?null:Number(value);
}
function adapterOf(client) {
  const adapter=client?.voiceRoomAdapter;
  return adapter && typeof adapter.create==='function'?adapter:null;
}
function parseTitle(value) {
  const raw=String(value??'').replace(/\r\n?/g,'\n').trim();
  if(!raw) return '보이스룸';
  if(raw.length>MAX_TITLE)throw Error('보이스룸 이름은 '+MAX_TITLE+'자 이하로 입력해 주세요.');
  if(/[\u0000-\u001f\u007f]/.test(raw))throw Error('보이스룸 이름에 줄바꿈 또는 제어문자를 사용할 수 없습니다.');
  return raw;
}
function verifiedCreated(result) {
  return !!result && result.created===true && result.verified===true &&
    result.success!==false && result.ok!==false &&
    (result.status===undefined || result.status===0);
}
function verifiedActive(result,roomId) {
  if(!result || result.active!==true || result.verified!==true)return false;
  if(result.roomId!==undefined && String(result.roomId)!==String(roomId))return false;
  return result.status===undefined || result.status===0;
}
async function safeReply(client,send,message) {
  if(client?.connected===false) {
    console.warn('[보이스룸] 안내 전송 불가: 카카오톡 연결 없음');
    return false;
  }
  try{await send(message);return true;}
  catch(e){console.error('[보이스룸] 안내 전송 실패:',String(e?.message||e));return false;}
}

async function handle({client,roomId,msg,text,send,adapter}){
  const raw=String(text??'').trim();
  const match=/^[#!]?(보룸켜기|보룸상태|보이스룸켜기|보이스룸상태)(?=$|\s)/.exec(raw);
  if(!match)return false;
  // Ignore the bot's own commands to avoid message loops.
  if(client?.userId!=null && String(client.userId)===String(msg?.sender?.id))return true;
  if(msg?.room?.isOpenChat!==true){
    await safeReply(client,send,'❌ 보이스룸 명령어는 오픈채팅방에서만 사용할 수 있습니다.');
    return true;
  }
  if(!managerRole(msg?.sender?.type)){
    await safeReply(client,send,'❌ 방장 또는 부방장만 이 명령어를 사용할 수 있습니다.');
    return true;
  }

  const room=roomKey(roomId);
  const transport=adapter===undefined?adapterOf(client):adapter;
  const role=botMemberType(client,room);
  const isStatus=match[1].endsWith('상태');
  if(isStatus){
    const roleText=role==null || role===0?'확인 불가':managerRole(role)?'방장/부방장':'일반 멤버';
    let capability=transport?'연동 모듈 설치됨 (실제 서버 개설 여부 미확인)':
      '미연동 (보이스룸 생성 요청 미지원)';
    if(transport && typeof transport.status==='function'){
      try{
        const state=await transport.status({roomId:room});
        if(verifiedActive(state,room))
          capability='✅ 서버에서 개설 상태 확인'+(state.voiceRoomId?' · ID: '+String(state.voiceRoomId):'');
        else
          capability='모듈 연결됨 · 현재 보이스룸 개설 여부 미확인';
      }catch(e){
        console.warn('[보이스룸] 상태 조회 실패:',String(e?.message||e));
        capability='모듈 연결됨 · 상태 조회 실패';
      }
    }
    await safeReply(client,send,'🎙️ 보이스룸 상태\n━━━━━━━━━━━━━━\n봇 권한: '+roleText+
      '\n개설 연동: '+capability+'\n※ 단순 채팅 메시지는 보이스룸을 개설하지 않습니다.');
    return true;
  }

  if(!transport){
    await safeReply(client,send,'⚠️ 보이스룸 생성 API가 아직 연결되지 않았습니다.\n'+
      'CREATE_VOICEROOM은 검증된 LOCO 명령어가 아니므로 전송하지 않습니다.\n'+
      '카카오톡 앱의 + 메뉴에서 보이스룸을 직접 개설할 수 있습니다.');
    return true;
  }
  if(!managerRole(role)){
    await safeReply(client,send,role==null || role===0?
      '❌ 이 방에서 봇 계정의 방장/부방장 권한을 확인할 수 없습니다. 안전을 위해 생성 요청을 보내지 않습니다.':
      '❌ 보이스룸을 생성하려면 봇 계정에도 방장 또는 부방장 권한이 필요합니다.');
    return true;
  }
  if(client?.connected===false)return true;
  let title;
  try{title=parseTitle(raw.slice(match[0].length));}
  catch(err){await safeReply(client,send,'❌ '+String(err.message||err));return true;}
  if(running.has(room)){
    await safeReply(client,send,'⏳ 이미 이 방의 보이스룸 개설 요청을 처리하고 있습니다.');
    return true;
  }
  running.add(room);
  try{
    // Only an installed adapter whose implementation has been verified may
    // perform the actual voice signalling operation.
    const response=await transport.create({
      roomId:room,
      title,
      openLinkId:msg?.room?.openLinkId == null?null:String(msg.room.openLinkId)
    });
    let confirmed=verifiedCreated(response);
    let id=response?.voiceRoomId||null;
    if(!confirmed && typeof transport.status==='function'){
      const state=await transport.status({roomId:room});
      confirmed=verifiedActive(state,room);
      if(confirmed)id=state.voiceRoomId||id;
    }
    if(confirmed){
      await safeReply(client,send,'🎙️ 보이스룸 생성 확인!\n이름: '+title+
        (id?'\n보이스룸 ID: '+String(id):''));
    }else{
      await safeReply(client,send,'⚠️ 보이스룸 생성 요청 결과를 검증하지 못했습니다.\n'+
        '실제 카카오톡 화면에서 상태를 확인한 뒤 재시도해 주세요.');
    }
  }catch(err){
    console.error('[보이스룸] 생성 요청 실패:',String(err?.message||err));
    await safeReply(client,send,'❌ 보이스룸 생성 실패: '+String(err?.message||err));
  }finally{
    running.delete(room);
  }
  return true;
}
module.exports={handle,adapterOf,botMemberType,parseTitle,verifiedCreated,verifiedActive};
