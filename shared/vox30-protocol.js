'use strict';

// Experimental, user-supplied VOX 3.0 packet format. NOT verified against
// KakaoTalk servers; not connected to the production Noa adapter or auth.json.
const tls = require('node:tls');
const crypto = require('node:crypto');
const bson = require('bson');

const VOX_IV = Buffer.from('6d10dd11ba3761c9771e22f36e10c19d','hex');
const DEFAULT_TIMEOUT_MS = 12000;
const MAX_BODY_BYTES = 1024 * 1024;
const METHODS = Object.freeze({
  DISCOVER:30000, CREATE:11028, CREATED:11003, REJECTED:11007, PING:11015,
  ROOM_EVENT:12011,
});
const I32 = bson.Int32;
const I64 = class extends bson.Long {
  constructor(value) {
    const long = bson.Long.fromString(String(value));
    super(long.low, long.high, long.unsigned);
  }
};

function integer(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER) &&
      value >= BigInt(Number.MIN_SAFE_INTEGER)) return Number(value);
  if (value && typeof value.toString === 'function') {
    const n = Number(value.toString());
    if (Number.isSafeInteger(n)) return n;
  }
  throw Error('VOX 정수 값 확인 실패');
}

function checkedId(value) {
  const id = String(value ?? '');
  if (!/^[1-9][0-9]{0,18}$/.test(id) || BigInt(id) > 9223372036854775807n)
    throw Error('VOX 계정/채팅방 ID가 올바르지 않습니다.');
  return id;
}

function validateTitle(title) {
  const str = String(title ?? '').trim();
  if (!str || Array.from(str).length > 40 || /[\x00-\x1f\x7f]/.test(str))
    throw Error('보이스룸 제목이 올바르지 않습니다.');
  return str;
}

function pkcs7Pad(buffer) {
  if (!Buffer.isBuffer(buffer)) throw Error('PKCS7 입력은 Buffer여야 합니다.');
  const count = 16 - buffer.length % 16;
  return Buffer.concat([buffer,Buffer.alloc(count,count)]);
}
function pkcs7Unpad(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length % 16)
    throw Error('PKCS7 데이터 길이 오류');
  const pad = buffer[buffer.length - 1];
  if (pad < 1 || pad > 16) throw Error('PKCS7 패딩 오류');
  for (let i=1;i<=pad;i++) if (buffer[buffer.length-i] !== pad) throw Error('PKCS7 패딩 오류');
  return buffer.subarray(0,buffer.length-pad);
}

// Node/OpenSSL 3 often exposes SEED only through its LEGACY provider.
// Never enable the legacy provider or disable TLS verification globally here.
function nativeSeedCbc() {
  if (!crypto.getCiphers().includes('seed-cbc'))
    throw Error('SEED-CBC 사용 불가: 독립 실험 런타임에 검증된 SEED 구현이 필요합니다.');
  const run = (name,input,key,iv) => {
    if (!Buffer.isBuffer(input) || input.length % 16 || !input.length ||
        !Buffer.isBuffer(key) || key.length !== 16 ||
        !Buffer.isBuffer(iv) || iv.length !== 16)
      throw Error('SEED-CBC 키/IV/블록 길이 오류');
    const engine = name==='encrypt' ?
      crypto.createCipheriv('seed-cbc',key,iv) :
      crypto.createDecipheriv('seed-cbc',key,iv);
    engine.setAutoPadding(false);
    return Buffer.concat([engine.update(input),engine.final()]);
  };
  return {
    encrypt:(input,key,iv)=>run('encrypt',input,key,iv),
    decrypt:(input,key,iv)=>run('decrypt',input,key,iv),
  };
}

