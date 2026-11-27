'use strict';

const { isIPv4 } = require('node:net');
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

const isPublicIpv4=host=>{
  if (!isIPv4(host)) return false;
  const octets=host.split('.').map(Number);
  if(octets.length!==4||octets.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
  const [a,b,c]=octets;
  return !(a===0||a===10||a===127||a>=224||
    (a===100&&b>=64&&b<=127)||(a===169&&b===254)||
    (a===172&&b>=16&&b<=31)||(a===192&&b===168)||
    (a===192&&b===0)||(a===198&&(b===18||b===19))||
    (a===192&&b===0&&c===2)||(a===198&&b===51&&c===100)||
    (a===203&&b===0&&c===113));
};

function createDukeVoiceAdapter(client, env = process.env) {
  const profile = profileFromEnv(env, client.appVer, client.mccmnc);
  if (!profile) throw new Error('Invalid VOX profile');
  const { appVer, ...device } = profile;
  const auth = require('./vox30-existing-auth').createVoxCandidateProvider(client, {
    expectedActorUserId: client.userId,
  });
  const experimentalJoin = env.DUKE_VOX_JOIN_TRIAL === '1';
  const { createLabAdapter } = require('../experiments/vox30/lab');
  const createAdapter = () => createLabAdapter({
    actorUserId: auth.actorUserId,
    cfg: { ...device, userId: auth.actorUserId },
    entryHost: ENTRY_HOST,
    entryPort: ENTRY_PORT,
    appVer,
    enableSilentAudio: env.NEXI_VOX_TX_SILENCE !== '0',
    experimentalJoin,
    credentialsForRoom: () => auth.getCredentials(),
    verifyMembership({ actorUserId, chatId }) {
      const room = auth.localRoomEvidence({ actorUserId, chatId });
      return client.connected === true && room.isOpenChatInLocalRoster && room.memberTypeCached;
    },
    userTypeForRoom({ chatId }) {
      const type = client._getCachedMemberType(chatId, auth.actorUserId);
      return type === 1 ? 3 : type === 4 ? 2 : 1;
    },
    connect(options) {
      if (!isPublicIpv4(options.host)) throw new Error('Invalid VOX server address');
      return voxConnect({ ...options, servername: 'kakao.com' });
    },
  });
  const slots = String(env.NEXI_VOX_MAX_ACTIVE_ROOMS ?? '1').trim().toLowerCase();
  return slots === 'unlimited' || (/^[0-9]+$/.test(slots) && Number(slots) >= 2)
    ? createMultiRoomAdapter({ createAdapter, maxRooms: Infinity, joinTrialEnabled: experimentalJoin })
    : createAdapter();
}

module.exports = { createDukeVoiceAdapter };
