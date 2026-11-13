/*
 * Read-only Android VOX hangUp probe.
 * Observe com.kakao.vox.call.VoxCall30Impl.hangUp() and, if dynamically
 * exported, SSL_write() method headers for 3 seconds after the call.
 * NEVER print packet bytes, BSON, identifiers, SDP or credentials.
 * Tested in a mocked Frida runtime; real client hook availability varies.
 */
'use strict';
(function(){
  const source='VOX_HANGUP_METADATA_PROBE';
  let hangupAt=null,seen=0;
  const maxObservations=24,windowMs=3000,observed=new Set();
  const emit=(event,data={})=>{
    try{send({source,event,...data});}catch(_){}
  };
  function installJava(){
    if(typeof Java==='undefined'||!Java.available){
      emit('java_unavailable');return;
    }
    try{Java.perform(function(){
      let klass;
      try{klass=Java.use('com.kakao.vox.call.VoxCall30Impl');}
      catch(_){emit('hangup_class_unavailable');return;}
      const method=klass?.hangUp;
      if(!method||!Array.isArray(method.overloads)){
        emit('hangup_method_unavailable');return;
      }
      let installed=0;
      for(const overload of method.overloads){
        try{
          overload.implementation=function(){
            const originalArgs=Array.prototype.slice.call(arguments);
            hangupAt=Date.now();
            seen=0;
            emit('hangup_called',{argumentCount:originalArgs.length});
            // Call the original; no synthetic hangUp call is generated.
            return overload.call(this,...originalArgs);
          };
          installed++;
        }catch(_){}
      }
      emit('hangup_hook_installed',{overloads:installed});
    });}catch(_){emit('java_hook_unavailable');}
  }
  function inspectHeader(args){
    if(hangupAt===null||Date.now()-hangupAt>windowMs||
       seen>=maxObservations)return;
    try{
      const size=args[2].toInt32();
      if(size<28||size>1024*1024)return;
      const buf=args[1].readByteArray(12);
      if(!buf)return;
      const b=new Uint8Array(buf);
      if(b.length!==12||b[4]!==0||b[5]!==0)return;
      const method=b[6]+(b[7]<<8);
      const bodyLength=(b[8]+b[9]*256+b[10]*65536+b[11]*16777216)>>>0;
      if(method<1000||method>65000||
         bodyLength<16||bodyLength%16!==0||
         bodyLength+12>size)return;
      seen++;
      emit('outgoing_vox_method',{method,frameLength:bodyLength+12});
    }catch(_){}
  }
  function installNative(){
    if(typeof Process==='undefined'||typeof Interceptor==='undefined'||
       typeof Process.enumerateModules!=='function')return 0;
    let count=0;
    try{
      for(const mod of Process.enumerateModules()){
        if(!/(vox|ssl|crypto|boring)/i.test(String(mod.name||'')))continue;
        let exports;
        try{exports=mod.enumerateExports();}catch(_){continue;}
        for(const entry of exports){
          if(!['SSL_write','SSL_write_ex'].includes(entry.name))continue;
          const address=String(entry.address);
          if(observed.has(address))continue;
          try{
            Interceptor.attach(entry.address,{onEnter:inspectHeader});
            observed.add(address);count++;
          }catch(_){}
        }
      }
    }catch(_){}
    return count;
  }
  installJava();
  const initially=installNative();
  emit('ready',{tlsHooks:initially});
  if(!initially && typeof setInterval==='function'){
    // Some VOX libraries load after Frida attaches. Retry without intercepting
    // generic send/write (those would only expose ciphertext or other traffic).
    let attempts=0;
    const interval=setInterval(function(){
      attempts++;
      const installed=installNative();
      if(installed||attempts>=20){
        clearInterval(interval);
        emit(installed?'tls_hook_installed':'tls_hook_unavailable',
          {tlsHooks:installed});
      }
    },1000);
  }
})();
