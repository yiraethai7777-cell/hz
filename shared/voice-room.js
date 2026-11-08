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
  return adapter && (typeof adapter.create==='function' || typeof adapter.status==='function' || typeof adapter.stop==='function')?adapter:null;
}
function parseTitle(value) {
  const raw=String(value??'').replace(/\r\n?/g,'\n').trim();
  if(!raw || /^[.!。]$/.test(raw)) return '보이스룸';
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
function verifiedInactive(result,roomId) {
  return !!result && result.active===false && result.verified===true &&
    String(result.roomId??'')===String(roomId) &&
    (result.status===undefined || result.status===0);
}
function verifiedStopped(result,roomId) {
  return !!result && result.closed===true && result.verified===true &&
    String(result.roomId??'')===String(roomId) &&
    result.success!==false && result.ok!==false &&
    (result.status===undefined || result.status===0);
}
async function safeReply(client,send,message) {
  if(client?.connected===false) {
    console.warn('[보이스룸] 안내 전송 불가: 카카오톡 연결 없음');
    return false;
  }
  console.log('[보이스룸] 안내 응답 생성:', JSON.stringify({chars:String(message).length}));
  try{
    await send(message);
    console.log('[보이스룸] 안내 응답 전송 완료');
    return true;
  }catch(e){
    console.error('[보이스룸] 안내 전송 실패:',String(e?.message||e));
    return false;
  }
}

async function handle({client,roomId,msg,text,send,adapter}){
  const raw=String(text??'').trim();
  const match=/^[#!]?(보룸켜기|보룸시작|보룸끄기|보룸종료|보룸상태|보룸감지시작|보룸감지종료|보룸감지|보룸명령어|보이스룸켜기|보이스룸시작|보이스룸끄기|보이스룸종료|보이스룸상태|보이스룸감지시작|보이스룸감지종료|보이스룸감지|보이스룸명령어)(?=$|\s|[.!。])/.exec(raw);
  if(!match)return false;
  // Authorize the actual bot account by its Kakao ID, independently of the
  // sender.type carried by the message. Never trust a boolean from the event.
  // Bot owner privileges for server create/stop are still checked below.
  const botId=client?.userId==null?'':String(client.userId);
  const senderValue=msg?.sender?.id ?? msg?.senderId;
  const senderId=senderValue==null?'':String(senderValue);
  const isBotAccount=botId!=='' && botId!=='0' && senderId!=='' && botId===senderId;
  if(msg?.room?.isOpenChat!==true){
    await safeReply(client,send,'❌ 보이스룸 명령어는 오픈채팅방에서만 사용할 수 있습니다.');
    return true;
  }
  if(!isBotAccount && !managerRole(msg?.sender?.type)){
    await safeReply(client,send,'❌ 방장·부방장 또는 봇 계정만 이 명령어를 사용할 수 있습니다.');
    return true;
  }

  const room=roomKey(roomId);
  const transport=adapter===undefined?adapterOf(client):adapter;
  const role=botMemberType(client,room);
  const isStatus=match[1].endsWith('상태');
  const isStop=match[1].endsWith('끄기') || match[1].endsWith('종료');
  const isHelp=match[1].endsWith('명령어');
  if(match[1].includes('감지')){
    const observer=require('./voice-room-observer');
    if(match[1].endsWith('감지시작')){
      observer.start(room);
      await safeReply(client,send,'🔎 보이스룸 감지를 3분간 시작했습니다.\n'+
        '이 방에서 카카오톡 앱으로 보이스룸을 직접 개설한 뒤 #보룸감지를 입력해 주세요.\n'+
        '※ 관련 이벤트를 관찰할 뿐, 실제 개설/활성 상태를 확인하는 API는 아닙니다.');
    }else if(match[1].endsWith('감지종료')){
      const removed=observer.stop(room);
      await safeReply(client,send,removed?'🔎 보이스룸 이벤트 감지를 종료했습니다.':
        '🔎 이 방에서 진행 중인 보이스룸 감지가 없습니다.');
    }else{
      const result=observer.get(room);
      if(!result.observing){
        await safeReply(client,send,'🔎 진행 중인 감지가 없습니다.\n먼저 #보룸감지시작을 입력해 주세요.');
      }else if(!result.events.length){
        await safeReply(client,send,'🔎 보이스룸 감지 결과\n━━━━━━━━━━━━━━\n'+
          '관찰된 관련 이벤트: 0건\n남은 시간: '+result.remainingSeconds+'초\n'+
          '판정: 확인 불가\n※ 이벤트가 없어도 보룸이 열리지 않았다는 의미는 아닙니다.');
      }else{
        const detail=result.events.map((e,index)=>e.source==='message'?
          (index+1)+'번째: 채팅 유형 '+e.type+
          (e.phaseHint?' · '+e.phaseHint:'')+
          (e.shape?' · 첨부필드 '+e.shape:''):
          (index+1)+'번째: 서버 푸시 '+e.method).join('\n');
        await safeReply(client,send,'🔎 보이스룸 감지 결과\n━━━━━━━━━━━━━━\n'+
          '관련 이벤트 후보: '+result.events.length+'건\n'+
          '종류:\n'+detail.slice(0,600)+'\n남은 시간: '+result.remainingSeconds+'초\n'+
          '판정: 보이스룸 관련 신호 후보 발견 (실제 개설/활성 여부 미확정)');
      }
    }
    return true;
  }
  if(isHelp){
    await safeReply(client,send,'🎙️ NEXI | 보이스룸 명령어\n' +
      '#보룸시작 (제목) / #보룸켜기 (제목) · 실제 보이스룸 생성 요청\n' +
      '#보룸상태 · 서버 상태/연동 확인\n' +
      '#보룸감지시작 · 3분간 수신 이벤트 관찰\n' +
      '#보룸감지 · 관찰된 신호 후보 확인\n' +
      '#보룸감지종료 · 관찰 중단\n' +
      '#보룸종료 / #보룸끄기 · 확인된 보이스룸 종료 요청\n' +
      '※ 실제 서버 API가 연결된 경우에만 생성·종료합니다.\n' +
      '※ 방장·부방장 및 봇 계정이 사용 가능합니다.\n' +
      '※ 봇 계정은 명령어를 직접 사용할 수 있지만 실제 생성·종료는 카카오톡 서버 권한 및 API 지원에 따릅니다.');
    return true;
  }
  if(isStatus){
    const roleText=role==null || role===0?'확인 불가':managerRole(role)?'방장/부방장':'일반 멤버';
    let capability=transport?'연동 모듈 설치됨 (실제 서버 개설 여부 미확인)':
      '미연동 (보이스룸 생성 요청 미지원)';
    if(transport && typeof transport.status==='function'){
      try{
        const state=await transport.status({roomId:room});
        if(verifiedActive(state,room))
          capability='✅ 서버에서 개설 상태 확인'+(state.voiceRoomId?' · ID: '+String(state.voiceRoomId):'');
        else if(verifiedInactive(state,room))
          capability='✅ 서버에서 비활성 상태 확인';
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

  if(isStop){
    if(!transport || typeof transport.stop!=='function' || typeof transport.status!=='function'){
      await safeReply(client,send,'⚠️ 실제 보이스룸 종료 API 또는 서버 상태 조회 API가 연결되지 않았습니다.');
      return true;
    }
    if(!isBotAccount && !managerRole(role)){
      await safeReply(client,send,'❌ 보이스룸 종료 요청을 보내려면 봇 계정의 방장·부방장 권한을 확인해야 합니다.');
      return true;
    }
    if(running.has(room)){
      await safeReply(client,send,'⏳ 이 방의 보이스룸 요청을 이미 처리하고 있습니다.');
      return true;
    }
    running.add(room);
    try{
      const before=await transport.status({roomId:room});
      if(!verifiedActive(before,room)){
        await safeReply(client,send,'⚠️ 서버에서 활성 보이스룸을 확인하지 못해 종료 요청을 보내지 않았습니다.');
        return true;
      }
      const response=await transport.stop({roomId:room,voiceRoomId:before.voiceRoomId??null});
      let confirmed=verifiedStopped(response,room);
      if(!confirmed){
        const after=await transport.status({roomId:room});
        confirmed=verifiedInactive(after,room);
      }
      await safeReply(client,send,confirmed?
        '🎙️ 보이스룸 종료가 서버에서 확인되었습니다.':
        '⚠️ 보이스룸 종료 결과를 검증하지 못했습니다. 실제 상태를 확인해 주세요.');
    }catch(err){
      console.error('[보이스룸] 종료 요청 실패:',String(err?.message||err));
      await safeReply(client,send,'❌ 보이스룸 종료 요청에 실패했습니다.');
    }finally{
      running.delete(room);
    }
    return true;
  }
  if(!transport || typeof transport.create!=='function'){
    await safeReply(client,send,'⚠️ 보이스룸 생성 API가 아직 연결되지 않았습니다.\n'+
      'CREATE_VOICEROOM은 검증된 LOCO 명령어가 아니므로 전송하지 않습니다.\n'+
      '카카오톡 앱의 + 메뉴에서 보이스룸을 직접 개설할 수 있습니다.');
    return true;
  }
  if(!isBotAccount && !managerRole(role)){
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
module.exports={handle,adapterOf,botMemberType,parseTitle,verifiedCreated,verifiedActive,verifiedInactive,verifiedStopped};
