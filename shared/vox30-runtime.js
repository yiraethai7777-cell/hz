'use strict';

const {botMemberType}=require('./voice-room');
const {voxConnect,checkedAppVersion}=require('./vox30-protocol');

const ENTRY_HOST='211.242.12.121';
const ENTRY_PORT=9282;

function profileFromEnv(env) {
  const fields={
    model:env.NEXI_VOX_MODEL,
    sdkVersion:env.NEXI_VOX_SDK_VERSION,
    buildId:env.NEXI_VOX_BUILD_ID,
    carrierId:env.NEXI_VOX_CARRIER_ID,
  };
  for(const key of Object.keys(fields)){
    if(fields[key]===undefined || fields[key]==='')delete fields[key];
  }
  if(Object.values(fields).some(value=>typeof value!=='string'||!value.trim()||
      value.length>128||/[\x00-\x1f\x7f]/.test(value)))return null;
  if(fields.carrierId!==undefined&&!/^\d{5,6}$/.test(fields.carrierId))return null;
  return {...fields,appVer:checkedAppVersion(env.NEXI_VOX_APP_VERSION||'26.3.1')};
}

function installDirectVoice(client,{env=process.env,
  loadLab=()=>require('../experiments/vox30/lab'),
  log=console}={}) {
  let profile;
  try{profile=profileFromEnv(env);}catch{}
  if(!profile){
    log.info('[VOICE VOX30] creation unavailable: invalid VOX settings');
    return false;
  }
  const auth=client.voiceRoomAuthCandidate;
  if(!auth)return false;
  try{
    const {appVer,...device}=profile;
    const transport=loadLab().createLabAdapter({
      actorUserId:auth.actorUserId,
      cfg:{...device,userId:auth.actorUserId},
      entryHost:ENTRY_HOST,entryPort:ENTRY_PORT,appVer,
      // Opt-in so existing VOX rooms remain unaffected until test results.
      enableSilentAudio:env.NEXI_VOX_TX_SILENCE==='1',
      async connect(options) {
        const entry=options.host===ENTRY_HOST&&options.port===ENTRY_PORT;
        const {isPublicIpv4}=require('../experiments/vox30/synthetic-discovery');
        if(!isPublicIpv4(options.host))throw Error('VOX 서버 주소가 유효하지 않습니다.');
        const observedMethods=new Set();
        const conn=await voxConnect({
          ...options,servername:'kakao.com',
          onPacket(packet) {
            // Forward server events to the owning voice-session adapter.
            options.onPacket?.(packet);
            const {method,status}=packet;
            const key=method+':'+status;
            if(entry||observedMethods.has(key)||observedMethods.size>=16)return;
            observedMethods.add(key);
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
          const safe=/^VOX 보이스룸 생성 (?:응답 )?거절: (?:resCode|reason)=-?\d+$/.test(message)
            ?message:'VOX 생성 요청 또는 응답 처리에 실패했습니다. Railway 로그를 확인해 주세요.';
          log.warn('[VOICE VOX30] '+safe);
          throw Error(safe);
        }
      },
    };
    log.info('[VOICE VOX30] direct create adapter installed; optional device fields: '+Object.keys(device).length+
      '; silent RTP TX: '+(env.NEXI_VOX_TX_SILENCE==='1'?'enabled':'off'));
    return true;
  }catch{
    log.warn('[VOICE VOX30] direct create adapter initialization failed');
    return false;
  }
}

module.exports={installDirectVoice,profileFromEnv};
