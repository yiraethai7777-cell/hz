'use strict';
async function send(ctx,result,wait,options={}){
 if(ctx.isArdenClan===true){await ctx.send(result);return 'normal';}
 const owner=typeof ctx.chat?.editMessage==='function'?ctx.chat:typeof ctx.client?.editMessage==='function'?ctx.client:ctx.client?.chat;
 return require('./message-progress').run({roomId:ctx.roomId,sendStart:ctx.send,edit:typeof owner?.editMessage==='function'?owner.editMessage.bind(owner):null,sendFallback:ctx.send,stages:[1,2,3,4,5].map(n=>'⛏ NEXI | 광질중'+'.'.repeat(n)).concat(result),result,delays:[1000,1000,1000,1000,1000],wait,label:'MINING',...options});
}
module.exports={send};
