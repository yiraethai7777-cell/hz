'use strict';
function accepted(r){const status=r?.status??r?.body?.status??r?.complete?.status;if(r===false||r?.ok===false||r?.success===false||(status!=null&&Number(status)!==0))throw Error('Message update rejected');}
async function send(ctx,result,wait){
 const owner=typeof ctx.chat?.editMessage==='function'?ctx.chat:typeof ctx.client?.editMessage==='function'?ctx.client:ctx.client?.chat;
 if(typeof owner?.editMessage!=='function'){await ctx.send(result);return 'fallback';}
 try{
  const sent=await ctx.send('⛏ NEXI | 광질중.');accepted(sent);
  const log=sent?.body?.logId??sent?.logId;
  if(log==null||String(log)==='0')throw Error('Missing mining progress logId');
  for(const dots of ['..','...']){await wait(700);accepted(await owner.editMessage(String(ctx.roomId),log,'⛏ NEXI | 광질중'+dots));}
  await wait(700);accepted(await owner.editMessage(String(ctx.roomId),log,result));return 'edited';
 }catch(e){console.warn('[NEXI MINING EDIT]',e.code||e.message);await ctx.send(result);return 'fallback';}
}
module.exports={send};
