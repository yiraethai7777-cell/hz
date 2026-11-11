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
  function frame(method,data) {
    if (!Number.isInteger(method) || method<0 || method>65535)
      throw Error('VOX method 범위 오류');
    const head=Buffer.alloc(12);
    const random=nonce(4);
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
    return {method:raw.readUInt16LE(6),status:raw.readUInt16LE(4),body};
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

async function voxConnect({host,port,codec,timeoutMs=DEFAULT_TIMEOUT_MS,
    servername,ca,tlsConnect=tls.connect}={}) {
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
  function fail() {
    if(closed)return;
    closed=true;
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
  async function send(method,data) {
    if(closed)throw Error('VOX 연결이 종료됐습니다.');
    const bytes=codec.frame(method,data);
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
  return {wait,send,request,close:fail};
}

function validateCfg(cfg) {
  checkedId(cfg?.userId);
  for(const name of ['carrierId','model','sdkVersion','buildId']) {
    if (typeof cfg[name]!=='string' || !cfg[name].trim() || cfg[name].length>128)
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
  return {model:cfg.model,os:'android',osver:cfg.sdkVersion,buildId:cfg.buildId,
    ...(subType?{devSubType:new I32(7)}:{})};
}
function getDiscoveryBody(cfg,chatId,appVer) {
  checkedAppVersion(appVer);
  return {
    userId:new I64(checkedId(cfg.userId)),devType:new I32(4),
    chatId:new I64(checkedId(chatId)),appVer,lang:'ko',country:'KR',
    voxVer:new I32(5),carrierId:cfg.carrierId,netType:new I32(2),
    checkOnCall:false,serviceType:new I32(11),devInfo:commonDevice(cfg),
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
    netType:new I32(2),carrierId:cfg.carrierId,simOperator:cfg.carrierId,
    isRoaming:new I32(0),mobileNetType:new I32(13),
    devInfo:commonDevice(cfg,true),
    sdp:{sdp,sdpType:new I32(1),sdpUserId:userId},isMultiChat:false,
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
  const server=await getCallServer({
    cfg,chatId,entryHost,entryPort,codec,appVer,connect,transport,
  });
  const c=await connect({host:server.host,port:server.port,codec,...transport});
  // The supplied protocol says 11028 is a command and 11003/11007 is the
  // outcome. A separate 11028 reply may NEVER arrive. Do not await it.
  // Register the listener before writing so immediate events cannot be lost.
  const outcome=c.wait(METHODS.CREATED,METHODS.REJECTED);
  try {
    await c.send(METHODS.CREATE,createBody);
    const event=await outcome.promise;
    if(event.method===METHODS.REJECTED)
      throw Error('VOX 보이스룸 생성 거절: reason='+integer(event.body.reason??0));
    const remoteSdp=event.body.sdp;
    // A 11003 event does NOT prove KakaoTalk server activation or ICE/DTLS.
    if(!remoteSdp || typeof remoteSdp!=='object')
      throw Error('VOX 원격 SDP 응답이 없습니다.');
    return {
      conn:c,callId:event.body.callId??null,csId:event.body.csId??null,remoteSdp,
      requestAccepted:true,verified:false,
    };
  }catch(e){outcome.cancel();c.close();throw e;}
}

module.exports={
  VOX_IV,METHODS,I32,I64,integer,checkedId,validateTitle,pkcs7Pad,pkcs7Unpad,
  nativeSeedCbc,createCodec,parseServerAddress,voxConnect,checkedAppVersion,
  getDiscoveryBody,getCreateBody,getCallServer,createVoiceRoom,
};
