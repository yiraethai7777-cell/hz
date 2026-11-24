'use strict';
function isOpenChatRoomManager(ctx){
 const msg=ctx?.msg;
 if(!msg||msg.room?.isOpenChat===false)return false;
 const id=msg.sender?.id??msg.senderId??msg.userId;
 return id!=null&&String(id)===String(ctx.userId)&&[1,4].includes(Number(msg.sender?.type??msg.sender?.memberType));
}
async function role(ctx){
 if(ctx?.isSelf===true||ctx?.isBotAccount===true)return 3;
 if(ctx?.isSuperAdmin===true)return 2;
 const id=String(ctx?.userId??'');
 if([String(process.env.GL_OWNER_ID||''),...String(process.env.HZ_OWNER_IDS||process.env.HZ_OWNER_ID||'').split(/[\s,;]+/)].filter(Boolean).includes(id))return 2;
 if(isOpenChatRoomManager(ctx))return 1;
 const room=String(ctx?.roomId??'');
 if(!/^[1-9]\d{3,24}$/.test(room)||!/^[1-9]\d{3,24}$/.test(id))return 0;
 const db=ctx.db||require('../shared/db').getPool();
 const r=await db.query('SELECT 1 FROM gl_manage_admins WHERE room_id=$1 AND user_id=$2',[room,id]);
 if(r.rowCount)return 1;
 if(ctx.msg?.room?.isOpenChat!==false&&typeof ctx.client?._ensureMemberType==='function'){
  try{
   await ctx.client._ensureMemberType(room,id);
   const verified=ctx.client._resolveMemberType?.(room,id);
   if([1,4].includes(Number(verified)))return 1;
  }catch{}
 }
 return 0;
}
module.exports={role,isOpenChatRoomManager};