function createCodec({seed,serialize=bson.serialize,deserialize=bson.deserialize,
    nonce=crypto.randomBytes}={}) {
  // Defaults to OpenSSL SEED only if that cipher is available. A separate
  // vetted implementation can be injected without touching the bot runtime.
  const cipher=seed || nativeSeedCbc();
  if (typeof cipher.encrypt!=='function' || typeof cipher.decrypt!=='function')
    throw Error('VOX SEED-CBC 구현이 필요합니다.');
  function frame(method,data,requestNonce) {
    if (!Number.isInteger(method) || method<0 || method>65535)
      throw Error('VOX method 범위 오류');
    const head=Buffer.alloc(12);
    const random=requestNonce??nonce(4);
    if (!Buffer.isBuffer(random) || random.length!==4) throw Error('VOX nonce 오류');
    random.copy(head,0);
    head.writeUInt16LE(method,6);
    const key=crypto.createHash('md5').update(head.subarray(0,8)).digest();
    const plain=serialize(data);
    if (!Buffer.isBuffer(plain)) throw Error('VOX BSON 인코딩 오류');
    const padded=pkcs7Pad(plain);
    if(padded.length>MAX_BODY_BYTES)throw Error('VOX 요청 본문 크기 초과');
    const encrypted=cipher.encrypt(padded,key,VOX_IV);
    if (!Buffer.isBuffer(encrypted) || encrypted.length!==padded.length)
      throw Error('VOX SEED 암호화 결과 오류');
    head.writeUInt32LE(encrypted.length,8);
    return Buffer.concat([head,encrypted]);
  }
  function parse(raw) {
    if (!Buffer.isBuffer(raw) || raw.length < 12) throw Error('VOX 헤더 누락');
    const len=raw.readUInt32LE(8);
    if (!len || len > MAX_BODY_BYTES || len % 16 || raw.length!==12+len)
      throw Error('VOX 프레임 길이 오류');
    const key=crypto.createHash('md5').update(raw.subarray(0,8)).digest();
    const plain=cipher.decrypt(raw.subarray(12),key,VOX_IV);
    if (!Buffer.isBuffer(plain) || plain.length !==len) throw Error('VOX 복호화 결과 오류');
    const body=deserialize(pkcs7Unpad(plain),{promoteLongs:false,promoteValues:false});
    if (!body || typeof body!=='object' || Array.isArray(body))
      throw Error('VOX BSON 응답 오류');
    return {method:raw.readUInt16LE(6),status:raw.readUInt16LE(4),requestNonce:Buffer.from(raw.subarray(0,4)),body};
  }
  return Object.freeze({frame,parse});
}

function parseServerAddress(reply) {
  if (integer(reply?.callable) !== 1) throw Error('VOX 통화 서버 연결 거절');
  const address=reply.csSslAddr;
  const unsigned=integer(address?.ip)>>>0;
  const host=[unsigned>>>24,(unsigned>>>16)&255,(unsigned>>>8)&255,unsigned&255].join('.');
  const port=integer(reply.csSslPort ?? address?.port);
  if (unsigned===0 || port<1 || port>65535) throw Error('VOX 서버 주소 오류');
  return {host,port};
}

const DIAGNOSTIC_FIELDS=['reason','reasonCode','byeReason','disconnectReason','resCode',
  'resultCode','callId','csId','userId','chatId','sdp','sdpType','candidate',
  'candidates','mediaType','mediaState','state','type','action','event','data','users'];


