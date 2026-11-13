'use strict';

const {botMemberType}=require('./voice-room');
const {voxConnect,checkedAppVersion}=require('./vox30-protocol');
const {createMultiRoomAdapter}=require('./vox30-multiroom');

const ENTRY_HOST='211.242.12.121';
const ENTRY_PORT=9282;

function profileFromEnv(env,sessionAppVersion,sessionCarrier) {
  // Reuse the running KakaoForge session's carrier only when it is well-formed.
  // This is session metadata, not proof of the physical SIM/operator.
  const validSessionCarrier=typeof sessionCarrier==='string' && /^\d{5,6}$/.test(sessionCarrier)
    ?sessionCarrier:undefined;
  const fields={
    model:env.NEXI_VOX_MODEL,
    sdkVersion:env.NEXI_VOX_SDK_VERSION,
    buildId:env.NEXI_VOX_BUILD_ID,
    carrierId:env.NEXI_VOX_CARRIER_ID||validSessionCarrier,
  };
  for(const key of Object.keys(fields)){
    if(fields[key]===undefined || fields[key]==='')delete fields[key];
  }
  if(Object.values(fields).some(value=>typeof value!=='string'||!value.trim()||
      value.length>128||/[\x00-\x1f\x7f]/.test(value)))return null;
  if(fields.carrierId!==undefined&&!/^\d{5,6}$/.test(fields.carrierId))return null;
  // Prefer the already-connected KakaoForge client's app version to the
  // historical VOX lab default. Explicit VOX version settings take precedence.
  const version=env.NEXI_VOX_APP_VERSION||sessionAppVersion||'26.3.1';
  return {...fields,appVer:checkedAppVersion(version)};
}

