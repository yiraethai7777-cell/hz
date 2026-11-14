'use strict';

// Offline VOX method-number inspection. This module NEVER writes to the VOX
// transport, cannot terminate a room, and must not infer hangUp from vr_bye.
// Only independently reviewed client hangUp + matching server-close evidence
// may be displayed as a verified termination method.
const MAX_METHOD=65535;

function findVerifiedHangupMethod(evidence=[]){
  const items=Array.isArray(evidence)?evidence:[];
  const approved=new Map();
  for(const item of items){
    if(!item || !Number.isInteger(item.method) || item.method<1 ||
       item.method>MAX_METHOD || item.method===11009)continue;
    if(item.reviewed!==true || item.recordedClientHangUp!==true ||
       item.sameCallServerByeVerified!==true ||
       item.bsonSchemaVerified!==true)continue;
    approved.set(item.method,true);
  }
  // The order is deliberate and deterministic; no requests are transmitted.
  for(let method=1;method<=MAX_METHOD;method++){
    if(approved.has(method))return method;
  }
  return null;
}

module.exports={findVerifiedHangupMethod};