const SAFE_FIELD_NAME=/^[A-Za-z][A-Za-z0-9_]{0,30}$/;
const SENSITIVE_FIELD_NAME=/(?:token|auth|secret|pass|key|cookie|uuid|name|title|text|url|link|sdp|candidate|address|ip|port|device|session|user|chat|uid|mid|id)/i;
function safeFieldKeys(record,max=16) {
  if(!record||typeof record!=='object'||Array.isArray(record))return [];
  return Object.keys(record).filter(key=>
    SAFE_FIELD_NAME.test(key)&&!SENSITIVE_FIELD_NAME.test(key)
  ).slice(0,max);
}
function structuralField(value) {
  if(Array.isArray(value)){
    const items=value.filter(item=>item&&typeof item==='object'&&
      !Array.isArray(item)).slice(0,3);
    const elementKeys=[...new Set(items.flatMap(item=>safeFieldKeys(item)))].slice(0,16);
    return {kind:'array',count:Math.min(value.length,2000),
      ...(value.length>2000?{capped:true}:{}),
      ...(elementKeys.length?{elementKeys}:{})};
  }
  if(value&&typeof value==='object'){
    const keys=Object.keys(value);
    const first=keys.length?value[keys[0]]:undefined;
    // Members may be a map keyed by private user IDs: report only key count,
    // and the first member's non-identifying field names.
    return {kind:'object',fieldKeys:safeFieldKeys(value),
      ...(first&&typeof first==='object'&&!Array.isArray(first)
        ?{entryCount:Math.min(keys.length,2000),entryKeys:safeFieldKeys(first)}:{})};
  }
  return {kind:value===null?'null':typeof value};
}
// VOX 12011 carries a "members" envelope with "type" and "full" keys.
// Neither is itself a participant. "full" could be a list, map, boolean or
// another nested structure; do not assume its semantics without evidence.
function memberEnvelope(members) {
  if(!members||typeof members!=='object'||Array.isArray(members)||
      !Object.hasOwn(members,'type')||!Object.hasOwn(members,'full'))
    return null;
  const result={kind:'type-full',full:structuralField(members.full)};
  try {
    const type=integer(members.type);
    if(Number.isSafeInteger(type)&&type>=0&&type<=128)result.typeCode=type;
  }catch{}
  if(typeof members.full==='boolean')result.fullFlag=members.full;
  return result;
}
function ownMemberEvidence(members,actorUserId){
  if(actorUserId==null)return null;
  const actor=String(actorUserId);
  if(!/^[1-9][0-9]{0,18}$/.test(actor))return null;
  // Search bounded, plain BSON-decoded containers only, never raw buffers,
  // arbitrary text or global user metadata. A match must be exact.
  const visited=new Set();
  let traversed=0;
  const statesFor=row=>{
    const states={};
    if(!row||typeof row!=='object'||Array.isArray(row))return states;
    for(const key of ['userType','memberType','role','speakerType','voiceRole']){
      if(!Object.hasOwn(row,key))continue;
      try{
        const val=integer(row[key]);
        if(Number.isSafeInteger(val)&&Math.abs(val)<100000)states[key]=val;
      }catch{}
    }
    for(const key of ['isHost','isCreator','isModerator','isSpeaker','isOwner']){
      if(typeof row[key]==='boolean')states[key]=row[key];
    }
    // Read ONLY the caller's safe mic/camera/filter enums. This is diagnostic
    // evidence, not proof of microphone permission or media delivery.
    for(const key of ['mic','cam','voiceFilter']){
      if(!Object.hasOwn(row,key))continue;
      if(typeof row[key]==='boolean'){states[key]=row[key];continue;}
      try{
        const value=integer(row[key]);
        if(Number.isSafeInteger(value)&&value>=-1&&value<=16)
          states[key]=value;
      }catch{}
    }
    return states;
  };
  function visit(node,depth){
    if(node==null||typeof node!=='object'||ArrayBuffer.isView(node)||
        depth>6||visited.has(node)||traversed>=2048)return null;
    visited.add(node);
    traversed++;
    if(!Array.isArray(node)){
      const id=node.userId??node.memberId??node.uid??node.mid??node.id;
      if(id!=null&&String(id)===actor)
        return {present:true,states:statesFor(node)};
      // Some VOX versions may use a map keyed by the 64-bit member ID.
      // Never print map keys or other participants' values.
      if(Object.hasOwn(node,actor))
        return {present:true,states:statesFor(node[actor])};
    }
    const children=Array.isArray(node)?node:Object.values(node);
    for(let i=0;i<Math.min(children.length,2048);i++){
      const found=visit(children[i],depth+1);
      if(found)return found;
    }
    return null;
  }
  return visit(members,0);
}

