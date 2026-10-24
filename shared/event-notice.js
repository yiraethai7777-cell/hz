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

function capability(client,linkId) {
  // Prefer a verified third-party adapter when explicitly installed.
  const custom=client?.roomNoticeAdapter;
  if(custom && typeof custom.register==='function')return custom;
  if(process.env.HZ_EVENT_NOTICE_API==='off')return null;
  // Historical public node-kakao board API. May not work with 2026 server;
  // availability of this object is NOT evidence of successful registration.
  // Only use deviceId as an alternative when explicitly opted in.
  const hasDevice=!!client?.deviceUuid ||
    (process.env.HZ_NOTICE_USE_DEVICE_ID==='1' && !!client?.deviceId);
  if(!client?.oauthToken || !hasDevice)return null;
  return require('./event-board-api').createBoardAdapter(client,{linkId});
}
function sanitize(str) {
  const value=String(str??'').replace(/\r\n?/g,'\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g,'').trim();
  if(!value)throw Error('공지 내용을 입력해 주세요. 사용법: !공지예약 HH:MM 내용');
  if(value.length>MAX_NOTICE)throw Error('공지 내용은 최대 '+MAX_NOTICE+'자입니다.');
  return value;
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

module.exports={register,capability,normalizeStatus,sanitize,extractSentLogId,createMessageNoticeAdapter};
