'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,
  '../experiments/voice-room/frida-vox-hangup-metadata.js'),'utf8');
function setup(overrides={}){
  const sent=[],hooks=[];
  const ov={call(_instance,...args){return args[0]===0?'original-result':'other';}};
  const ssl={name:'libssl.so',enumerateExports:()=>[
    {name:'SSL_write',address:{toString:()=> 'ssl-write-address'}}]};
  const ctx={
    send:record=>sent.push(record),
    Java:{available:true,perform:cb=>cb(),use:()=>({hangUp:{overloads:[ov]}})},
    Process:{enumerateModules:()=>[ssl]},
    Interceptor:{attach:(_address,callbacks)=>hooks.push(callbacks)},
    setInterval:()=>1,clearInterval:()=>{},
    ...overrides,
  };
  vm.runInNewContext(src,ctx,{timeout:2000});
  return {sent,hooks,ov};
}
function packet(method,payloadLength=16){
  const p=Buffer.alloc(12+payloadLength);
  p.writeUInt16LE(method,6);
  p.writeUInt32LE(payloadLength,8);
  // Return only a mock binary frame; probe must NOT emit it.
  return {readByteArray:(n)=>p.buffer.slice(p.byteOffset,p.byteOffset+n)};
}
test('Frida VOX hangUp probe does not invoke or log a hangup by itself',()=>{
  const {sent,hooks}=setup();
  assert.deepEqual(sent.map(x=>x.event),['hangup_hook_installed','ready']);
  assert.equal(hooks.length,1);
  assert.equal(sent[1].tlsHooks,1);
});
test('records only protocol method numbers in brief window after original hangUp',()=>{
  const {sent,hooks,ov}=setup();
  assert.equal(ov.implementation.call({private:'secret'},0),'original-result');
  const outgoing={};
  outgoing[1]=packet(10004);
  outgoing[2]={toInt32:()=>28};
  hooks[0].onEnter(outgoing);
  const hit=sent.find(x=>x.event==='outgoing_vox_method');
  assert.equal(hit.method,10004);
  assert.equal(hit.frameLength,28);
  assert.equal(sent.find(x=>x.event==='hangup_called').argumentCount,1);
  assert.ok(!JSON.stringify(sent).includes('secret'));
  assert.ok(!JSON.stringify(sent).includes('token'));
});
test('does not collect method before original hangUp or from invalid framing',()=>{
  const {sent,hooks,ov}=setup();
  hooks[0].onEnter({1:packet(10004),2:{toInt32:()=>28}});
  assert.equal(sent.filter(x=>x.event==='outgoing_vox_method').length,0);
  ov.implementation.call(null,0);
  hooks[0].onEnter({1:packet(10004),2:{toInt32:()=>10}});
  hooks[0].onEnter({1:{readByteArray:()=>Buffer.alloc(12)},2:{toInt32:()=>28}});
  assert.equal(sent.filter(x=>x.event==='outgoing_vox_method').length,0);
});
test('when dynamic TLS symbols are unavailable, probe reports read-only limitation',()=>{
  const {sent}=setup({Process:{enumerateModules:()=>[]},
    setInterval:()=>1,clearInterval:()=>{}});
  assert.equal(sent.find(x=>x.event==='ready').tlsHooks,0);
  assert.equal(sent.some(x=>x.event==='outgoing_vox_method'),false);
});
