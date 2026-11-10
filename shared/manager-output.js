'use strict';

// A presentation-only compatibility layer. Legacy modules may still use the
// NEXI codename internally, but it must never leak into chatbot text messages.
// Do not rewrite identifiers, incoming commands, PostgreSQL rows or attachments.
const installed=new WeakSet();
const MANAGER='카카오톡 매니저';
function transform(body){
 if(typeof body!=='string')return body;
 return body.replace(/NEXI/gi,MANAGER).replace(/넥시/g,MANAGER);
}
function install(client){
 for(const target of [client?.chat,client]){
  if(!target||installed.has(target)||typeof target.sendText!=='function')continue;
  const original=target.sendText;
  target.sendText=function(roomId,body,...args){
   return original.call(this,roomId,transform(body),...args);
  };
  installed.add(target);
 }
}
module.exports={MANAGER,transform,install};
