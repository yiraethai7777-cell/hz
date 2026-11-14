'use strict';
// Offline analyzer: consumes only read-only hangUp probe observations.
const fs=require('node:fs');
function summarize(input){
 const methods=new Set();let hangupCalls=0;
 for(const line of String(input).split(/\r?\n/)){
  if(line.length>10000)continue;
  let item;try{const p=line.indexOf('{');if(p<0)continue;item=JSON.parse(line.slice(p))}catch{continue}
  if(item?.source!=='VOX_HANGUP_METADATA_PROBE')continue;
  if(item.event==='hangup_called')hangupCalls++;
  if(item.event==='outgoing_vox_method'&&Number.isInteger(item.method)&&item.method>=1000&&item.method<=65000)methods.add(item.method);
 }
 const observedMethods=[...methods].sort((a,b)=>a-b);
 return {hangupCalls,observedMethods,candidate10004:methods.has(10004),
  verifiedServerHangup:false,
  reason:hangupCalls===0?'No hangUp call observed':observedMethods.length===0?
   'No VOX TLS method observed':'Method numbers cannot prove a valid server hangUp request'};
}
if(require.main===module)process.stdout.write(JSON.stringify(summarize(fs.readFileSync(0,'utf8')),null,2)+'\n');
module.exports={summarize};
