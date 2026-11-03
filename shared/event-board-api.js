'use strict';

// Historical OpenChannelBoardClient API from storycraft/node-kakao v3.1.8:
// https://github.com/storycraft/node-kakao/blob/v3.1.8/src/api/channel-board-client.ts
// 2026 server compatibility is unverified. ONLY invoked by manager command.
// No undocumented LOCO packets, member refreshes, or speculative extra requests.
const https=require('node:https');

const HOST='open.kakao.com';
const MAX_RESPONSE_BYTES=256*1024;
const REQUEST_TIMEOUT_MS=10000;

function unsignedId(value,label) {
  const str=String(value??'');
  if(!/^[1-9]\d*$/.test(str))throw Error(label+'를 확인할 수 없습니다.');
  return str;
}

function postIdOf(res) {
  const raw=res?.id ?? res?.post?.id ?? res?.data?.id ?? res?.post_id;
  const id=String(raw??'');
  // Prevent arbitrary endpoint path injection; preserve UUIDs unchanged.
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw Error('포스트 생성 응답에 유효한 postId가 없습니다.');
  return id;
}
function assertServerStatus(response,step) {
  if(!response||typeof response!=='object')throw Error(step+': 빈 서버 응답');
  const value=Number(response.status);
  if(!Number.isFinite(value)||value!==0){
    const errorText=String(response.error_message||response.message||'').slice(0,140);
    throw Error(step+' 거부: 상태 '+(Number.isFinite(value)?value:'알 수 없음')+
      (errorText?' ('+errorText+')':''));
  }
  return response;
}
function buildSessionHeaders(client) {
  const token=String(client?.oauthToken||'');
  // node-kakao v3.1.8's legacy AuthClient used accessToken-deviceUUID;
  // new KakaoForge Bubble uses deviceId. Switch only via explicit config.
  const uuid=String(process.env.HZ_NOTICE_USE_DEVICE_ID==='1'
    ? (client?.deviceId||client?.deviceUuid||'')
    : (client?.deviceUuid||''));
  if(!token||!uuid)throw Error('공지 API 사용을 위한 로그인 토큰 또는 기기 정보가 없습니다.');
  const appVer=String(client.appVer||'26.1.2');
  const lang=String(client.lang||'ko');
  return {
    'Authorization':token+'-'+uuid,
    'Accept':'*/*',
    'Accept-Language':lang,
    'User-Agent':'KT/'+appVer+' An/12 '+lang,
    'A':'android/'+appVer+'/'+lang,
    'Content-Type':'application/x-www-form-urlencoded;charset=utf-8'
  };
}
function defaultTransport({method,path,headers,form}) {
  if(!/^\/moim\/(?:chats\/[1-9]\d+\/posts|posts\/[A-Za-z0-9_-]+(?:\/set_notice)?)\?link_id=[1-9]\d+$/.test(path))
    throw Error('허용되지 않은 공지 API 요청 경로입니다.');
  return new Promise((resolve,reject)=>{
    const body=form?new URLSearchParams(form).toString():'';
    const h={...headers};
    if(body)h['Content-Length']=String(Buffer.byteLength(body,'utf8'));
    const req=https.request({protocol:'https:',hostname:HOST,port:443,path,method,
      headers:h,timeout:REQUEST_TIMEOUT_MS},res=>{
      let text='';
      let size=0;
      res.setEncoding('utf8');
      res.on('data',chunk=>{
        size+=Buffer.byteLength(chunk,'utf8');
        if(size>MAX_RESPONSE_BYTES){
          req.destroy(Error('공지 API 응답이 너무 큽니다.'));
          return;
        }
        text+=chunk;
      });
      res.on('end',()=>{
        const status=res.statusCode||0;
        if(status<200||status>=300){
          // Never include tokens/headers or arbitrary response bodies in logs.
          reject(Error('공지 API HTTP '+status));
          return;
        }
        try{resolve(JSON.parse(text));}
        catch{reject(Error('공지 API 응답을 해석할 수 없습니다.'));}
      });
      res.on('error',reject);
    });
    req.on('error',reject);
    req.on('timeout',()=>req.destroy(Error('공지 API 연결 시간이 초과되었습니다.')));
    if(body)req.write(body);
    req.end();
  });
}
function getLinkId(client,roomId,explicitLinkId) {
  const room=String(roomId);
  const raw=explicitLinkId ??
    client?._chatRooms?.get(room)?.openLinkId ??
    client?._chatRooms?.get(room)?.li;
  return unsignedId(raw,'오픈채팅 링크 ID');
}
// Kakao's board API uses -4042 when a post has already been deleted.
function isDeletedPostError(error){
 const msg=String(error?.message||error||'');
 return /상태 -4042(?:\\D|$)/.test(msg)&&msg.includes('삭제된 글입니다.');
}
function createBoardAdapter(client,{transport=defaultTransport,linkId=null}={}) {
  return {
    experimental:true,
    // Remove only a post ID previously registered by this bot.
    async remove({roomId,postId}){
      const room=unsignedId(roomId,'채팅방 ID');
      const post=String(postId||'');
      if(!/^[A-Za-z0-9_-]{1,128}$/.test(post))throw Error('공지 포스트 ID가 올바르지 않습니다.');
      if(client?.connected===false)throw Error('카카오톡 연결이 끊어졌습니다.');
      const link=getLinkId(client,room,linkId);
      const headers=buildSessionHeaders(client),query='?link_id='+encodeURIComponent(link);
      // Never delete a post that is no longer marked as a room notice.
      let before;
      try{
        before=assertServerStatus(await transport({
          method:'GET',path:'/moim/posts/'+encodeURIComponent(post)+query,headers
        }),'공지 삭제 전 확인');
      }catch(error){
        // A previous deletion may have succeeded while our verification failed.
        if(isDeletedPostError(error))return {removed:true,alreadyRemoved:true};
        throw error;
      }
      if(!(before.notice===true||before.post?.notice===true||before.data?.notice===true))
        throw Error('현재 등록된 공지인지 확인할 수 없습니다.');
      // This is the legacy board post deletion endpoint; compatibility depends
      // on Kakao's server. Do not report success without server confirmation.
      assertServerStatus(await transport({
        method:'DELETE',path:'/moim/posts/'+encodeURIComponent(post)+query,headers
      }),'봇 공지 포스트 삭제');
      // A successful request alone does not prove the notice disappeared.
      try{
        const after=assertServerStatus(await transport({
          method:'GET',path:'/moim/posts/'+encodeURIComponent(post)+query,headers
        }),'공지 삭제 결과 확인');
        if(after.notice===false||after.post?.notice===false||after.data?.notice===false)
          return {removed:true};
        throw Error('공지 삭제 후에도 상단 공지가 유지되고 있습니다.');
      }catch(e){
        if(String(e?.message||e)==='공지 API HTTP 404'||isDeletedPostError(e))return {removed:true};
        throw e;
      }
    },
    async register({roomId,text}) {
      const room=unsignedId(roomId,'채팅방 ID');
      if(client?.connected===false)throw Error('카카오톡 연결이 끊어졌습니다.');
      const link=getLinkId(client,room,linkId);
      const headers=buildSessionHeaders(client);
      const query='?link_id='+encodeURIComponent(link);
      const createPath='/moim/chats/'+encodeURIComponent(room)+'/posts'+query;
      // Text post first; 'notice' is sent as false to force explicit register.
      const created=assertServerStatus(await transport({
        method:'POST',path:createPath,headers,
        form:{
          object_type:'TEXT',
          content:JSON.stringify([{type:'text',text:String(text)}]),
          notice:'false'
        }
      }), '포스트 생성');
      const postId=postIdOf(created);
      const postPath='/moim/posts/'+encodeURIComponent(postId);
      try{
        assertServerStatus(await transport({
          method:'POST',path:postPath+'/set_notice'+query,headers
        }),'상단 공지 등록');
      }catch(err){
        throw Error(String(err.message||err)+' (포스트 '+postId+'는 생성되었을 수 있습니다.)');
      }
      // Server must report 'notice: true' on a subsequent read.
      // Status 0 on set_notice alone is insufficient verification.
      const verified=assertServerStatus(await transport({
        method:'GET',path:postPath+query,headers
      }),'공지 등록 확인');
      const marked=verified.notice===true || verified.post?.notice===true ||
        verified.data?.notice===true;
      if(!marked){
        throw Error('서버에서 공지 등록 여부를 검증하지 못했습니다. 포스트 ID: '+postId);
      }
      return {registered:true,status:0,postId};
    }
  };
}
module.exports={HOST,buildSessionHeaders,postIdOf,assertServerStatus,
  getLinkId,createBoardAdapter,defaultTransport};
