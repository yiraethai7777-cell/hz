'use strict';

// Room notice registration is intentionally a separately verified integration.
// Chat WRITE / NOTIREAD do not register a KakaoTalk room notice.
// Until a real notice adapter is installed, never advertise registration as done.
const {load}=require('./event-settings');
const blocked=new Set();
const MAX_NOTICE=2000;

function normalizeStatus(result) {
  if (!result || typeof result !== 'object') return false;
  if (result.registered !== true) return false;
  if (result.success === false || result.ok === false) return false;
  if (typeof result.status === 'number' && result.status !== 0) return false;
  return true;
}
function extractSentLogId(sendResponse) {
  // KakaoForge CarriageClient.write() uses response.body.logId.
  // Do not use the example's response.result.logId unless the underlying
  // transport has a documented, different return shape.
  if(sendResponse?.status !== 0)return null;
  const id=sendResponse?.body?.logId;
  if(id==null)return null;
  const value=String(id);
  return /^[1-9]\d*$/.test(value)?value:null;
}

// A separately provided, verified backend can implement setNotice();
// this helper only constructs the message -> logId -> registration pipeline.
// The currently installed KakaoForge has no setNotice method.
function createMessageNoticeAdapter({sendText,setNotice}) {
  if(typeof sendText!=='function'||typeof setNotice!=='function')
    throw Error('공지 전송과 실제 등록 메서드가 모두 필요합니다.');
  return {
    async register({roomId,text}) {
      const sent=await sendText(String(roomId),text);
      const logId=extractSentLogId(sent);
      if(!logId)throw Error('카카오톡 메시지 전송 응답에서 logId를 확인하지 못했습니다.');
      const result=await setNotice({roomId:String(roomId),logId});
      return normalizeStatus(result)
        ? {registered:true,postId:result.postId||null}
        : {registered:false};
    }
  };
}

function capability(client) {
  // Stable explicit opt-in contract, not an inferred undocumented LOCO method.
  const adapter=client?.roomNoticeAdapter;
  if(!adapter || typeof adapter.register !== 'function')return null;
  return adapter;
}
function sanitize(str) {
  const value=String(str??'').replace(/\r\n?/g,'\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g,'').trim();
  if(!value)throw Error('공지 내용을 먼저 작성해 주세요: #이벤공지작성 내용');
  if(value.length>MAX_NOTICE)throw Error('공지 내용은 최대 '+MAX_NOTICE+'자입니다.');
  return value;
}
async function notify(client,send,message) {
  if(client?.connected===false)return;
  try {await send(message);}catch(e){console.error('[실제 공지] 안내 전송 실패:',String(e?.message||e));}
}

async function register({client,roomId,body,loadSettings=load,adapter=capability(client)}) {
  if(!adapter) return {registered:false,reason:'unsupported'};
  const str=body && String(body).trim()?sanitize(body):
    sanitize((await loadSettings(roomId)).announcement);
  const room=String(roomId);
  if(!/^[1-9]\d*$/.test(room))throw Error('올바르지 않은 방 ID입니다.');
  if(blocked.has(room))return {registered:false,reason:'busy'};
  blocked.add(room);
  try {
    // Implementor must create a genuine board/notice post AND register it
    // as an actual KakaoTalk room notice, then explicitly verify success.
    const response=await adapter.register({roomId:room,text:str});
    if(!normalizeStatus(response))
      return {registered:false,reason:'unconfirmed'};
    return {registered:true,postId:response.postId||null};
  } finally {
    blocked.delete(room);
  }
}

async function handle({client,roomId,msg,text,send,loadSettings=load,adapter}){
  const str=String(text??'').trim();
  const match=/^#이벤공지(등록|상태)(?=$|\s)/.exec(str);
  if(!match)return false;
  if(msg?.room?.isOpenChat!==true){
    await notify(client,send,'오픈채팅방에서만 사용할 수 있습니다.');
    return true;
  }
  if(![1,4].includes(Number(msg?.sender?.type))){
    await notify(client,send,'방장 또는 부방장만 실제 공지를 등록할 수 있습니다.');
    return true;
  }
  const transport=adapter===undefined?capability(client):adapter;
  if(match[1]==='상태'){
    await notify(client,send,transport?
      '✅ 실제 공지 등록 연동이 준비되었습니다. #이벤공지등록 으로 테스트할 수 있습니다.':
      '⚠️ 실제 공지 등록 연동이 아직 없습니다.\n현재 #이벤공지 는 일반 채팅 전송입니다. 카카오톡에서 해당 메시지를 길게 눌러 공지로 등록해 주세요.');
    return true;
  }
  if(!transport){
    await notify(client,send,
      '⚠️ 실제 카카오톡 공지 등록 API가 아직 연결되지 않았습니다.\n'+
      '공지 등록을 완료했다고 표시하지 않습니다.\n'+
      '현재는 #이벤공지 로 메시지를 보낸 뒤 카카오톡에서 길게 눌러 공지로 등록해야 합니다.');
    return true;
  }
  const body=str.slice(match[0].length).trim();
  try{
    const result=await register({client,roomId,body,loadSettings,adapter:transport});
    if(result.registered){
      await notify(client,send,'✅ 카카오톡 실제 공지 등록 확인'+
        (result.postId?' · 포스트 ID: '+String(result.postId):''));
    }else if(result.reason==='busy'){
      await notify(client,send,'이미 이 방의 공지 등록을 처리 중입니다.');
    }else{
      await notify(client,send,'❌ 실제 공지 등록이 확인되지 않았습니다. 카카오톡 공지 목록에서 확인해 주세요.');
    }
  }catch(err){
    console.error('[실제 공지] 등록 실패:',String(err?.message||err));
    await notify(client,send,'❌ 실제 공지 등록 실패: '+String(err?.message||err));
  }
  return true;
}
module.exports={handle,register,capability,normalizeStatus,sanitize,extractSentLogId,createMessageNoticeAdapter};
