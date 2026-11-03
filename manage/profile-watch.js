'use strict';
const {refresh}=require('../shared/live-roster');
const {sendNotice}=require('./profile-alerts');
// One-second scheduler; at most one room is queried per tick. Additional
// rooms are round-robined. No overlap, and back off after transport failures.
function createWatcher(ctx,client,{now=Date.now}={}){
 let busy=false,timer,cursor=0,rooms=[],lastRoomsAt=0,resumeAt=0;
 const profileIds=new Map(),retryAt=new Map(),observed=new Map();
 client.on?.('disconnected',()=>{resumeAt=now()+60000;console.warn('[PROFILE WATCH] paused after disconnect');});
 async function tick(){
  if(busy||now()<resumeAt||client.connected===false)return;
  busy=true;
  try{
   if(now()-lastRoomsAt>15000){
    const joined=typeof client.getKnownChatRooms==='function'?new Set(client.getKnownChatRooms().map(r=>String(r.id))):null;
    const result=await ctx.pool.query("SELECT room_id FROM hz_rooms WHERE COALESCE(data->>'profileAlerts','true')='true' AND COALESCE(data->>'locked','false')<>'true' AND (data->>'manage'='true' OR room_id IN (SELECT room_id FROM gl_room_portals WHERE enabled)) ORDER BY room_id");
    rooms=result.rows.map(r=>String(r.room_id)).filter(r=>!joined||joined.has(r));
    lastRoomsAt=now();
   }
   if(!rooms.length)return;
   const room=rooms[cursor++%rooms.length];
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
   for(const change of (baseline?[]:changes)){
    if(change.oldName!==change.newName){
     await ctx.send(ctx.globalChat,room,'✏️ '+change.oldName+' → '+change.newName);
    }
    if(change.profileChanged){
     await sendNotice(ctx,ctx.globalChat,room,{...change,newName:change.newName});
    }
   }
  }catch(e){
   console.warn('[PROFILE WATCH] poll failed:',String(e?.message||e).slice(0,160));
   resumeAt=now()+15000;
  }finally{busy=false;}
 }
 function start(){if(timer)return;timer=setInterval(()=>tick().catch(e=>console.error('[PROFILE WATCH]',e.message)),1000);timer.unref?.();}
 function stop(){if(timer)clearInterval(timer);timer=null;}
 return {tick,start,stop};
}
module.exports={createWatcher};