function installDirectVoice(client,{env=process.env,
  loadLab=()=>require('../experiments/vox30/lab'),
  // Only a manually reviewed, version-matched native VOX wire driver.
  // No driver exists in production and there is no env-only packet override.
  hangupTransport=null,
  log=console}={}) {
  let profile;
  try{profile=profileFromEnv(env,client?.appVer,client?.mccmnc);}catch{}
  if(!profile){
    log.info('[VOICE VOX30] creation unavailable: invalid VOX settings');
    return false;
  }
  const auth=client.voiceRoomAuthCandidate;
  if(!auth)return false;
  try{
    const {appVer,...device}=profile;
    log.info('[VOICE VOX30] app version source: '+
      (env.NEXI_VOX_APP_VERSION?'explicit-vox-env':
        client?.appVer?'current-kakaoforge-session':'laboratory-default'));
    log.info('[VOICE VOX30] carrier source: '+
      (env.NEXI_VOX_CARRIER_ID?'explicit-vox-env':
        device.carrierId?'current-kakaoforge-session':'absent'));
    // One VOX call per account remains the production default.
    // NEXI_VOX_MAX_ACTIVE_ROOMS=2 is an experimental opt-in only:
    // separate TLS/RTC connections do NOT prove server-side multi-call support.
    const maxActiveRooms=env.NEXI_VOX_MAX_ACTIVE_ROOMS==='2'?2:1;
    if(env.NEXI_VOX_MAX_ACTIVE_ROOMS &&
       !['1','2'].includes(env.NEXI_VOX_MAX_ACTIVE_ROOMS))
      log.warn('[VOICE VOX30] unsupported concurrency setting; using one session');
    const makeRoomAdapter=()=>loadLab().createLabAdapter({
      actorUserId:auth.actorUserId,
      cfg:{...device,userId:auth.actorUserId},
      entryHost:ENTRY_HOST,entryPort:ENTRY_PORT,appVer,
      // Opt-in so existing VOX rooms remain unaffected until test results.
      enableSilentAudio:env.NEXI_VOX_TX_SILENCE==='1',
      hangupTransport,
      unsafeStopExperiment:env.NEXI_VOX_UNSAFE_STOP_TEST==='1',
      async connect(options) {
        const entry=options.host===ENTRY_HOST&&options.port===ENTRY_PORT;
        const {isPublicIpv4}=require('../experiments/vox30/synthetic-discovery');
        if(!isPublicIpv4(options.host))throw Error('VOX 서버 주소가 유효하지 않습니다.');
        const observedMethods=new Set();
        const observedRoleStates=new Set();
        const conn=await voxConnect({
          ...options,servername:'kakao.com',
          onPacket(packet) {
            // Forward server events to the owning voice-session adapter.
            options.onPacket?.(packet);
            const {method,status}=packet;
            if(entry)return;
            if(method===12011){
              // Log a role or roster transition when its safe summary changes,
              // not only the first event of this method/status pair.
              const snapshot=JSON.stringify({
                codes:packet.codes,memberEnvelope:packet.memberEnvelope,
                ownMember:packet.ownMember,memberGroups:packet.memberGroups,
                structures:packet.structures,
              });
              if(observedRoleStates.has(snapshot)||observedRoleStates.size>=12)return;
              observedRoleStates.add(snapshot);
            }else{
              const key=method+':'+status;
              if(observedMethods.has(key)||observedMethods.size>=16)return;
              observedMethods.add(key);
            }
            log.info('[VOICE VOX30] call server packet '+JSON.stringify(packet));
          },
        });
        log.info('[VOICE VOX30] '+(entry?'discovery':'call server')+' TLS connected');
        return {
          ...conn,
          async send(method,body,requestNonce) {
            await conn.send(method,body,requestNonce);
            if(method===11028)log.info('[VOICE VOX30] 11028 sent');
            if(method===11003)log.info('[VOICE VOX30] 11003 acknowledgement sent');
          },
        };
      },
      credentialsForRoom:()=>auth.getCredentials(),
      verifyMembership({actorUserId,chatId}) {
        const room=auth.localRoomEvidence({actorUserId,chatId});
        return client.connected===true&&room.isOpenChatInLocalRoster&&room.memberTypeCached;
      },
      userTypeForRoom({chatId}) {
        const role=botMemberType(client,chatId);
        const userType=role===1?3:role===4?2:1;
        // Report role mapping only (no user or chat identifiers).
        log.info('[VOICE VOX30] local room memberType='+String(role??'unknown')+
          ' -> VOX userType='+userType);
        return userType;
      },
    });
    const transport=maxActiveRooms===2?
      createMultiRoomAdapter({createAdapter:makeRoomAdapter,maxRooms:2}):
      makeRoomAdapter();
    client.voiceRoomAdapter={
      ...transport,
      async create(request) {
        log.info('[VOICE VOX30] create requested');
        try{
          const result=await transport.create(request);
          log.info('[VOICE VOX30] create response and SDP received; room activation unverified');
          return result;
        }catch(error){
          const message=String(error?.message||'');
          // Keep user-actionable VOX session errors. A second chat cannot
          // create while the same bot account has an active VOX call.
          // The generic fallback previously hid this explicit adapter guard.
          const safe=/^VOX 보이스룸 생성 (?:응답 )?거절: (?:resCode|reason)=-?\d+$/.test(message)
            ?message:
            message==='VOX 계정에 이미 활성 음성 세션이 있습니다.'?
              '이 봇 계정은 다른 방에서 이미 보이스룸을 유지 중입니다. 같은 계정의 여러 방 동시 통화는 미검증입니다. 기존 보이스룸은 유지했습니다.':
            message==='다른 VOX 생성 요청을 처리 중입니다.'?
              '현재 VOX 보이스룸 생성 요청을 처리 중입니다. 완료된 뒤 다시 시도해 주세요.':
            'VOX 생성 요청 또는 응답 처리에 실패했습니다. Railway 로그를 확인해 주세요.';
          log.warn('[VOICE VOX30] '+safe);
          throw Error(safe);
        }
      },
    };
    log.info('[VOICE VOX30] direct create adapter installed; optional device fields: '+Object.keys(device).length+
      '; silent RTP TX: '+(env.NEXI_VOX_TX_SILENCE==='1'?'enabled':'off')+
      '; VOX local room slots='+maxActiveRooms+(maxActiveRooms>1?' (experimental; server unverified)':'')+
      '; unsafe stop test='+(env.NEXI_VOX_UNSAFE_STOP_TEST==='1'?'enabled':'disabled'));
    return true;
  }catch{
    log.warn('[VOICE VOX30] direct create adapter initialization failed');
    return false;
  }
}

module.exports={installDirectVoice,profileFromEnv};
