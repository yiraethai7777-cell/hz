'use strict';
// Insert a zero-width character between syllables: looks like 구매,
// but the underlying Unicode sequence is different.
const INVISIBLE='\u200b';
const DISPLAY='구'+INVISIBLE+'매';
function transform(value){
 return typeof value==='string'?value.replace(/구매/g,DISPLAY):value;
}
const installed=new WeakSet();
function install(client){
 for(const target of [client?.chat,client]){
  if(!target||typeof target!=='object'||installed.has(target))continue;
  const original=target.sendText;
  if(typeof original!=='function')continue;
  target.sendText=function(roomId,body,...args){
   return original.call(this,roomId,transform(body),...args);
  };
  installed.add(target);
 }
}
module.exports={transform,install};
