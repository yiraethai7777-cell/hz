'use strict';
const {refresh}=require('../shared/live-roster');
const {sendNotice}=require('./profile-alerts');
// One-second scheduler; at most one room is queried per tick. Additional
// rooms are round-robined. No overlap, and back off after transport failures.
function createWatcher(ctx,client,{now=Date.now}={}){
 let busy=false,timer,cursor=0,rooms=[],lastRoomsAt=0,resumeAt=0;
 const profileIds=new Map(),retryAt=new Map(),observed=new Map(),roomRetryAt=new Map();
 client.on?.('disconnected',()=>{resumeAt=now()+60000;console.warn('[PROFILE WATCH] paused after disconnect');});
 async function tick(){
  if(busy||now()<resumeAt||client.connected===false)return;
  busy=true;
  try{
   if(now()-lastRoomsAt>15000){
    // Fail closed: the watcher must never query historical rooms that the bot
    // cannot currently access. Refresh the active LOCO room list first.
    if(typeof client.getChatRooms!=='function'||typeof client.getKnownChatRooms!=='function'){
     rooms=[];throw Error('현재 참여 중인 방 목록 조회를 지원하지 않습니다.');
    }
    await client.getChatRooms();
    const joined=new Set(client.getKnownChatRooms()
     .map(r=>String(r.id||'')).filter(id=>/^[1-9]\\d{1,24}$/.test(id)));
    const result=await ctx.pool.query(`SELECT h.room_id FROM hz_rooms h
      LEFT JOIN gl_manage_rooms g ON g.room_id=h.room_id
      WHERE COALESCE(g.enabled,(h.data->>'manage')::boolean,FALSE)=TRUE
        AND COALESCE((h.data->>'locked')::boolean,FALSE)=FALSE
        AND COALESCE((h.data->>'profileAlerts')::boolean,TRUE)=TRUE
      ORDER BY h.room_id`);
    rooms=result.rows.map(r=>String(r.room_id)).filter(id=>joined.has(id));
    // When a room stops being eligible, discard its old comparison baseline.
    const eligible=new Set(rooms);
    for(const id of observed.keys())if(!eligible.has(id))observed.delete(id);
    for(const id of roomRetryAt.keys())if(!eligible.has(id))roomRetryAt.delete(id);
    console.log('[PROFILE WATCH] active managed rooms',{joined:joined.size,eligible:rooms.length});
    lastRoomsAt=now();
   }
   if(!rooms.length)return;
   const room=rooms[cursor++%rooms.length];
   if(now()<(roomRetryAt.get(room)||0))return;
   try{
   const snapshot=await refresh(client,room,{force:true});
   const saved=await ctx.pool.query('SELECT user_id,name,last_profile_url,observed_open_profile_link FROM hz_members WHERE room_id=$1',[room]);
   const previous=new Map(saved.rows.map(m=>[String(m.user_id),m]));
   const observations=[];let lookups=0;
   const priorSnapshot=observed.get(room);
   for(const m of snapshot.members){
    if(m.id===String(client.userId)||m.type===8||m.name==='이름 확인 불가')continue;
    const old=previous.get(m.id),key=room+':'+m.id;
    const prior=priorSnapshot?.get(m.id);
    if(prior&&prior.name===m.name&&prior.imageUrl===m.imageUrl&&prior.profileLinkId===m.profileLinkId&&prior.profileType===m.profileType)continue;
    let link;
    if([1,2,4].includes(m.profileType)){link='';profileIds.delete(key);}
    else if(m.profileLinkId&&typeof client.getUserOpenProfileLink==='function'){
     const needs=profileIds.get(key)!==m.profileLinkId||!old?.observed_open_profile_link||old.name!==m.name||old.last_profile_url!==m.imageUrl;
     if(!needs)link=old.observed_open_profile_link;
     else if(lookups<2&&now()>=(retryAt.get(key)||0)){
      lookups++;
      try{link=ctx.validOpenProfileLink(await client.getUserOpenProfileLink(room,m.id))||undefined;}catch{}
      if(link){profileIds.set(key,m.profileLinkId);retryAt.delete(key);}
      else retryAt.set(key,now()+300000);
     }
    }
    observations.push({...m,link});
   }
   const baseline=!observed.has(room);
   const changes=await (async()=>{
    const c=ctx.pool,events=[];
    for(const m of observations){
     const change=await ctx.profileObserve(c,room,m.id,m.name,m.imageUrl,m.link);
     if(m.link!==undefined)await c.query('UPDATE hz_members SET open_profile_link=$3 WHERE room_id=$1 AND user_id=$2',[room,m.id,m.link||null]);
     if(change)events.push(change);
    }
    return events;
   })();
   observed.set(room,new Map(snapshot.members.map(m=>[m.id,m])));
   if(!baseline){
    const current=new Map(snapshot.members.map(m=>[m.id,m]));
    const notified=new Set();
    for(const [id,prior] of priorSnapshot){
     const latest=current.get(id);
     if(!latest||id===String(client.userId))continue;
     if(prior.name!=='이름 확인 불가'&&latest.name!=='이름 확인 불가'&&prior.name!==latest.name){
      await ctx.send(client.chat,room,'✏️ '+prior.name+' → '+latest.name);
      notified.add(id);
      console.log('[PROFILE WATCH] nickname change delivered',{room,id});
     }
    }
    for(const change of changes){
     if(change.oldName!==change.newName&&!notified.has(String(change.userId||''))&&!priorSnapshot.has(String(change.userId||''))){
      // A member appearing for the first time is not necessarily a rename.
      continue;
     }
     if(change.profileChanged){
      await sendNotice(ctx,client.chat,room,change);
      console.log('[PROFILE WATCH] profile change delivered',{room});
     }
    }
   }
   roomRetryAt.delete(room);
   }catch(e){
    console.warn('[PROFILE WATCH] room poll failed',{room,error:String(e?.message||e).slice(0,160)});
    roomRetryAt.set(room,now()+(/-401/.test(String(e?.message||e))?300000:15000));
   }
  }catch(e){
   console.warn('[PROFILE WATCH] scheduler failed:',String(e?.message||e).slice(0,160));
   resumeAt=now()+15000;
  }finally{busy=false;}
 }
 function start(){if(timer)return;console.log('[PROFILE WATCH] starting 1s poller');timer=setInterval(()=>tick().catch(e=>console.error('[PROFILE WATCH]',e.message)),1000);timer.unref?.();}
 function stop(){if(timer)clearInterval(timer);timer=null;}
 return {tick,start,stop};
}
module.exports={createWatcher};
