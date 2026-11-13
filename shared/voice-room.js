'use strict';

// KakaoTalk VoiceRoom command controller.
// Railway direct VOX only. Never send guessed LOCO packets or use Android/Noa adapters.
// An explicitly installed authenticated direct VOX adapter is required.
const running=new Set();
const MANAGERS=new Set([1,4]);
const MAX_TITLE=40;
const lastTlsDiagnostic=new Map();
const TLS_DIAGNOSTIC_COOLDOWN_MS=10*60*1000;

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
  if(adapter?.kind==='noa-android-experimental')return null;
  return adapter && (typeof adapter.create==='function' || typeof adapter.status==='function' || typeof adapter.stop==='function' || typeof adapter.join==='function' || typeof adapter.leave==='function')?adapter:null;
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
  const match=/^[#!]?(보룸인증점검|보이스룸인증점검|보룸TLS진단|보이스룸TLS진단|보룸참여상태|보룸참여|보룸참가상태|보룸참가|보룸퇴장|보룸스피커받기|보룸진행자받기|보이스룸참여상태|보이스룸참여|보이스룸참가상태|보이스룸참가|보이스룸퇴장|보이스룸스피커받기|보이스룸진행자받기|보룸켜기|보룸시작|보룸끄기|보룸종료시험|보룸종료|보룸상태|보룸감지시작|보룸감지종료|보룸감지|보룸명령어|보이스룸켜기|보이스룸시작|보이스룸끄기|보이스룸종료시험|보이스룸종료|보이스룸상태|보이스룸감지시작|보이스룸감지종료|보이스룸감지|보이스룸명령어)(?=$|\s|[.!。])/.exec(raw);
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
  if(match[1]==='보룸인증점검'||match[1]==='보이스룸인증점검'){
    if(!isBotAccount){
      await safeReply(client,send,'❌ VOX 인증 사전점검은 봇 계정만 사용할 수 있습니다.');
      return true;
    }
    if(typeof client?.voiceRoomAuthPreflight!=='function'){
      await safeReply(client,send,'⚠️ VOX 인증 사전점검 모듈이 연결되지 않았습니다.');
      return true;
    }
    try{
      const state=client.voiceRoomAuthPreflight({chatId:room});
      // Only explicit flags, never the OAuth token, UUID, ID or metadata values.
      const line=ok=>ok?'확인':'미확인';
      await safeReply(client,send,
        '🎙️ Railway | VOX 인증 사전점검\n━━━━━━━━━━━━━━\n'+
        '카카오톡 세션: '+line(state.sessionConnected)+'\n'+
        '기존 OAuth·기기 정보: '+line(state.kakaoCredentialsPresent)+'\n'+
        '오픈채팅방 정보: '+line(state.openChatCached)+'\n'+
        '봇 멤버 정보: '+line(state.botMemberCached)+'\n'+
        '봇 관리자 권한 캐시: '+line(state.botModeratorCached)+'\n'+
        '카카오톡 앱 버전: '+line(state.appVersionPresent)+
          (state.appVersionMayBeDefault?' (KakaoForge 기본값 가능)':' (VOX 미검증)')+'\n'+
        '통신사 코드: '+line(state.carrierPresent)+
          (state.carrierMayBeDefault?' (KakaoForge 기본값 가능)':' (VOX 미검증)')+'\n'+
        'VOX 모델·SDK·빌드 출처: '+(state.voxModelFromSession&&
          state.voxSdkVersionFromSession&&state.voxBuildIdFromSession?'확인':'실제 세션에서 미제공')+'\n'+
        '검증된 VOX 기기 프로필: '+line(state.deviceProfileVerified)+'\n'+
        'VOX 서버 OAuth 인증: 미검증\n'+
        '보이스룸 생성 메서드·WebRTC: 미검증\n'+
        (state.creationEnabled?'생성 요청 경로: 연결됨 (실서버 미검증)':'실제 생성: 비활성화')+'\n'+
        '※ OAuth 토큰은 전송하거나 출력하지 않았습니다.');
    }catch{
      await safeReply(client,send,'⚠️ VOX 인증 준비 정보를 확인하지 못했습니다. 실제 생성 요청은 보내지 않았습니다.');
    }
    return true;
  }
  if(match[1]==='보룸TLS진단'||match[1]==='보이스룸TLS진단'){
    if(!isBotAccount){
      await safeReply(client,send,'❌ TLS 연결 진단은 봇 계정만 실행할 수 있습니다.');
      return true;
    }
    const previous=lastTlsDiagnostic.get(room)||0;
    const now=Date.now();
    if(previous && now-previous<TLS_DIAGNOSTIC_COOLDOWN_MS){
      await safeReply(client,send,'⏳ TLS 연결 진단은 방마다 10분에 한 번만 실행할 수 있습니다.');
      return true;
    }
    if(typeof client?.voiceRoomTlsProbe!=='function'){
      await safeReply(client,send,'⚠️ Railway TLS 진단 모듈이 설치되지 않았습니다.');
      return true;
    }
    lastTlsDiagnostic.set(room,now);
    const show=item=>item?.certificateVerified===true
      ? String(item.tlsVersion||'TLS 인증됨')+' · 인증서 확인'
      : '검증 실패 ('+String(item?.status||'unknown').slice(0,48)+')';
    try{
      const report=await client.voiceRoomTlsProbe();
      await safeReply(client,send,'🎙️ Railway | VOX 접속 후보 TLS 진단\n━━━━━━━━━━━━━━\n'+
        '후보 TCP 9282: '+show(report?.entry)+'\n'+
        '후보 TCP 995: '+show(report?.observed)+'\n'+
        'VOX 서버 인증: 미검증\n보이스룸 생성: 미실행\n'+
        '※ 인증 토큰·VOX 패킷은 보내지 않았습니다. TLS 성공은 실제 VOX 연결 성공이 아닙니다.');
    }catch{
      await safeReply(client,send,'⚠️ Railway TLS 연결 진단에 실패했습니다. 서버 인증은 미검증 상태입니다.');
    }
    return true;
  }
  const transport=adapter===undefined?adapterOf(client):adapter;
  const role=botMemberType(client,room);
  const isStatus=match[1].endsWith('상태');
  const isStop=match[1].endsWith('끄기') || match[1].endsWith('종료');
  const isUnsafeStopTest=match[1].endsWith('종료시험');
  const isHelp=match[1].endsWith('명령어');
  const isAcceptRole=match[1].endsWith('스피커받기')||
    match[1].endsWith('진행자받기');
  const acceptedRole=match[1].endsWith('진행자받기')?'moderator':'speaker';
  const isJoinStatus=match[1].endsWith('참가상태')||match[1].endsWith('참여상태');
  const isJoin=match[1].endsWith('참가')||match[1].endsWith('참여');
  const isLeave=match[1].endsWith('퇴장');
  if(isAcceptRole){
    if(!isBotAccount){
      await safeReply(client,send,'❌ 스피커·진행자 권한 수락은 봇 계정만 실행할 수 있습니다.');
      return true;
    }
    if(!transport || typeof transport.status!=='function' ||
       typeof transport.acceptRole!=='function'){
      await safeReply(client,send,'⚠️ VOX 역할 수락 모듈이 연결되지 않았습니다.');
      return true;
    }
    if(running.has(room)){
      await safeReply(client,send,'⏳ 보이스룸 요청을 처리 중입니다.');
      return true;
    }
    running.add(room);
    try{
      const state=await transport.status({roomId:room});
      const roleText=acceptedRole==='moderator'?'진행자':'스피커';
      if(state?.localActive!==true){
        await safeReply(client,send,'⚠️ 이 방에 봇의 VOX 참가 세션이 없습니다. 먼저 #보룸참가를 실행해 주세요.');
      }else if(state.roleSource==='vox-12011-own-roster' &&
          (state.role===acceptedRole||state.role==='moderator')){
        await safeReply(client,send,'✅ VOX 서버 명단에서 이미 '+roleText+
          ' 권한을 확인했습니다.');
      }else if(!state.invitedRoles?.includes(acceptedRole)){
        await safeReply(client,send,'⚠️ 봇 계정을 대상으로 한 인증된 '+roleText+
          ' 초대가 아직 수신되지 않았습니다. 서버 초대가 도착해야 수락할 수 있습니다.');
      }else{
        const result=await transport.acceptRole({roomId:room,role:acceptedRole});
        if(result?.awaitingRoster){
          await safeReply(client,send,'📨 '+roleText+
            ' 초대 수락 요청을 전송했습니다. VOX 서버 역할 명단 반영을 확인해야 합니다.');
        }else if(result?.reason==='protocol-unverified'){
          await safeReply(client,send,'⚠️ '+roleText+' 초대 이벤트는 확인했지만, '+
            '실제 수락 패킷 규격이 아직 검증되지 않아 서버로 요청하지 않았습니다.');
        }else{
          await safeReply(client,send,'⚠️ '+roleText+' 권한 수락을 확인하지 못했습니다.');
        }
      }
    }catch{
      await safeReply(client,send,'❌ VOX 역할 수락 처리에 실패했습니다.');
    }finally{running.delete(room);}
    return true;
  }
  if(isJoinStatus){
    if(!transport || typeof transport.status!=='function'){
      const signal=require('./voice-room-join-info').status(room);
      const signalText=signal.endpointReady
        ? '최근 보룸 초대의 접속정보 수신 확인'
        : signal.phase==='ended'?'마지막 수신 신호: 보룸 종료'
          : signal.phase==='invite'?'최근 보룸 초대 수신 (접속정보 불완전)'
            :'최근 VOX 접속정보 없음';
      await safeReply(client,send,'🎙️ 카카오톡 관리 매니저 | 보룸 참가 상태\n'+
        signalText+'\n'+
        'Railway 전용 VOX 인증·음성 세션 미구현 → 실제 참가 불가\n'+
        'Railway 직접 VOX 세션이 연결되지 않았습니다.\n'+
        '※ 접속정보 수신은 참가나 진행자 권한의 증거가 아닙니다.');
      return true;
    }
    try{
      const state=await transport.status({roomId:room,botUserId:botId});
      const line=state?.localActive===true
        ? 'Railway 직접 VOX에서 이 방의 음성 세션 감지 (카카오톡 서버 참가 미확정)'
        : state?.localBusyOtherRoom===true
          ? 'Railway VOX 클라이언트가 다른 방의 음성 세션을 사용 중'
          : state?.statusKnown===true
            ? '이 방의 VOX 참가 세션 확인 안 됨'
            : 'VOX 참가 상태 확인 불가';
      const verifiedRole=state?.roleSource==='vox-12011-own-roster'&&
        ['listener','speaker','moderator'].includes(state?.role);
      const roleLine=verifiedRole
        ? '\nVOX 서버 명단에서 감지된 역할: '+require('./vox30-role-state').roleLabel(state.role)
        : '\nVOX 서버에서 확인된 역할: 미확인';
      const invite=require('./voice-room-join-info').status(room);
      const invitedRoles=(state?.invitedRoles||[]).filter(x=>
        x==='speaker'||x==='moderator');
      const invitationLine='\n봇 계정 대상 초대: '+
        (invitedRoles.length?
          invitedRoles.map(x=>x==='speaker'?'스피커':'진행자').join(', '):'대기 중');
      const roleTransportLine='\n자동 스피커 권한 수락: '+
        (state?.speakerAutoAcceptAvailable===true?'검증된 어댑터 연결':'규격 검증 전')+
        '\n자동 진행자 권한 수락: '+
        (state?.moderatorAutoAcceptAvailable===true?'검증된 어댑터 연결':'규격 검증 전');
      const trialLine='\nVOX 11002 기존 보룸 참가 실험: '+
        (state?.joinTrialAvailable===true?'연결됨 (서버 검증 전)':'비활성화');
      const inviteLine='\n최근 참가용 초대 접속정보: '+
        (invite.endpointReady?'확보 (인증 규격 미검증)':invite.phase==='ended'?'종료 이벤트 확인':'미확인');
      await safeReply(client,send,'🎙️ 카카오톡 관리 매니저 | 보룸 참가 상태\n'+line+
        roleLine+inviteLine+trialLine+invitationLine+roleTransportLine+
        '\n※ 서버 명단 관찰은 참가 요청 성공·역할 수락을 의미하지 않습니다.');
    }catch{
      await safeReply(client,send,'⚠️ Railway 직접 VOX 참가 상태 조회 실패\n'+
        'VOX 인증 계정과 대상 채팅방 상태를 확인해 주세요.');
    }
    return true;
  }
  if(isJoin || isLeave){
    const operation=isJoin?'참가':'퇴장';
    if(!transport || typeof transport[isJoin?'join':'leave']!=='function' ||
       typeof transport.status!=='function'){
      const signal=require('./voice-room-join-info').status(room);
      const detail=signal.endpointReady
        ? '현재 초대에서 보룸 접속정보는 확보했지만, VOX 인증·세션 연결 구현이 없어 참가할 수 없습니다.'
        : '유효한 보룸 접속정보 및 인증된 VOX 클라이언트가 없습니다.';
      await safeReply(client,send,'⚠️ 보이스룸 '+operation+' 실행 불가\n'+
        detail+'\n'+
        'Railway 직접 VOX 인증 및 음성 세션이 아직 연결되지 않았습니다.\n'+
        (isJoin?'11002(LOGIN) 참가 요청의 인증 필드가 검증되지 않아 임의 패킷을 보내지 않습니다.\n':'')+
        '기존 Railway 카카오톡 로그인은 변경하지 않았습니다.');
      return true;
    }
    if(client?.connected===false)return true;
    if(running.has(room)){
      await safeReply(client,send,'⏳ 이 방의 보이스룸 요청을 이미 처리하고 있습니다.');
      return true;
    }
    running.add(room);
    try{
      const state=await transport.status({roomId:room,botUserId:botId});
      if(isJoin && state?.joinAvailable===false){
        const invite=require('./voice-room-join-info').status(room);
        await safeReply(client,send,'⚠️ 보이스룸 자동 참가를 실행할 수 없습니다.\n'+
          '초대 접속정보: '+(invite.endpointReady?'감지됨':'미확인')+'\n'+
          'VOX 참가 LOGIN(11002) 인증 패킷의 검증된 본문이 없어 서버에 임의 요청을 보내지 않았습니다.\n'+
          '스피커·진행자 자동 수락도 현재는 지원되지 않습니다.');
        return true;
      }
      if(state?.statusKnown!==true && (!isJoin || state?.joinAvailable!==true)){
        await safeReply(client,send,'⚠️ Railway VOX 상태를 확인할 수 없어 '+operation+' 요청을 보내지 않았습니다.');
        return true;
      }
      if(isJoin){
        let metaInvite=null;
        // The bot may not have witnessed vr_invite (restart, earlier room),
        // so try a bounded read-only SYNCMSG lookup once, without emitting old
        // messages as commands. No endpoint means no guessed 11002 packet.
        if(state.joinTrialAvailable===true &&
           !require('./voice-room-join-info').status(room).endpointReady){
          const recovery=await require('./voice-room-join-info').recover(
            client,room,Date.now(),{
              maxLogId:msg?.message?.logId??msg?.raw?.chatLog?.logId??msg?.logId,
            });
          if(!require('./voice-room-join-info').status(room).endpointReady){
            // CHATINFO can carry VoiceRoom metadata even when the initiating
            // type-52 chat log was not sent to the bot.
            const meta=await require('./voice-room-join-info')
              .inspectServerVoiceMeta(client,room);
            if(meta.ready)metaInvite=meta.invitation;
            else console.info('[VOICE JOIN] no usable LOCO metadata; authenticated discovery fallback remains available; meta='+meta.reason);
          }
        }
        if(state.localActive===true){
          await safeReply(client,send,'🎙️ 이 방의 VOX 보이스룸 참가 세션이 이미 감지됩니다.\n'+
            '※ 실제 참가자 명단·진행자 권한은 별도로 확인해야 합니다.');
          return true;
        }
        if(state.localBusyOtherRoom===true){
          await safeReply(client,send,'⚠️ Railway VOX 클라이언트가 다른 방에서 보이스룸 세션을 사용하고 있습니다.\n'+
            '기존 세션을 보호하기 위해 자동 전환하지 않습니다.');
          return true;
        }
        const joined=await transport.join({roomId:room,botUserId:botId,
          ...(metaInvite?{invitation:metaInvite}:{})});
        if(joined?.requestAccepted===true){
          await safeReply(client,send,
            (state.joinTrialAvailable===true
              ?'🧪 VOX 11002 참가 실험에서 서버 응답과 WebRTC SDP 적용을 확인했습니다.\n'
              :'📨 보이스룸 참가 요청을 Railway 직접 VOX 클라이언트에 전달했습니다.\n')+
            '※ 실제 참가 여부는 카카오톡의 참가자 목록에서 확인해야 합니다.\n'+
            '※ 스피커·진행자 권한은 VOX 서버 명단으로 별도 확인합니다.');
        }else{
          const why=joined?.source==='authenticated-discovery'
            ?joined.reason==='missing-call-id'
              ?'VOX 서버 조회는 성공했지만 현재 보이스룸의 통화 ID를 반환하지 않았습니다.'
              :joined.reason==='not-callable'
                ?'VOX 서버에서 이 방의 통화 서버 연결을 허용하지 않았습니다.'
                :joined.reason==='room-mismatch'
                  ?'VOX 서버의 응답이 현재 채팅방과 일치하지 않습니다.'
                  :joined.reason==='server-rejected'
                    ?'VOX 서버가 통화 정보 조회를 거절했습니다.'
                    :'VOX 서버 조회에서 참가에 필요한 통화 정보를 확인하지 못했습니다.'
            :joined?.reason==='missing-invitation'
              ?'기존 보룸의 초대 접속정보가 확인되지 않았습니다.'
              :'보이스룸 참가 요청이 접수됐는지 확인하지 못했습니다.';
          await safeReply(client,send,'⚠️ '+why+'\n'+
            '채팅 기록에서 현재 보룸의 초대 정보를 확보하지 못한 상태입니다.\n'+
            '※ 추정한 통화 ID로 VOX 참가 패킷을 전송하지 않았습니다.');
        }
      }else{
        if(state.localActive!==true){
          await safeReply(client,send,'⚠️ 이 방에 참가 중인 Railway VOX 음성 세션이 확인되지 않아 퇴장 요청을 보내지 않았습니다.');
          return true;
        }
        const left=await transport.leave({roomId:room,botUserId:botId});
        await safeReply(client,send,left?.requestAccepted===true
          ? '📨 Railway VOX 음성 세션 퇴장 요청을 전달했습니다.\n'+
            '※ 실제 퇴장 여부는 앱에서 확인해 주세요. 보룸 전체 종료 명령은 아닙니다.'
          : '⚠️ 보이스룸 퇴장 요청이 접수됐는지 확인하지 못했습니다.');
      }
    }catch(error){
      const cause=String(error?.message||'');
      // Do not print VOX endpoints, account IDs, SDP or session secrets.
      const safe=/^VOX 참가 (?:응답 거절: resCode=-?\d+|서버 거절: reason=-?\d+)$/.test(cause)
        ?cause: /초대 서버와 인증된 검색 결과가 일치하지 않습니다/.test(cause)
        ?'VOX 초대 서버가 인증된 검색 결과와 일치하지 않습니다.'
        : /원격 WebRTC SDP/.test(cause)?'VOX 서버 응답에 필요한 WebRTC SDP가 없습니다.'
        : /서버 resCode/.test(cause)?'VOX 서버에서 로그인 성공 코드가 확인되지 않았습니다.'
        : 'Railway VOX 인증과 대상 채팅방 연결을 확인해 주세요.';
      console.warn('[VOICE VOX30] join operation failed: '+safe);
      await safeReply(client,send,'❌ 보이스룸 '+operation+' 요청 실패\n'+safe);
    }finally{
      running.delete(room);
    }
    return true;
  }
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
        const state=require('./voice-room-auto-detect').last(room);
        if(state){
          await safeReply(client,send,'🎙️ 마지막 자동 감지 기록\n━━━━━━━━━━━━━━\n'+
            state.phase+
            (state.eventType==='vr_bye'&&state.durationSeconds!==undefined
              ? '\n진행 시간: '+state.durationSeconds+'초':'')+
            '\n※ 관리 ON 상태에서 수신한 이벤트 기록이며 실시간 서버 상태 조회는 아닙니다.');
        }else{
          await safeReply(client,send,'🔎 아직 수신한 자동 감지 기록이 없습니다.\n'+
            '관리가 ON인 방은 보이스룸 개설·종료 시 자동으로 알립니다.\n'+
            '수동 진단이 필요하면 #보룸감지시작을 입력해 주세요.');
        }
      }else if(!result.events.length){
        await safeReply(client,send,'🔎 보이스룸 감지 결과\n━━━━━━━━━━━━━━\n'+
          '관찰된 관련 이벤트: 0건\n남은 시간: '+result.remainingSeconds+'초\n'+
          '판정: 확인 불가\n※ 이벤트가 없어도 보룸이 열리지 않았다는 의미는 아닙니다.');
      }else{
        const detail=result.events.map((e,index)=>e.source==='message'?
          (index+1)+'번째: 채팅 유형 '+e.type+
          (e.phaseHint?' · '+e.phaseHint:'')+
          (e.durationSeconds!==undefined?' · 지속시간 '+e.durationSeconds+'초':'')+
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
    await safeReply(client,send,'🎙️ 카카오톡 관리 매니저 | 보이스룸 명령어\n' +
      '#보룸시작 (제목) / #보룸켜기 (제목) · Railway 직접 VOX 생성 (인증 연동 후)\n' +
      '#보룸상태 · 서버 상태/연동 및 마지막 자동 감지\n' +
      '#보룸TLS진단 · Railway에서 인증정보 없이 TLS 후보 연결 확인 (봇 계정만)\n' +
      '#보룸인증점검 · 기존 세션·기기 정보 확인, VOX 서버 인증 미실행 (봇 계정만)\n' +
      '!보룸참여 / #보룸참가 · 기존 보룸 참가 (11002 실험/인증 검증 필요)\n' +
      '#보룸스피커받기 / #보룸진행자받기 · 봇 계정 초대 수락 (패킷 미검증)\n' +
      '!보룸참여상태 · VOX 세션 및 서버 명단 역할 관찰\n' +
      '※ 스피커·진행자 자동 수락은 응답 규격 검증 후 지원\n' +
      '#보룸참가상태 · Railway VOX 참가 세션 확인\n' +
      '#보룸퇴장 · Railway VOX 음성 세션에서 나가기 (보룸 종료 아님)\n' +
      '※ 관리 ON인 방은 보이스룸 개설·종료 이벤트를 자동 감지해 알립니다.\n' +
      '#보룸감지시작 · 3분간 수신 이벤트 관찰\n' +
      '#보룸감지 · 관찰된 신호 후보 확인\n' +
      '#보룸감지종료 · 관찰 중단\n' +
      '#보룸종료 / #보룸끄기 · 서버 정상 종료 구현 미검증 (진행자 세션 보호)\n' +
      '#보룸종료시험 11009 / #보룸종료시험 연결해제 · 비검증 종료 실험 (방장·부방장 또는 봇 계정만)\n' +
      '※ 실제 서버 API가 연결된 경우에만 생성·종료합니다.\n' +
      '※ 방장·부방장 및 봇 계정이 사용 가능합니다.\n' +
      '※ 봇 계정은 명령어를 직접 사용할 수 있지만 실제 생성·종료는 카카오톡 서버 권한 및 API 지원에 따릅니다.');
    return true;
  }
  if(isStatus){
    const roleText=role==null || role===0?'확인 불가':managerRole(role)?'방장/부방장':'일반 멤버';
    let capability=transport?'연동 모듈 설치됨 (실제 서버 개설 여부 미확인)':
      'Railway 직접 VOX 인증 미연결 (생성 불가)';
    if(transport && typeof transport.status==='function'){
      try{
        const state=await transport.status({roomId:room});
        if(verifiedActive(state,room))
          capability='✅ 서버에서 개설 상태 확인'+(state.voiceRoomId?' · ID: '+String(state.voiceRoomId):'');
        else if(verifiedInactive(state,room))
          capability='✅ 서버에서 비활성 상태 확인';
        else if(state?.localBusyOtherRoom===true)
          capability='다른 방에서 Railway VOX 세션 유지 중 · 이 계정의 동시 개설 미검증';
        else if(state?.localSession===true)
          capability=state.localActive?
            'Railway 직접 VOX에서 이 방의 보룸 세션 표시 (서버 상태 미검증)':
            'Railway 직접 VOX에서 이 방의 보룸 세션 확인 안 됨 (서버 상태 미검증)';
        else
          capability='모듈 연결됨 · 현재 보이스룸 개설 여부 미확인';
      }catch(e){
        console.warn('[보이스룸] 상태 조회 실패:',String(e?.message||e));
        capability='모듈 연결됨 · 상태 조회 실패';
      }
    }
    const auth=client?.voiceRoomAuthCandidate?.diagnostics?.({chatId:room});
    const authLine=auth
      ? '\n기존 카카오톡 인증 정보: '+(auth.hasKakaoCredentials?'메모리에서 확인':'확인 불가')+
        '\n대상 오픈채팅방 캐시: '+(auth.kakaoRoomCached?'확인':'확인 불가')+
        '\nVOX 서버 인증: 미검증'
      : '\nVOX 서버 인증: 미연결';
    const observed=require('./voice-room-auto-detect').last(room);
    const observedText=observed
      ? observed.phase+(observed.durationSeconds!==undefined&&observed.eventType==='vr_bye'
        ? ' · '+observed.durationSeconds+'초' : '')+' (실시간 서버 검증 아님)'
      : '기록 없음 (재시작 시 초기화)';
    await safeReply(client,send,'🎙️ 보이스룸 상태\n━━━━━━━━━━━━━━\n봇 권한: '+roleText+
      '\n개설 연동: '+capability+authLine+
      '\n마지막 자동 감지: '+observedText+
      '\n※ 수신 이벤트 기록은 실제 보이스룸 활성 상태 조회가 아닙니다.');
    return true;
  }

  if(isUnsafeStopTest){
    // Deliberately separate from #보룸종료: never change verified stop flow.
    // Elevated sender + elevated bot, same chat, explicit mode required.
    if(!isBotAccount&&!managerRole(msg?.sender?.type)){
      await safeReply(client,send,'❌ 종료 실험은 방장·부방장 또는 봇 계정만 실행할 수 있습니다.');
      return true;
    }
    if(!isBotAccount&&!managerRole(role)){
      await safeReply(client,send,'❌ 봇 계정에 방장·부방장 권한이 없어 종료 실험을 실행하지 않습니다.');
      return true;
    }
    const argument=raw.slice(match[0].length).trim();
    const mode=argument==='11009'?'11009':
      argument==='연결해제'?'disconnect':null;
    if(!mode){
      await safeReply(client,send,'⚠️ 정확한 실험 명령어를 입력해 주세요.\n'+
        '#보룸종료시험 11009 · 검증되지 않은 패킷을 1회 송신\n'+
        '#보룸종료시험 연결해제 · 이 방의 Railway VOX 세션만 해제\n'+
        '※ 두 방식 모두 카카오톡 서버 보룸 종료를 보장하지 않습니다.');
      return true;
    }
    if(!transport||typeof transport.experimentalStop!=='function'||
        typeof transport.status!=='function'){
      await safeReply(client,send,'❌ Railway VOX 종료 실험 모듈이 연결되지 않았습니다.');
      return true;
    }
    if(running.has(room)){
      await safeReply(client,send,'⏳ 이미 이 방의 보이스룸 요청을 처리하고 있습니다.');
      return true;
    }
    running.add(room);
    let endWatch=null;
    try{
      const before=await transport.status({roomId:room});
      if(before?.localSession!==true||before?.localActive!==true||
          String(before.roomId)!==room){
        await safeReply(client,send,'❌ 이 방에서 봇이 직접 유지하는 활성 VOX 연결이 없습니다.\n'+
          '이미 끊어진 세션이나 다른 방의 보이스룸에는 실험을 실행할 수 없습니다.');
        return true;
      }
      if(before.unsafeStopExperimentAvailable!==true){
        await safeReply(client,send,'❌ Railway 종료 실험이 비활성화되어 있습니다. '+
          'NEXI_VOX_UNSAFE_STOP_TEST=1 설정이 필요합니다.');
        return true;
      }
      if(before.localCallId){
        endWatch=require('./voice-room-auto-detect')
          .watchEnd(client,room,before.localCallId);
      }
      const result=await transport.experimentalStop({roomId:room,mode});
      if(result?.disabled||result?.noLocalSession){
        await safeReply(client,send,'⚠️ 활성 VOX 연결이 없어 실험 요청을 수행하지 않았습니다.');
        return true;
      }
      if(result?.alreadyTried){
        await safeReply(client,send,'⚠️ 이 보이스룸에는 이미 11009 패킷을 시험했습니다. '+
          '동일 통화에 다시 전송하지 않았습니다.');
        return true;
      }
      const happened=(result?.packetSent===true||result?.localReleased===true);
      const ended=happened&&endWatch?await endWatch.wait():false;
      if(ended){
        await safeReply(client,send,'🎙️ 실험 이후 같은 통화 ID의 서버 vr_bye 종료 이벤트를 확인했습니다.\n'+
          '※ 사용한 실험 방식이 종료 원인인지는 별도 검증이 필요합니다.');
      }else if(result?.packetSent===true){
        await safeReply(client,send,'🧪 VOX 11009 패킷을 1회 송신했습니다.\n'+
          '서버 종료 이벤트(vr_bye)는 확인되지 않았습니다.\n'+
          '※ 패킷 규격은 미검증이며 보이스룸이 그대로 열려 있을 수 있습니다.');
      }else if(result?.localReleased===true){
        await safeReply(client,send,'🧪 이 방의 Railway VOX 연결만 강제로 해제했습니다.\n'+
          '카카오톡 봇 로그인은 유지됩니다.\n'+
          '서버 종료 이벤트(vr_bye)는 확인되지 않았습니다. 실제 보룸은 남아 있을 수 있습니다.');
      }else{
        await safeReply(client,send,'❌ 종료 실험 요청이 송신되지 않았습니다. '+
          '기존 VOX 세션 상태를 확인해 주세요.');
      }
    }catch(error){
      console.error('[VOICE VOX30] stop experiment failure:',
        String(error?.message||error).slice(0,160));
      await safeReply(client,send,'❌ VOX 종료 실험 처리에 실패했습니다. 서버 종료 여부는 미확인입니다.');
    }finally{
      endWatch?.close();
      running.delete(room);
    }
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
      const ownSession=before?.localSession===true &&
        before?.localActive===true && String(before?.roomId??'')===room;
      // A VOX TLS disconnect is NOT the native hangUp packet. Fail closed
      // and retain the live moderator so the server room is not orphaned.
      if(before?.localSession===true&&before.stopAvailable===false){
        await safeReply(client,send,ownSession?
          '❌ Railway VOX 서버 종료 패킷(hangUp)의 규격이 아직 검증되지 않았습니다.\n'+
          '봇 진행자 연결은 유지했습니다. 현재 명령으로 보이스룸 전체를 종료할 수 없습니다.\n'+
          '카카오톡에서 진행자가 직접 퇴장하여 종료해 주세요.':
          '❌ Railway VOX 진행자 연결이 없어 이전에 생성한 보이스룸을 종료할 수 없습니다.\n'+
          '서버 종료 패킷도 아직 미구현입니다. 카카오톡에서 직접 종료해 주세요.');
        return true;
      }
      if(!verifiedActive(before,room)&&!ownSession){
        await safeReply(client,send,'⚠️ 서버에서 활성 보이스룸을 확인하지 못해 종료 요청을 보내지 않았습니다.');
        return true;
      }
      // Never send a termination request unless its same-call closure
      // event can be observed. The watcher must precede the wire request.
      const endWatch=ownSession&&before.localCallId?
        require('./voice-room-auto-detect').watchEnd(client,room,before.localCallId):null;
      if(ownSession&&!endWatch){
        await safeReply(client,send,'⚠️ 보이스룸 종료 이벤트 감지기가 준비되지 않았습니다.\n'+
          '실제 서버 종료 여부를 검증할 수 없어 종료 요청을 보내지 않았습니다.');
        return true;
      }
      try{
        const response=await transport.stop({
          roomId:room,voiceRoomId:before.voiceRoomId??null
        });
        const localReleased=response?.localReleased===true &&
          String(response?.roomId??'')===room;
        let confirmed=ownSession?false:verifiedStopped(response,room);
        // The driver only confirms request acceptance, not server closure.
        if(ownSession&&response?.requestAccepted===true&&endWatch)
          confirmed=await endWatch.wait();
        if(!confirmed&&!localReleased&&!ownSession){
          const after=await transport.status({roomId:room});
          confirmed=verifiedInactive(after,room);
        }
        const message=confirmed?
          '🎙️ 보이스룸 종료가 서버에서 확인되었습니다.':
          response?.serverStopUnavailable===true?
            '❌ 실제 VOX 보이스룸 종료 패킷이 미구현입니다. 봇 연결은 유지했습니다.':
          ownSession&&response?.requestAccepted===true?
            '⚠️ VOX 종료 요청은 전달됐지만 동일 보이스룸의 서버 종료 이벤트(vr_bye)는 확인되지 않았습니다.\n'+
            '보이스룸이 계속 열려 있을 수 있으니 #보룸상태와 카카오톡 화면을 확인해 주세요.':
          localReleased?
            '⚠️ Railway VOX 연결만 해제됐습니다. 서버 보이스룸은 종료되지 않았을 수 있습니다.':
            '⚠️ 보이스룸 종료 결과를 검증하지 못했습니다. 실제 상태를 확인해 주세요.';
        await safeReply(client,send,message);
      }finally{
        endWatch?.close();
      }
    }catch(err){
      console.error('[보이스룸] 종료 요청 실패:',String(err?.message||err));
      await safeReply(client,send,'❌ 보이스룸 종료 요청에 실패했습니다.');
    }finally{
      running.delete(room);
    }
    return true;
  }
  if(!transport || typeof transport.create!=='function'){
    await safeReply(client,send,'⚠️ Railway 직접 VOX 보이스룸 생성 기능은 인증 연동 전입니다.\n'+
      '기존 Android/Noa 생성 방식은 제거했습니다.\n'+
      'VOX 인증 및 채팅방 참여 확인 전에는 생성 요청을 보내지 않습니다.'+
      (client?.voiceRoomAuthCandidate?.diagnostics?.({chatId:room})?.hasKakaoCredentials
        ? '\n기존 카카오톡 OAuth 후보는 감지됐지만 VOX 서버 승인은 아직 확인되지 않았습니다.'
        : '\n기존 카카오톡 인증 후보도 확인되지 않았습니다.'));
    return true;
  }
  if(!isBotAccount && !managerRole(role)){
    await safeReply(client,send,role==null || role===0?
      '❌ 이 방에서 봇 계정의 방장/부방장 권한을 확인할 수 없습니다. 안전을 위해 생성 요청을 보내지 않습니다.':
      '❌ 보이스룸을 생성하려면 봇 계정에도 방장 또는 부방장 권한이 필요합니다.');
    return true;
  }
  if(client?.connected===false)return true;
  // Preserve the already-running VOX creator session and report the actual
  // cause before calling the adapter's create() (which is single-session).
  if(typeof transport.status==='function'){
    try{
      const session=await transport.status({roomId:room});
      if(session?.localSession===true && session?.localActive===true){
        await safeReply(client,send,'⚠️ 이 방에서 Railway VOX 보이스룸을 이미 유지 중입니다.\n'+
          '중복 생성 요청을 보내지 않았습니다.');
        return true;
      }
      if(session?.localBusyOtherRoom===true){
        await safeReply(client,send,'❌ 다른 채팅방에서 이미 보이스룸을 유지 중입니다.\n'+
          '현재 Railway VOX는 봇 계정당 활성 세션 1개로 제한되어 있습니다.\n'+
          '다른 방 동시 개설은 서버 지원 여부가 아직 검증되지 않았으며, 기존 보이스룸 연결은 유지했습니다.');
        return true;
      }
    }catch(error){
      console.warn('[VOICE VOX30] pre-create local state unavailable');
      // The adapter still refuses duplicate sessions before network activity.
    }
  }
  let title;
  try{title=parseTitle(raw.slice(match[0].length));}
  catch(err){await safeReply(client,send,'❌ '+String(err.message||err));return true;}
  if(running.has(room)){
    await safeReply(client,send,'⏳ 이미 이 방의 보이스룸 개설 요청을 처리하고 있습니다.');
    return true;
  }
  running.add(room);
  const openEvent=require('./voice-room-auto-detect').watchOpen(client,room);
  try{
    const response=await transport.create({
      roomId:room,
      title,
      botUserId:botId,
      openLinkId:msg?.room?.openLinkId == null?null:String(msg.room.openLinkId)
    });
    let confirmed=verifiedCreated(response);
    if(!confirmed && response?.requestAccepted!==true && typeof transport.status==='function'){
      const state=await transport.status({roomId:room});
      confirmed=verifiedActive(state,room);
    }
    const matchedInvite=!confirmed && response?.requestAccepted===true &&
      openEvent ? await openEvent.wait(response.callId) : false;
    if(confirmed || matchedInvite){
      if(matchedInvite)console.info('[VOICE VOX30] matching LOCO vr_invite observed (call ID withheld)');
      await safeReply(client,send,'보룸을 시작했습니다');
    }else if(response?.requestAccepted===true){
      console.info('[VOICE VOX30] VOX create accepted but matching LOCO invite unconfirmed');
      await safeReply(client,send,'⚠️ VOX 서버가 생성 요청을 수락했지만 카카오톡 개설 이벤트를 검증하지 못했습니다.\n'+
        '보이스룸의 정상 유지 여부는 아직 확인되지 않았습니다.');
    }else if(response?.requestAccepted!==true){
      await safeReply(client,send,'⚠️ 보이스룸 생성 요청 결과를 검증하지 못했습니다.\n'+
        '실제 카카오톡 화면에서 상태를 확인한 뒤 재시도해 주세요.');
    }
  }catch(err){
    console.error('[보이스룸] 생성 요청 실패:',String(err?.message||err));
    await safeReply(client,send,'❌ 보이스룸 생성 실패: '+String(err?.message||err));
  }finally{
    openEvent?.close();
    running.delete(room);
  }
  return true;
}
module.exports={handle,adapterOf,botMemberType,parseTitle,verifiedCreated,verifiedActive,verifiedInactive,verifiedStopped};
