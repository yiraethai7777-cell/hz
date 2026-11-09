'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { serialize } = require('bson');
const wire = require('../shared/voice-room-vox-wire');
const vox = require('../shared/voice-room-vox-transport');

class FakeTls extends EventEmitter {
  constructor({authorized=true,encrypted=true}={}) {
    super();
    this.encrypted=encrypted; this.authorized=authorized; this.destroyed=false; this.writes=[];
  }
  write(buf) { this.writes.push(Buffer.from(buf)); return true; }
  destroy() { if(this.destroyed)return; this.destroyed=true; this.emit('close'); }
}
const target={host:'192.0.2.100',servername:'vox.example.org',
  allowedHosts:['192.0.2.100']};
const fixture=()=>serialize({testValue:1});

test('requires validated IP allowlist, certificate DNS name and numeric control port',()=>{
  assert.deepEqual(vox.validateTarget(target),{
    host:'192.0.2.100',servername:'vox.example.org',port:5228,
  });
  for(const bad of [
    {...target,host:'evil.example.org'},
    {...target,allowedHosts:[]},
    {...target,allowedHosts:['192.0.2.99']},
    {...target,servername:''},
    {...target,servername:'192.0.2.100'},
    {...target,servername:'bad..example.org'},
    {...target,port:99999},
  ])assert.throws(()=>vox.validateTarget(bad));
});

test('TLS socket uses certificate verification and never downgrades TLS',async()=>{
  const socket=new FakeTls();
  let options;
  const channel=await vox.connectTrustedVox(target,{
    tlsConnect:o=>{options=o;queueMicrotask(()=>socket.emit('secureConnect'));return socket;},
  });
  assert.equal(options.rejectUnauthorized,true);
  assert.equal(options.minVersion,'TLSv1.2');
  assert.equal(options.servername,target.servername);
  assert.equal(options.host,target.host);
  assert.equal(options.port,5228);
  assert.deepEqual(socket.writes,[]);
  channel.close();
  assert.equal(socket.destroyed,true);
});

test('rejected certificate or plaintext sockets are never accepted',async()=>{
  const socket=new FakeTls({authorized:false});
  await assert.rejects(()=>vox.connectTrustedVox(target,{
    tlsConnect:()=>{queueMicrotask(()=>socket.emit('secureConnect'));return socket;},
  }),/인증서/);
  assert.equal(socket.destroyed,true);
  assert.throws(()=>new vox.VoxFrameSocket(new FakeTls({encrypted:false})),/인증되지 않은/);
});

test('explicit outbound VOX message uses valid encrypted wire frame',()=>{
  const socket=new FakeTls();
  const channel=new vox.VoxFrameSocket(socket);
  assert.equal(socket.writes.length,0);
  assert.equal(channel.send(wire.METHODS.PING,fixture()),true);
  assert.equal(socket.writes.length,1);
  const p=wire.unpack(socket.writes[0]);
  assert.equal(p.method,wire.METHODS.PING);
  assert.deepEqual(p.payload,fixture());
  channel.close();
  assert.throws(()=>channel.send(wire.METHODS.PING,fixture()),/종료/);
});

test('fragmented and coalesced inbound frames are reconstructed without false login success',()=>{
  const socket=new FakeTls();
  const channel=new vox.VoxFrameSocket(socket);
  const events=[];
  channel.on('frame',data=>events.push(data));
  const p1=wire.pack(wire.METHODS.LOGIN,fixture());
  const p2=wire.pack(wire.METHODS.PING,fixture());
  socket.emit('data',p1.subarray(0,8));
  assert.equal(events.length,0);
  socket.emit('data',Buffer.concat([p1.subarray(8),p2]));
  assert.equal(events.length,2);
  assert.deepEqual(events.map(x=>x.method),[wire.METHODS.LOGIN,wire.METHODS.PING]);
  assert.equal(Object.hasOwn(channel,'authenticated'),false);
  channel.close();
});

test('invalid encrypted frame closes immediately and does not claim success',()=>{
  const socket=new FakeTls();
  const channel=new vox.VoxFrameSocket(socket);
  let failure='';
  let frames=0;
  channel.on('failure',message=>{failure=message;});
  channel.on('frame',()=>{frames++;});
  const bad=Buffer.alloc(12);
  bad.writeUInt32LE(0xffffffff,8);
  socket.emit('data',bad);
  assert.match(failure,/프레임 검증 실패/);
  assert.equal(socket.destroyed,true);
  assert.equal(frames,0);
});

test('TLS handshake error never exposes remote exception internals',async()=>{
  const socket=new FakeTls();
  await assert.rejects(()=>vox.connectTrustedVox(target,{
    tlsConnect:()=>{
      queueMicrotask(()=>socket.emit('error',new Error('secret_session_token')));
      return socket;
    },
  }),err=>!err.message.includes('secret_session_token')&&/TLS 연결 실패/.test(err.message));
  assert.equal(socket.destroyed,true);
});
