'use strict';
// An evidence-gated VOX3 hangUp request sender.
// No method number or BSON schema is guessed. An authenticated, version-matched
// protocol contract must be supplied after independently observing a real hangUp.
const {checkedId,checkedAppVersion}=require('./vox30-protocol');
function createHangupDriver({appVer,contract,buildBody}={}){
 const version=checkedAppVersion(appVer);
 if(!contract || contract.reviewed!==true || contract.recordedHangUp!==true ||
    contract.appVer!==version || typeof buildBody!=='function')
  throw Error('VOX 종료 요청의 버전 일치·실제 hangUp 증거·BSON 구성 함수가 필요합니다.');
 const {requestMethod,replyMethod}=contract;
 const validMethod=n=>Number.isInteger(n)&&n>=1000&&n<=65000;
 if(!validMethod(requestMethod)||!validMethod(replyMethod)||
    requestMethod===11009)
  throw Error('VOX 종료 요청 메서드가 미확인 또는 종료 이벤트(11009)입니다.');
 return Object.freeze({
  verified:true,appVer:version,
  async hangUp({roomId,callId,csId=null,actorUserId,connection}={}){
   const room=checkedId(roomId),call=checkedId(callId),actor=checkedId(actorUserId);
   const cs=csId==null?null:checkedId(csId);
   if(!connection || typeof connection.request!=='function')
    throw Error('VOX 인증된 통화 연결의 request()가 필요합니다.');
   const body=buildBody(Object.freeze({roomId:room,callId:call,csId:cs,actorUserId:actor}));
   if(!body || typeof body!=='object'||Array.isArray(body)||
      Object.getPrototypeOf(body)!==Object.prototype)
    throw Error('VOX 종료 BSON 문서가 올바르지 않습니다.');
   // The transport owns encryption, BSON serialization and reply matching.
   // request() checks resCode, but neither an ACK nor sending implies vr_bye.
   const reply=await connection.request(requestMethod,body,replyMethod);
   if(!reply || typeof reply!=='object')
    throw Error('VOX 종료 서버 응답이 비어 있습니다.');
   return {requestAccepted:true,serverEnded:false};
  }
 });
}
module.exports={createHangupDriver};
