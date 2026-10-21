'use strict';
const delivery=require('./profile-delivery');
function createWatcher(ctx,client,{now=Date.now}={}){
 let busy=false,timer,cursor=0,verified=false,resumeAt=0,roomRefreshAt=0,stopped=false,listening=true;
 const diagnostics=new Map();
 function log(event,details={},level='log'){
  console[level]('[NEXUS PROFILE WATCH] '+event,JSON.stringify(details));
 }
 function limited(event,details={}){
  const key=event+JSON.stringify(details);
  if(!diagnostics.has(key)||now()-diagnostics.get(key)>=300000){log(event,details);diagnostics.set(key,now());}
 }
 // Give the main chat connection time to recover before any background requests.
 const disconnected=()=>{resumeAt=now()+600000;roomRefreshAt=0;log('paused for 10 minutes after disconnect');};
 const connected=()=>{roomRefreshAt=0;log('connection restored',{resumeAt});};
 client.on?.('disconnected',disconnected);
 client.on?.('connected',connected);
 const profileIds=new Map(),retryAt=new Map(),linkCheckedAt=new Map(),roomRetry=new Map();
 async function tick(){
  if(busy)return;
  if(stopped)return;
  if(typeof client.refreshMemberProfiles!=='function'){limited('skipped: refreshMemberProfiles unsupported');return;}
  if(client.connected===false){limited('skipped: disconnected');return;}
  if(now()<resumeAt){limited('skipped: reconnect cooldown',{resumeAt});return;}
  busy=true;
  try{
   if(typeof client.getChatRooms==='function'&&now()>=roomRefreshAt){
    roomRefreshAt=now()+300000;
    log('room refresh started');
    try{await client.getChatRooms();log('room refresh succeeded');}
    catch(e){log('room refresh failed',{error:e.message},'error');}
   }
   let joined,rooms;
   try{
    joined=typeof client.getKnownChatRooms==='function'?new Set(client.getKnownChatRooms().map(r=>String(r.id))):null;
    rooms=await ctx.pool.query("SELECT room_id FROM hz_rooms WHERE data->>'manage'='true' AND COALESCE(data->>'locked','false')<>'true' ORDER BY room_id");
   }catch(e){log('room list failed',{error:e.message},'error');return;}
   const eligible=rooms.rows.filter(r=>!joined||joined.has(String(r.room_id)));
   limited('room list succeeded',{managed:rooms.rows.length,known:joined?.size??null,eligible:eligible.length});
   if(!eligible.length)return;
   
    // 한 번에 최대 2개 방을 순서대로 검사
    const count = Math.min(2, eligible.length);
    const selected = [];

    for (let i = 0; i < count; i++) {
      selected.push(eligible[cursor % eligible.length]);
      cursor++;
    }

    for (const {room_id:room} of selected) {
    if(stopped||client.connected===false||now()<resumeAt)break;
    if(now()<(roomRetry.get(String(room))||0))continue;
    let stage='baseline read';
    try{
     const saved=await ctx.pool.query('SELECT user_id,name,observed_profile_name,last_profile_url,observed_open_profile_link FROM hz_members WHERE room_id=$1',[room]);
     const previous=new Map(saved.rows.map(m=>[String(m.user_id),m]));
     log('member refresh started',{roomId:String(room)});
     stage='member refresh';
     const members=await client.refreshMemberProfiles(room),observations=[];
     if(stopped||client.connected===false||now()<resumeAt)break;
     if(!Array.isArray(members))throw new Error('Invalid member refresh result');
     log('member refresh succeeded',{roomId:String(room),members:members.length});
     if(!members.length){limited('empty member list',{roomId:String(room)});continue;}
     stage='profile observation';
     let lookups=0;
     for(const member of members){
      if(stopped||client.connected===false||now()<resumeAt)break;
      if(member.id===String(ctx.globalBotId)||Number(member.type)===8||!member.name)continue;
      let link;
      const key=String(room)+':'+member.id,old=previous.get(member.id);
      if([1,2,4].includes(member.profileType)){link='';profileIds.delete(key);}
      else if(member.profileLinkId&&typeof client.getUserOpenProfileLink==='function'){
       const needs=profileIds.get(key)!==member.profileLinkId||!old?.observed_open_profile_link||old.name!==member.name||old.last_profile_url!==member.imageUrl||now()-(linkCheckedAt.get(key)||0)>=300000;
       if(!needs)link=old.observed_open_profile_link;
       else if(lookups<5&&now()>=(retryAt.get(key)||0)){
        lookups++;
        try{const live=await client.getUserOpenProfileLink(room,member.id);link=ctx.validOpenProfileLink(live)||undefined;}catch(e){log('open profile lookup failed',{roomId:String(room),error:e.message},'error');}
        if(link){profileIds.set(key,member.profileLinkId);linkCheckedAt.set(key,now());retryAt.delete(key);}else retryAt.set(key,now()+300000);
        await new Promise(resolve=>setTimeout(resolve,200));
       }
      }
      observations.push({...member,link});
     }
     await ctx.withRoom(room,'',async(d,c)=>{
      if(stopped||client.connected===false||now()<resumeAt||!d.manage||d.locked)return [];
      const current=await c.query('SELECT user_id,observed_profile_name,last_profile_url,observed_open_profile_link FROM hz_members WHERE room_id=$1',[room]);
      const latest=new Map(current.rows.map(m=>[String(m.user_id),m]));
      const result=[];
      for(const m of observations){
       const before=previous.get(String(m.id)),after=latest.get(String(m.id));
       // A chat observation may have committed while the network request was in flight.
       // Leave its newer baseline intact and fetch again on the next cycle.
       if(Boolean(before)!==Boolean(after)||['observed_profile_name','last_profile_url','observed_open_profile_link'].some(k=>before?.[k]!==after?.[k])){
        limited('stale observation skipped',{roomId:String(room)});continue;
       }
       const change=await ctx.profileObserve(c,room,m.id,m.name,m.imageUrl,m.link);
       if(m.link!==undefined)await c.query('UPDATE hz_members SET open_profile_link=$3 WHERE room_id=$1 AND user_id=$2',[room,m.id,m.link||null]);
       if(change)result.push(change);
      }
      return result;
     });
     roomRetry.delete(String(room));
     if(!verified){console.log('[NEXUS PROFILE WATCH] live member refresh verified');verified=true;}
    }catch(e){roomRetry.set(String(room),now()+60000);log(stage+' failed',{roomId:String(room),error:e.message},'error');}
    finally{if(!stopped&&client.connected!==false&&now()>=resumeAt)try{await delivery.drain(ctx,room);}catch(e){log('notification queue failed',{roomId:String(room),error:e.message},'error');}}
   }
  }finally{busy=false;}
 }
 function start(){if(timer){log('already started');return;}stopped=false;if(!listening){client.on?.('disconnected',disconnected);client.on?.('connected',connected);listening=true;}log('started',{intervalMs:15000,roomsPerTick:2,refreshSupported:typeof client.refreshMemberProfiles==='function',connected:client.connected??null});timer=setInterval(()=>tick().catch(e=>log('tick failed',{error:e.message},'error')),15000);timer.unref?.();tick().catch(e=>log('tick failed',{error:e.message},'error'));}
 function stop(){stopped=true;if(timer)clearInterval(timer);timer=null;client.removeListener?.('disconnected',disconnected);client.removeListener?.('connected',connected);listening=false;}
 return {tick,start,stop};
}
module.exports={createWatcher};
