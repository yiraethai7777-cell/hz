'use strict';
// Guarded Railway VOX participation and invitation acceptance.
// NOTE: The actual 11002 LOGIN and role-accept BSON contracts are not verified.
// This module never makes up a wire method or claims a successful server role
// without a matching server roster event.
const {checkedId}=require('./vox30-protocol');
const {ownRole}=require('./vox30-role-state');

const TARGET_ROLES=new Set(['speaker','moderator']);
function validatedId(value) {
  try{return checkedId(value);}catch{return null;}
}
function createParticipationController({
  actorUserId,
  joinTransport=null,
  acceptSpeakerTransport=null,
  acceptModeratorTransport=null,
  now=Date.now,
}={}) {
  const actor=validatedId(actorUserId);
  if(!actor)throw Error('VOX 실행 계정 ID가 유효하지 않습니다.');
  let active=null;
  let inFlight=false;
  const attempts=new Map();
  function supports(){
    return {
      join:typeof joinTransport==='function',
      speaker:typeof acceptSpeakerTransport==='function',
      moderator:typeof acceptModeratorTransport==='function',
    };
  }
  function status(roomId) {
    const id=validatedId(roomId);
    if(!id)throw Error('VOX 채팅방 ID가 유효하지 않습니다.');
    const own=active?.roomId===id;
    const pending=own?[...attempts.values()].filter(x=>x.roomId===id&&x.state==='requested').map(x=>x.role):[];
    return {
      roomId:id,joinAvailable:supports().join,
      speakerAutoAcceptAvailable:supports().speaker,
      moderatorAutoAcceptAvailable:supports().moderator,
      localActive:own,localBusyOtherRoom:!!active&&!own,
      role:own?active.role:null,roleVerified:own&&active.roleSource==='vox-12011-own-roster',
      pendingRoles:pending,
    };
  }
  async function join({roomId,invitation}={}) {
    const id=validatedId(roomId);
    if(!id)throw Error('VOX 채팅방 ID가 유효하지 않습니다.');
    if(active)throw Error('이미 활성 VOX 세션이 있습니다.');
    if(inFlight)throw Error('VOX 참가 요청을 이미 처리하고 있습니다.');
    if(typeof joinTransport!=='function')
      throw Error('VOX 11002 LOGIN 인증 BSON 규격이 미검증되어 실제 참가를 실행할 수 없습니다.');
    const callId=validatedId(invitation?.callId);
    if(!callId || invitation?.roomId!==id ||
      !(typeof invitation?.hostV4==='string'||typeof invitation?.hostV6==='string') ||
      !Number.isInteger(invitation?.port))
      throw Error('현재 보이스룸 초대 접속정보가 유효하지 않습니다.');
    inFlight=true;
    try {
      // A verified transport MUST independently authorize TLS targets and
      // authenticate the VOX actor. This module never sends raw endpoints.
      const result=await joinTransport({roomId:id,actorUserId:actor,invitation:{...invitation}});
      if(result?.requestAccepted!==true)return {requestAccepted:false,verified:false};
      // Request acceptance is NOT proof of roster membership.
      return {requestAccepted:true,verified:false};
    }finally{inFlight=false;}
  }
  function activate({roomId,callId}={}) {
    const id=validatedId(roomId),call=validatedId(callId);
    if(!id||!call)throw Error('VOX 세션 식별자가 유효하지 않습니다.');
    if(active && (active.roomId!==id||active.callId!==call))
      throw Error('다른 VOX 음성 세션이 활성화되어 있습니다.');
    if(!active)active={roomId:id,callId:call,role:null,roleSource:null};
  }
  function onRoster(packet,{roomId,callId}={}) {
    const id=validatedId(roomId),call=validatedId(callId);
    if(!active||active.roomId!==id||active.callId!==call)return false;
    const evidence=ownRole(packet);
    if(!evidence)return false;
    active.role=evidence.role;active.roleSource=evidence.source;
    const pending=attempts.get(evidence.role);
    if(pending&&pending.roomId===id&&pending.callId===call&&
      pending.state==='requested')pending.state='observed';
    return true;
  }
  // Only a version-matched, authenticated call-server decoder may supply this.
  // No untrusted chat/LOCO invitation can trigger an acceptance request.
  async function receiveAuthenticatedInvitation({
    roomId,callId,recipientUserId,role,authenticated=false,
  }={}) {
    const id=validatedId(roomId),call=validatedId(callId);
    if(authenticated!==true||!TARGET_ROLES.has(role)||!id||!call||
      validatedId(recipientUserId)!==actor)return {handled:false};
    if(!active||active.roomId!==id||active.callId!==call)return {handled:false};
    if(active.role===role || active.role==='moderator')
      return {handled:false,reason:'already-granted'};
    if(attempts.get(role)?.state==='requested' &&
      attempts.get(role)?.callId===call)return {handled:false,reason:'duplicate'};
    const driver=role==='speaker'?acceptSpeakerTransport:acceptModeratorTransport;
    if(typeof driver!=='function')return {handled:false,reason:'protocol-unverified'};
    attempts.set(role,{roomId:id,callId:call,role,state:'requested',at:now()});
    try {
      const result=await driver({roomId:id,callId:call,actorUserId:actor});
      if(result?.requestAccepted!==true){
        attempts.delete(role);
        return {handled:false,reason:'request-not-accepted'};
      }
      // Even a zero server return code does NOT confirm that role changed.
      return {handled:true,verified:false,awaitingRoster:true};
    }catch{
      attempts.delete(role);
      return {handled:false,reason:'request-failed'};
    }
  }
  function release() {
    active=null;attempts.clear();
  }
  return Object.freeze({
    supports,status,join,activate,onRoster,receiveAuthenticatedInvitation,release,
  });
}
module.exports={createParticipationController};
