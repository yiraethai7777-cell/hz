'use strict';
const {profileNotice}=require('./leave-reply');
function createWatcher(ctx,client){
 let busy=false,timer;
 async function tick(){
  if(busy||typeof client.refreshMemberProfiles!=='function')return;
  busy=true;
  try{
   const joined=typeof client.getKnownChatRooms==='function'?new Set(client.getKnownChatRooms().map(r=>String(r.id))):null;
   const rooms=await ctx.pool.query("SELECT room_id FROM hz_rooms WHERE data->>'manage'='true' AND COALESCE(data->>'locked','false')<>'true' ORDER BY room_id");
   for(const {room_id:room} of rooms.rows){
    if(joined&&!joined.has(String(room)))continue;
    try{
     const members=await client.refreshMemberProfiles(room),observations=[];
     for(const member of members){
      if(member.id===String(ctx.globalBotId)||Number(member.type)===8||!member.name)continue;
      let link;
      if([1,2,4].includes(member.profileType))link='';
      else if(member.profileLinkId&&typeof client.getUserOpenProfileLink==='function'){
       try{const live=await client.getUserOpenProfileLink(room,member.id);if(live)link=ctx.validOpenProfileLink(live)||undefined;}catch{}
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
    }catch(e){console.error('[GL PROFILE WATCH]',String(room),e.message);}
   }
  }finally{busy=false;}
 }
 function start(){if(timer)return;timer=setInterval(()=>tick().catch(e=>console.error('[GL PROFILE WATCH]',e.message)),60000);timer.unref?.();tick().catch(e=>console.error('[GL PROFILE WATCH]',e.message));}
 function stop(){if(timer)clearInterval(timer);timer=null;}
 return {tick,start,stop};
}
module.exports={createWatcher};
