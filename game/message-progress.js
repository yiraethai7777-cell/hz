'use strict';
function accepted(r){
 if(Array.isArray(r)){if(!r.length)throw Error('Empty message response');for(const item of r)accepted(item);return;}
 if(r==null||r===false||r.ok===false||r.success===false)throw Error('Message response missing or rejected');
 for(const value of [r.status,r.body?.status,r.complete?.status,r.complete?.body?.status,r.result?.status,r.result?.body?.status])if(value!=null&&Number(value)!==0){const e=Error('Message rejected: '+value);e.statusCode=Number(value);throw e;}
}
function deadline(job,ms){let timer;return Promise.race([Promise.resolve().then(job),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Message response timeout')),ms);})]).finally(()=>clearTimeout(timer));}
const throttled=e=>e?.statusCode===-303||/status=-303|rejected: -303/.test(e?.message||'');
async function run({roomId,sendStart,edit,sendFallback,stages,result,delays,wait,timeoutMs=5000,label='GAME'}){
 let log;
 const change=text=>deadline(()=>edit(String(roomId),String(log),text,{deadlineAt:Date.now()+timeoutMs}),timeoutMs);
 const fallback=async()=>{for(let attempt=0;;attempt++){try{const response=await deadline(()=>sendFallback(result),timeoutMs);if(response!==undefined)accepted(response);return 'fallback';}catch(e){if(attempt||!throttled(e))throw e;await wait(1600);}}};
 if(!edit)return fallback();
 try{
  const sent=await deadline(()=>sendStart(stages[0]),timeoutMs);accepted(sent);
  log=sent?.body?.logId??sent?.logId??sent?.complete?.body?.logId;
  if(log==null||typeof log==='number'&&!Number.isSafeInteger(log)||!/^[1-9]\d*$/.test(String(log)))throw Error('Missing outgoing logId');
  for(let i=1;i<stages.length;i++){await wait(delays[i-1]);accepted(await change(stages[i]));}
  return 'edited';
 }catch(e){
  console.warn('[NEXI '+label+' EDIT FALLBACK]',e.code||e.message);
  // A confirmed rate rejection can retry only the final result. Never replay a
  // timed-out progress edit: it may still be in flight.
  if(log&&throttled(e)){await wait(1600);try{accepted(await change(stages.at(-1)));return 'edited';}catch(retry){console.warn('[NEXI '+label+' FINAL RETRY]',retry.code||retry.message);}}
  return fallback();
 }
}
module.exports={run,accepted,deadline};
