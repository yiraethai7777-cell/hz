'use strict';
function accepted(r){
 if(r==null||r===false||r.ok===false||r.success===false)throw Error('Message response missing or rejected');
 for(const value of [r.status,r.body?.status,r.complete?.status,r.complete?.body?.status,r.result?.status,r.result?.body?.status])if(value!=null&&Number(value)!==0)throw Error('Message rejected: '+value);
}
function deadline(job,ms){let timer;return Promise.race([Promise.resolve().then(job),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Message response timeout')),ms);})]).finally(()=>clearTimeout(timer));}
async function run({roomId,sendStart,edit,sendFallback,stages,result,delays,wait,timeoutMs=5000,label='GAME'}){
 if(!edit){await deadline(()=>sendFallback(result),timeoutMs);return 'fallback';}
 try{
  const sent=await deadline(()=>sendStart(stages[0]),timeoutMs);accepted(sent);
  const log=sent?.body?.logId??sent?.logId??sent?.complete?.body?.logId;
  if(log==null||typeof log==='number'&&!Number.isSafeInteger(log)||!/^[1-9]\d*$/.test(String(log)))throw Error('Missing outgoing logId');
  for(let i=1;i<stages.length;i++){await wait(delays[i-1]);accepted(await deadline(()=>edit(String(roomId),String(log),stages[i]),timeoutMs));}
  return 'edited';
 }catch(e){console.warn('[NEXI '+label+' EDIT FALLBACK]',e.code||e.message);await deadline(()=>sendFallback(result),timeoutMs);return 'fallback';}
}
module.exports={run,accepted,deadline};
