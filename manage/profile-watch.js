'use strict';
const {profileNotice}=require('./leave-reply');
function createWatcher(ctx,client,{now=Date.now}={}){
 let busy=false,timer,cursor=0,verified=false,resumeAt=0;
 // Give the main chat connection time to recover before any background requests.
 client.on?.('disconnected',()=>{resumeAt=now()+600000;console.warn('[NEXUS PROFILE WATCH] paused for 10 minutes after disconnect');});
 const profileIds=new Map(),retryAt=new Map();
 async function tick(){
  if(busy||now()<resumeAt||client.connected===false||typeof client.refreshMemberProfiles!=='function')return;
  busy=true;
  try{
   const joined=typeof client.getKnownChatRooms==='function'?new Set(client.getKnownChatRooms().map(r=>String(r.id))):null;
   const rooms=await ctx.pool.query("SELECT room_id FROM hz_rooms WHERE data->>'manage'='true' AND COALESCE(data->>'locked','false')<>'true' ORDER BY room_id");
   const eligible=rooms.rows.filter(r=>!joined||joined.has(String(r.room_id)));
   if(!eligible.length)return;
   
    // 한 번에 최대 2개 방을 순서대로 검사
    const count = Math.min(2, eligible.length);
    const selected = [];

    for (let i = 0; i < count; i++) {
      selected.push(eligible[cursor % eligible.length]);
      cursor++;
    }

    for (const {room_id:room} of selected) {

    try{
     const members=await client.refreshMemberProfiles(room),observations=[];
     const saved=await ctx.pool.query('SELECT user_id,name,last_profile_url,observed_open_profile_link FROM hz_members WHERE room_id=$1',[room]);
     const previous=new Map(saved.rows.map(m=>[String(m.user_id),m]));let lookups=0;
     for(const member of members){
      if(member.id===String(ctx.globalBotId)||Number(member.type)===8||!member.name)continue;
      let link;
      const key=String(room)+':'+member.id,old=previous.get(member.id);
      if([1,2,4].includes(member.profileType)){link='';profileIds.delete(key);}
      else if(member.profileLinkId&&typeof client.getUserOpenProfileLink==='function'){
       const needs=profileIds.get(key)!==member.profileLinkId||!old?.observed_open_profile_link||old.name!==member.name||old.last_profile_url!==member.imageUrl;
       if(!needs)link=old.observed_open_profile_link;
       else if(lookups<5&&Date.now()>=(retryAt.get(key)||0)){
        lookups++;
        try{const live=await client.getUserOpenProfileLink(room,member.id);link=ctx.validOpenProfileLink(live)||undefined;}catch{}
        if(link){profileIds.set(key,member.profileLinkId);retryAt.delete(key);}else retryAt.set(key,Date.now()+300000);
        await new Promise(resolve=>setTimeout(resolve,200));
       }
      }
      observations.push({...member,link});
     }
     const changes=await ctx.withRoom(room,'',async(d,c)=>{
      if(!d.manage||d.locked)return [];
      const result=[];
      for(const m of observations){
       const change=await ctx.profileObserve(c,room,m.id,m.name,m.imageUrl,m.link);
       if(m.link!==undefined)await c.query('UPDATE hz_members SET open_profile_link=$3 WHERE room_id=$1 AND user_id=$2',[room,m.id,m.link||null]);
       if(change)result.push(change);
      }
      return result;
     });
     for(const change of changes)await ctx.send(ctx.globalChat,room,profileNotice(change,ctx.nowK()));
     if(!verified){console.log('[NEXUS PROFILE WATCH] live member refresh verified');verified=true;}
    }catch(e){console.error('[NEXUS PROFILE WATCH]',String(room),e.message);}
   }
  }finally{busy=false;}
 }
 function start(){if(timer)return;timer=setInterval(()=>tick().catch(e=>console.error('[NEXUS PROFILE WATCH]',e.message)),15000);timer.unref?.();}
 function stop(){if(timer)clearInterval(timer);timer=null;}
 return {tick,start,stop};
}
module.exports={createWatcher};