// Group names come from the VOX server's own full roster structure.
// "userType" alone does not establish host/speaker/moderator privilege.
const VOICE_MEMBER_GROUPS=['moderators','speakers','listeners'];
function candidateMemberId(value) {
  if(typeof value==='string'){
    return /^[1-9][0-9]{0,18}$/.test(value)&&
      BigInt(value)<=9223372036854775807n?value:null;
  }
  if(typeof value==='number')
    return Number.isSafeInteger(value)&&value>0?String(value):null;
  if(typeof value==='bigint')
    return value>0n&&value<=9223372036854775807n?String(value):null;
  if(value&&typeof value==='object'&&value._bsontype==='Long'){
    const str=value.toString();
    return /^[1-9][0-9]{0,18}$/.test(str)&&
      BigInt(str)<=9223372036854775807n?str:null;
  }
  return null;
}
// For a group that is a list of bare IDs, a value (not a property name)
// may represent membership. Keep traversal bounded and ignore arbitrary
// scalar fields in objects, since those may be timestamps or counters.
function listedMemberPresent(root,actor){
  const visited=new Set();
  let budget=2048;
  function scan(node,depth,inArray=false){
    if(--budget<0||depth>6||node==null)return false;
    if(inArray && candidateMemberId(node)===actor)return true;
    if(!node||typeof node!=='object'||ArrayBuffer.isView(node)||
        visited.has(node))return false;
    visited.add(node);
    if(Array.isArray(node))
      return node.slice(0,1024).some(item=>scan(item,depth+1,true));
    return Object.values(node).slice(0,1024)
      .some(item=>item&&typeof item==='object'&&scan(item,depth+1));
  }
  return scan(root,0);
}
function memberGroupEvidence(members,actorUserId){
  if(!members||typeof members!=='object'||Array.isArray(members)||
      !Object.hasOwn(members,'full')||!members.full||
      typeof members.full!=='object'||Array.isArray(members.full))return null;
  const full=members.full;
  const validActor=candidateMemberId(actorUserId);
  const groups={};
  let included=false;
  for(const groupName of VOICE_MEMBER_GROUPS){
    if(!Object.hasOwn(full,groupName))continue;
    included=true;
    const group=full[groupName];
    const evidence={shape:structuralField(group)};
    if(validActor){
      // Require a precise actor ID. "not_observed" is not proof of
      // absence: a server delta or truncated roster may omit a member.
      const own=ownMemberEvidence(group,validActor);
      if(own){
        evidence.own='present';
        if(Object.keys(own.states).length)evidence.ownStates=own.states;
      }else if(listedMemberPresent(group,validActor)){
        evidence.own='present';
      }else{
        evidence.own='not_observed';
      }
    }else evidence.own='not_checked';
    groups[groupName]=evidence;
  }
  return included?groups:null;
}

// Server interval fields are not documented here as milliseconds or seconds.
// Preserve only bounded numeric values; never infer an expiry from their names.
function serverTimingSummary(body){
  if(!body||typeof body!=='object'||Array.isArray(body))return null;
  const result={};
  for(const key of ['interval','connTimeout','respTimeout']){
    if(!Object.hasOwn(body,key))continue;
    try{
      const value=integer(body[key]);
      if(Number.isSafeInteger(value)&&value>=0&&value<=3600000)result[key]=value;
    }catch{}
  }
  return Object.keys(result).length?result:null;
}
// 11015 can be answered with a successful packet header but without an
// explicit resCode. Distinguish reply arrival from confirmed server acceptance.
function heartbeatReplySummary(packet){
  const body=packet?.body&&typeof packet.body==='object'&&
    !Array.isArray(packet.body)?packet.body:{};
  const declared=['resCode','resultCode','interval','connTimeout',
    'respTimeout','audioState','videoState','reason'];
  const summary={
    replyReceived:true,
    headerStatus:Number.isSafeInteger(packet?.status)?packet.status:null,
    responseFields:declared.filter(field=>Object.hasOwn(body,field)),
    resCodePresent:Object.hasOwn(body,'resCode'),
    acceptance:'unverified',
  };
  if(Object.hasOwn(body,'resCode')){
    try{
      const code=integer(body.resCode);
      if(Number.isSafeInteger(code)&&Math.abs(code)<100000){
        summary.resCode=code;
        summary.acceptance=code===0?'body-resCode-zero':'body-resCode-nonzero';
      }
    }catch{}
  }
  const timing=serverTimingSummary(body);
  if(timing)summary.serverTiming=timing;
  return summary;
}

