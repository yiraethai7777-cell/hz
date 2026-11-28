'use strict';
// Shared live CHATONROOM snapshots. One in-flight request per room and no stale
// roster fallback; callers can distinguish unavailable from complete data.
const snapshots=new Map(),inflight=new Map();
const numeric=v=>{const s=typeof v==='number'&&!Number.isSafeInteger(v)?'':String(v??'');return /^[1-9]\d{1,24}$/.test(s)?s:'';};
function imageUrl(value){if(typeof value!=='string'||value.length>1800)return '';try{const u=new URL(value);return u.protocol==='https:'?u.href:'';}catch{return '';}}
function readMember(m){
 const id=numeric(m?.userId??m?.id??m?.memberId??m?.user_id);
 if(!id)return null;
 const name=String(m.nickName??m.nickname??m.name??m.profileName??'').trim().slice(0,80);
 const rawType=m.mt??m.ut??m.memberType??m.linkMemberType??m.userType;
 const roleKnown=rawType!==null&&rawType!==undefined&&String(rawType).trim()!==''&&Number.isInteger(Number(rawType));
 const type=roleKnown?Number(rawType):0;
 const profileType=Number(m.ptp??m.profileType??0);
 const profileLinkId=numeric(m.pli??m.profileLinkId);
 const photo=imageUrl(m.opi??m.fpi??m.pi??m.profileImageUrl??m.fullProfileImageUrl);
 return {id,name:name||'이름 확인 불가',type,roleKnown,profileType:Number.isFinite(profileType)?profileType:0,profileLinkId,imageUrl:photo};
}
async function refresh(client,roomId,{force=false}={}){
 const room=numeric(roomId);if(!room)throw Error('유효하지 않은 방 ID');
 const cached=snapshots.get(room);
 if(!force&&cached&&Date.now()-cached.at<1000)return cached;
 if(inflight.has(room))return inflight.get(room);
 const task=(async()=>{
  if(!client?.connected||!client?._carriage?.chatOnRoom)throw Error('카카오톡 연결이 필요합니다.');
  const carriage=client._carriage;
  const response=await carriage.chatOnRoom({chatId:room,token:0,opt:0});
  if(response?.status!=null&&Number(response.status)!==0)throw Error('CHATONROOM 서버 오류 '+response.status);
  const body=response?.body||{};
  if(body.status!=null&&Number(body.status)!==0)throw Error('CHATONROOM 응답 오류 '+body.status);
  const list=body.m??body.members??body.memberList??body.memList;
  if(!Array.isArray(list))throw Error('전체 참여자 목록이 응답에 없습니다.');
  const map=new Map();for(const value of list){const m=readMember(value);if(m)map.set(m.id,m);}
  // An empty snapshot can be a transient partial response; do not erase a valid roster.
  if(!map.size)throw Error('참여자 정보가 비어 있습니다.');
  // Keep the library's profile-name cache consistent with the live response.
  if(typeof client._cacheMembers==='function')client._cacheMembers(room,list);
  const item={room,at:Date.now(),members:[...map.values()]};
  snapshots.set(room,item);
  return item;
 })().finally(()=>inflight.delete(room));
 inflight.set(room,task);return task;
}
function cached(room){return snapshots.get(String(room))||null;}
module.exports={refresh,cached};
