'use strict';

// Experimental room-scoped VOX session coordinator.
// Each room has an independent VOX connection, WebRTC peer and keepalive.
// The Kakao server's ability to accept multiple calls from ONE account has
// not been proven; production defaults to one session until explicitly opted in.
const {checkedId}=require('./vox30-protocol');

function createMultiRoomAdapter({createAdapter,maxRooms=1}={}){
  if(typeof createAdapter!=='function')throw Error('VOX 어댑터 생성 함수가 필요합니다.');
  if(!Number.isInteger(maxRooms)||maxRooms<1||maxRooms>2)
    throw Error('VOX 동시 연결 제한은 1 또는 2여야 합니다.');
  const sessions=new Map();
  let negotiating=false,disposed=false;
  function ensureOpen(){if(disposed)throw Error('VOX 세션 관리자가 종료됐습니다.');}
  async function cleanup(){
    for(const [roomId,item] of sessions){
      if(item.phase!=='live')continue; // reserve in-flight slots
      let state;
      try{state=await item.adapter.status({roomId});}
      catch{continue;} // no evidence to evict this session
      if(state?.localActive!==false)continue;
      sessions.delete(roomId);
      try{await item.adapter.dispose?.();}catch{}
    }
  }
  function emptyStatus(roomId){
    return {
      roomId,verified:false,statusKnown:false,
      localSession:true,localActive:false,stopAvailable:false,
      joinAvailable:false,speakerAutoAcceptAvailable:false,
      moderatorAutoAcceptAvailable:false,pendingRoles:[],
      localBusyOtherRoom:sessions.size>=maxRooms,
      multiRoomExperimental:maxRooms>1,
      maxLocalRooms:maxRooms,
    };
  }
  return {
    kind:'vox30-direct-experimental',
    async status({roomId}={}){
      ensureOpen();
      const id=checkedId(roomId);
      await cleanup();
      const item=sessions.get(id);
      if(!item)return emptyStatus(id);
      const state=await item.adapter.status({roomId:id});
      return {
        ...state,roomId:id,
        localCreating:item.phase==='starting',
        multiRoomExperimental:maxRooms>1,maxLocalRooms:maxRooms,
      };
    },
    async create(request={}){
      ensureOpen();
      const id=checkedId(request.roomId);
      if(negotiating)throw Error('다른 VOX 생성 요청을 처리 중입니다.');
      negotiating=true;
      try{
        await cleanup();
        const previous=sessions.get(id);
        if(previous)throw Error('이 방에 이미 활성 VOX 세션이 있습니다.');
        if(sessions.size>=maxRooms)
          throw Error('VOX 계정에 이미 활성 음성 세션이 있습니다.');
        const adapter=createAdapter();
        if(!adapter||typeof adapter.create!=='function'||
            typeof adapter.status!=='function')
          throw Error('VOX 독립 세션 어댑터가 유효하지 않습니다.');
        const entry={adapter,phase:'starting'};
        sessions.set(id,entry); // reserve slot before async server negotiation
        try{
          const result=await adapter.create({...request,roomId:id});
          if(result?.requestAccepted!==true && result?.verified!==true){
            sessions.delete(id);
            await adapter.dispose?.();
            return result;
          }
          entry.phase='live';
          return result;
        }catch(error){
          if(sessions.get(id)===entry)sessions.delete(id);
          try{await adapter.dispose?.();}catch{}
          throw error;
        }
      }finally{negotiating=false;}
    },
    async stop(request={}){
      ensureOpen();
      const id=checkedId(request.roomId);
      const item=sessions.get(id);
      if(!item || item.phase!=='live')
        return {roomId:id,closed:false,verified:false,
          localReleased:false,serverStopUnavailable:true};
      if(typeof item.adapter.stop!=='function')
        return {roomId:id,closed:false,verified:false,
          localReleased:false,serverStopUnavailable:true};
      return item.adapter.stop({...request,roomId:id});
    },
    async join({roomId}={}){
      ensureOpen();
      // No verified VOX 11002 login packet in the current implementation.
      checkedId(roomId);
      return {requestAccepted:false,verified:false};
    },
    async receiveAuthenticatedRoleInvitation(info={}){
      ensureOpen();
      let item;
      if(info.roomId!=null){
        item=sessions.get(checkedId(info.roomId));
      }else if(sessions.size===1){
        item=sessions.values().next().value;
      }
      if(!item || typeof item.adapter.receiveAuthenticatedRoleInvitation!=='function')
        return false;
      return item.adapter.receiveAuthenticatedRoleInvitation(info);
    },
    async dispose(){
      if(disposed)return;
      disposed=true;
      const all=[...sessions.values()];
      sessions.clear();
      await Promise.all(all.map(async entry=>{
        try{await entry.adapter.dispose?.();}catch{}
      }));
    },
  };
}

module.exports={createMultiRoomAdapter};