// Only shapes and role codes of the caller are exposed. No participant identifiers,
// names, raw payloads, credentials, SDP or server addresses are logged.
// Return only packet shape and small enum codes; never log raw VOX bodies, ids,
// titles, SDP, network addresses, OAuth tokens, or arbitrary string values.
function packetSummary(packet,{actorUserId}={}) {
  const {method,status,body}=packet;
  if(![11028,11003,12011,11009].includes(method))
    return {method,status};
  const fields=DIAGNOSTIC_FIELDS.filter(key=>Object.hasOwn(body,key));
  const codes={};
  const enumKeys=['reason','reasonCode','byeReason','disconnectReason',
    'resCode','resultCode','event','userType','role','audioState','videoState'];
  for(const key of enumKeys){
    if(!Object.hasOwn(body,key))continue;
    try{
      const value=integer(body[key]);
      if(Number.isSafeInteger(value) && Math.abs(value)<100000)
        codes[key]=value;
    }catch{}
  }
  const summary={method,status,fields,codes,
    otherFields:Object.keys(body).length-fields.length};
  if(method===12011||method===11028||method===11003){
    // Metadata only; creation often carries unrecognized state fields.
    summary.safeOtherKeys=safeFieldKeys(body).filter(k=>
      !DIAGNOSTIC_FIELDS.includes(k)).slice(0,16);
    const structures={};
    for(const key of ['members','vrInfo','speakerRequestor']){
      if(Object.hasOwn(body,key))structures[key]=structuralField(body[key]);
    }
    if(Object.keys(structures).length)summary.structures=structures;
    const envelope=memberEnvelope(body.members);
    if(envelope)summary.memberEnvelope=envelope;
    const own=ownMemberEvidence(body.members,actorUserId);
    if(own)summary.ownMember=own;
    const memberGroups=memberGroupEvidence(body.members,actorUserId);
    if(memberGroups)summary.memberGroups=memberGroups;
  }
  if(method===11028){
    // Server-provided lifetime/heartbeat configuration only. Bound values
    // and do not expose IDs, arbitrary strings, or connection endpoints.
    const timing={};
    for(const key of ['interval','connTimeout','respTimeout']){
      if(!Object.hasOwn(body,key))continue;
      try{
        const value=integer(body[key]);
        if(Number.isSafeInteger(value)&&value>=0&&value<=3600000)
          timing[key]=value;
      }catch{}
    }
    if(Object.keys(timing).length)summary.serverTiming=timing;
  }
  if((method===11003||method===12011) && body.vrInfo &&
      typeof body.vrInfo==='object' && !Array.isArray(body.vrInfo)){
    const flags={};
    for(const key of ['enableReqSpkPermit','shareMode']){
      if(!Object.hasOwn(body.vrInfo,key))continue;
      const raw=body.vrInfo[key];
      if(typeof raw==='boolean')flags[key]=raw;
      else {
        try{
          const val=integer(raw);
          if(Number.isSafeInteger(val)&&val>=0&&val<=16)flags[key]=val;
        }catch{}
      }
    }
    if(Object.keys(flags).length)summary.voiceFlags=flags;
  }
  if(method===12011 && Object.hasOwn(body,'event'))
    summary.eventValueType=
      body.event===null?'null':Array.isArray(body.event)?'array':typeof body.event;
  return summary;
}

async function voxConnect({host,port,codec,timeoutMs=DEFAULT_TIMEOUT_MS,
    servername,ca,onPacket,diagnosticActorUserId,tlsConnect=tls.connect}={}) {
  if(typeof host!=='string' || !/^[a-zA-Z0-9.:-]+$/.test(host) ||
      !Number.isInteger(port)||port<1||port>65535)
    throw Error('VOX TLS 목적지 오류');
  if(!codec || typeof codec.frame!=='function' || typeof codec.parse!=='function')
    throw Error('VOX codec 연결이 필요합니다.');
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>60000)
    throw Error('VOX 응답 제한 시간이 올바르지 않습니다.');
  const socket=tlsConnect({host,port,rejectUnauthorized:true,
    ...(servername?{servername}:{}),...(ca?{ca}:{})});
  const pending=new Set();
  let buffer=Buffer.alloc(0);
  let closed=false;
  let resolveClosed;
  const whenClosed=new Promise(resolve=>{resolveClosed=resolve;});
  function fail() {
    if(closed)return;
    closed=true;
    resolveClosed();
    for(const entry of pending){clearTimeout(entry.timer);entry.reject(Error('VOX 연결 종료'));}
    pending.clear();
    socket.destroy();
  }
  socket.on('error',fail);
  socket.on('close',fail);
  socket.on('data',chunk=>{
    try {
      if(!Buffer.isBuffer(chunk) || buffer.length+chunk.length>MAX_BODY_BYTES*2+24)
        throw Error('VOX 수신 버퍼 초과');
      buffer=Buffer.concat([buffer,chunk]);
      while(buffer.length>=12){
        const n=buffer.readUInt32LE(8);
        if(!n||n>MAX_BODY_BYTES||n%16) throw Error('VOX 수신 헤더 오류');
        if(buffer.length<12+n)break;
        const packet=codec.parse(buffer.subarray(0,12+n));
        buffer=buffer.subarray(12+n);
        if(onPacket)onPacket(packetSummary(packet,{actorUserId:diagnosticActorUserId}));
        const entry=[...pending].find(w=>w.methods.has(packet.method));
        if(entry){pending.delete(entry);clearTimeout(entry.timer);entry.resolve(packet);}
      }
    }catch{fail();}
  });
  try {
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{cleanup();reject(Error('VOX TLS 연결 시간 초과'));},timeoutMs);
      function onConnect(){cleanup();socket.authorized===false?
          reject(Error('VOX TLS 인증서 검증 실패')):resolve();}
      function onError(){cleanup();reject(Error('VOX TLS 연결 실패'));}
      function cleanup(){clearTimeout(timer);socket.removeListener('secureConnect',onConnect);
        socket.removeListener('error',onError);socket.removeListener('close',onError);}
      socket.once('secureConnect',onConnect);
      socket.once('error',onError);
      socket.once('close',onError);
    });
  } catch(e){fail();throw e;}

  function wait(...methods) {
    if(closed)throw Error('VOX 연결이 종료됐습니다.');
    if(!methods.length||methods.some(m=>!Number.isInteger(m)||m<0||m>65535))
      throw Error('VOX 대기 method 오류');
    let entry;
    const promise=new Promise((resolve,reject)=>{
      entry={methods:new Set(methods),resolve,reject,timer:null};
      entry.timer=setTimeout(()=>{
        pending.delete(entry);
        reject(Error('VOX 서버 응답 시간 초과'));
      },timeoutMs);
      pending.add(entry);
    });
    promise.catch(()=>{}); // failures handled by await or explicit cancellation
    return {promise,cancel:()=>{
      if(pending.delete(entry)){clearTimeout(entry.timer);entry.reject(Error('VOX 대기 취소'));}
    }};
  }
  async function send(method,data,requestNonce) {
    if(closed)throw Error('VOX 연결이 종료됐습니다.');
    const bytes=codec.frame(method,data,requestNonce);
    await new Promise((resolve,reject)=>{
      socket.write(bytes,err=>err?reject(Error('VOX 전송 실패')):resolve());
    });
  }
  async function request(method,data,replyMethod=method) {
    const w=wait(replyMethod);
    try {
      await send(method,data);
      const packet=await w.promise;
      const status=integer(packet.body.resCode ?? 0);
      if(status!==0)throw Error('VOX 응답 거절: method='+method+' resCode='+status);
      return packet.body;
    }catch(e){w.cancel();throw e;}
  }
  return {wait,send,request,close:fail,whenClosed};
}

function validateCfg(cfg) {
  checkedId(cfg?.userId);
  for(const name of ['carrierId','model','sdkVersion','buildId']) {
    if (cfg[name]!==undefined && (typeof cfg[name]!=='string' || !cfg[name].trim() || cfg[name].length>128))
      throw Error('VOX cfg.'+name+' 값이 필요합니다.');
  }
  return cfg;
}
function checkedAppVersion(appVer) {
  if(typeof appVer!=='string'||appVer.length>40||
      !/^\d+\.\d+\.\d+(?:[.-][a-zA-Z0-9.]+)?$/.test(appVer))
    throw Error('VOX 앱 버전은 검증된 세션에서 명시적으로 전달해야 합니다.');
  return appVer;
}
function commonDevice(cfg,subType=false) {
  return {os:'android',
    ...(cfg.model===undefined?{}:{model:cfg.model}),
    ...(cfg.sdkVersion===undefined?{}:{osver:cfg.sdkVersion}),
    ...(cfg.buildId===undefined?{}:{buildId:cfg.buildId}),
    ...(subType?{devSubType:new I32(7)}:{})};
}
function getDiscoveryBody(cfg,chatId,appVer) {
  checkedAppVersion(appVer);
  return {
    userId:new I64(checkedId(cfg.userId)),devType:new I32(4),
    chatId:new I64(checkedId(chatId)),appVer,lang:'ko',country:'KR',
    voxVer:new I32(5),netType:new I32(2),
    ...(cfg.carrierId===undefined?{}:{carrierId:cfg.carrierId}),
    checkOnCall:false,serviceType:new I32(11),
    ...([cfg.model,cfg.sdkVersion,cfg.buildId].some(value=>value!==undefined)
      ?{devInfo:commonDevice(cfg)}:{}),
  };
}
function getCreateBody({cfg,chatId,title,oauthToken,deviceUuid,sdp,userType=1,appVer}) {
  checkedAppVersion(appVer);
  if(typeof oauthToken!=='string'||!oauthToken.trim()||
     typeof deviceUuid!=='string'||!deviceUuid.trim()||
     typeof sdp!=='string'||!sdp.includes('v=0')||sdp.length>65536)
    throw Error('VOX 인증 토큰, 기기 ID 또는 실제 WebRTC SDP offer가 필요합니다.');
  if(![1,2,3].includes(userType))throw Error('VOX userType 오류');
  const userId=new I64(checkedId(cfg.userId));
  return {
    userId,devType:new I32(4),mediaType:new I32(1),sKey:'',
    oauthToken,duuid:deviceUuid,appVer,lang:'ko',country:'KR',
    voxVer:new I32(5),serviceType:new I32(11),chatId:new I64(checkedId(chatId)),
    title:validateTitle(title),userType:new I32(userType),
    defaultMicOnOff:new I32(1),destId:new I64('0'),
    netType:new I32(2),
    ...(cfg.carrierId===undefined?{}:{carrierId:cfg.carrierId,simOperator:cfg.carrierId}),
    isRoaming:new I32(0),mobileNetType:new I32(13),
    devInfo:commonDevice(cfg,true),
    sdp:{sdp,sdpType:new I32(1),sdpUserId:userId},isMultiChat:false,
  };
}

// Based on the public veropy VOX 3.0 create/event reference.
// 11003 and 12011 server notifications need the same identity/call payload.
// The server's message type and response acceptance remain independently checked.
function getEventAckBody(cfg,callId) {
  validateCfg(cfg);
  return {
    userId:new I64(checkedId(cfg.userId)),
    callId:new I64(checkedId(callId)),
    resCode:new I32(0),
    devType:new I32(4),
  };
}

async function getCallServer({cfg,chatId,entryHost,entryPort=9282,codec,
    appVer,connect=voxConnect,transport={}}) {
  validateCfg(cfg);
  checkedId(chatId);
  checkedAppVersion(appVer);
  const c=await connect({host:entryHost,port:entryPort,codec,...transport});
  try {
    const reply=await c.request(METHODS.DISCOVER,getDiscoveryBody(cfg,chatId,appVer));
    return parseServerAddress(reply);
  }finally{c.close();}
}

async function createVoiceRoom({cfg,chatId,title,oauthToken,deviceUuid,sdp,
    userType=1,entryHost,entryPort=9282,codec,appVer,
    connect=voxConnect,transport={}}={}) {
  validateCfg(cfg);checkedId(chatId);validateTitle(title);
  // Fail before network I/O for missing sensitive input and invalid SDP.
  const createBody=getCreateBody({
    cfg,chatId,title,oauthToken,deviceUuid,sdp,userType,appVer,
  });
  // Log safe create-request field evidence only; never log carrier value, token or SDP.
  console.info('[VOICE VOX30] create network fields '+JSON.stringify({
    carrierId:Object.hasOwn(createBody,'carrierId'),
    simOperator:Object.hasOwn(createBody,'simOperator'),
    netType:integer(createBody.netType),
    mobileNetType:integer(createBody.mobileNetType),
  }));
  const server=await getCallServer({
    cfg,chatId,entryHost,entryPort,codec,appVer,connect,transport,
  });
  let callConn=null, eventAckCallId=null;
  let eventAckQueue=0, eventAckCount=0, eventAckFailed=0;
  // Never ACK a response to our ACK. Require a server event/roster body.
  function isRoomEvent(packet) {
    return packet?.method===METHODS.ROOM_EVENT &&
      (packet.fields?.includes('event') ||
       packet.structures?.members || packet.memberEnvelope || packet.memberGroups);
  }
  async function ackRoomEvent() {
    if(!callConn || !eventAckCallId)return;
    try {
      await callConn.send(METHODS.ROOM_EVENT,getEventAckBody(cfg,eventAckCallId));
      eventAckCount++;
      console.info('[VOICE VOX30] 12011 event acknowledgement sent (reference body)');
    } catch {
      eventAckFailed++;
      console.warn('[VOICE VOX30] 12011 event acknowledgement failed');
    }
  }
  // The call server may emit a roster BEFORE the 11028/11003 pair resolves.
  // Keep only a bounded count; neither raw member records nor ids are retained.
  const eventTransport={...transport,onPacket(packet){
    transport.onPacket?.(packet);
    if(!isRoomEvent(packet))return;
    if(eventAckCallId){void ackRoomEvent();return;}
    if(eventAckQueue<32)eventAckQueue++;
  }};
  const c=await connect({host:server.host,port:server.port,codec,...eventTransport});
  callConn=c;
  let outcome,ack;
  const began=Date.now();
  let replyMs=null,eventMs=null,createdAckMs=null;
  try {
    // The server may send 11028 and 11003 in either order.
    // A successful 11003 alone does not prove the 11028 reply was accepted.
    outcome=c.wait(METHODS.CREATED,METHODS.REJECTED);
    ack=c.wait(METHODS.CREATE);
    const accepted=ack.promise.then(packet=>{
      replyMs=Date.now()-began;
      const status=integer(packet.body.resCode ?? packet.status ?? 0);
      if(status!==0)throw Error('VOX 보이스룸 생성 응답 거절: resCode='+status);
      return packet;
    });
    accepted.catch(()=>{}); // event-first path may await this only after 11003 ACK
    const created=outcome.promise.then(packet=>{
      eventMs=Date.now()-began;
      return packet;
    });
    created.catch(()=>{});
    const first=Promise.race([created,accepted]);
    first.catch(()=>{});
    await c.send(METHODS.CREATE,createBody);
    const initial=await first;
    const event=initial.method===METHODS.CREATE?await created:initial;
    if(event.method===METHODS.REJECTED)
      throw Error('VOX 보이스룸 생성 거절: reason='+integer(event.body.reason??0));
    const remoteSdp=event.body.sdp;
    // A 11003 event does NOT prove KakaoTalk server activation or ICE/DTLS.
    if(!remoteSdp || typeof remoteSdp!=='object')
      throw Error('VOX 원격 SDP 응답이 없습니다.');
    // veropy sends userId/callId/devType in the 11003 ACK (not just resCode).
    // The call ID must come from the authentic 11003 event or a verified
    // 11028 reply, never an untrusted chat attachment.
    const eventCallId=event.body.callId ??
      (event.body.callId==null ? (await accepted).body.callId : null);
    const ackBody=getEventAckBody(cfg,eventCallId);
    await c.send(METHODS.CREATED,ackBody,event.requestNonce);
    createdAckMs=Date.now()-began;
    eventAckCallId=checkedId(eventCallId);
    const queued=eventAckQueue;
    eventAckQueue=0;
    for(let i=0;i<queued;i++)await ackRoomEvent();
    // Explicitly verify 11028 even when 11003 arrived first. Previously an
    // event carrying both IDs could bypass this independent acceptance.
    const response=await accepted;
    const reply=response.body;
    for(const field of ['callId','csId']){
      const fromCreate=reply[field],fromEvent=event.body[field];
      if(fromCreate!=null && fromEvent!=null &&
          String(fromCreate)!==String(fromEvent))
        throw Error('VOX 생성 응답과 이벤트의 통화 식별자가 일치하지 않습니다.');
    }
    return {
      conn:c,callId:reply.callId??event.body.callId??null,
      csId:reply.csId??event.body.csId??null,remoteSdp,
      serverTiming:serverTimingSummary(reply),
      requestAccepted:true,verified:false,
      signaling:{replyVerified:true,
        createReplyMs:replyMs,createdEventMs:eventMs,createdAckSentMs:createdAckMs,
        ackUsesServerNonce:Buffer.isBuffer(event.requestNonce)&&event.requestNonce.length===4,
        eventAckIdentityFields:true,roomEventAcksAtCreate:eventAckCount,
        roomEventAckErrorsAtCreate:eventAckFailed,
        idsConsistent:true},
    };
  }catch(e){c.close();throw e;}
  finally{outcome?.cancel();ack?.cancel();}
}

module.exports={
  VOX_IV,METHODS,I32,I64,integer,checkedId,validateTitle,pkcs7Pad,pkcs7Unpad,
  nativeSeedCbc,createCodec,parseServerAddress,voxConnect,checkedAppVersion,
  getDiscoveryBody,getCreateBody,getEventAckBody,getCallServer,createVoiceRoom,packetSummary,
  heartbeatReplySummary,
};
