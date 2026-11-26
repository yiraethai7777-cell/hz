'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCore}=require('../core'),{normalize,id}=require('../kakao');
function setup(){const messages=[];return {messages,core:createCore({allowedRooms:new Set(['1']),send:async(r,t)=>messages.push([r,t]),now:()=>1000,measurePing:async()=>42})};}
const ev=text=>({roomId:'1',userId:'2',text});
test('four commands',async()=>{const {core,messages}=setup();for(const c of ['-도움말','-핑','-봇정보','-봇상태'])assert.equal(await core.handle(ev(c)),true);assert.equal(messages.length,4);assert.match(messages[1][1],/응답 : 42ms/);assert.match(messages[2][1],/sUBJvGYi/);assert.match(messages[3][1],/\u200b{1200}/);assert.match(messages[3][1],/오늘 명령어 : 4회\n전체 명령어 : 4회/);assert.doesNotMatch(messages[3][1],/요금|사용료|Hobby/);});
test('old prefix, unknown, other rooms silent',async()=>{const {core,messages}=setup();for(const e of [ev('!핑'),ev('-없는명령'),ev('hello'),{...ev('-핑'),roomId:'3'}])assert.equal(await core.handle(e),false);assert.equal(messages.length,0);});
test('module registration',async()=>{const {core,messages}=setup();core.register({name:'시험',execute:({args})=>args.join(',')});await core.handle(ev('-시험 a b'));assert.equal(messages[0][1],'a,b');});
test('large IDs',()=>{assert.equal(id(9007199254740992),null);assert.deepEqual(normalize({raw:{chatLog:{chatId:'18500479612113742',userId:'123',message:'-핑'}}}),{roomId:'18500479612113742',userId:'123',text:'-핑'});});
test('persistent counters',()=>{const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createCounter}=require('../metrics');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-'));try{let now=Date.parse('2026-11-26T14:59:00Z');let c=createCounter({dir,now:()=>now});c.record();c=createCounter({dir,now:()=>now});assert.equal(c.get().total,1);now+=60000;assert.equal(c.get().today,0);c.record();assert.equal(c.get().total,2);}finally{fs.rmSync(dir,{recursive:true,force:true});}});

test('ping failure and sub-millisecond RTT',async()=>{for(const [measurePing,expected] of [[async()=>{throw Error('timeout')},'응답 : 측정 실패'],[async()=>0.2,'응답 : <1ms']]){let output;const core=createCore({measurePing,send:async(r,body)=>{output=body}});assert.equal(await core.handle(ev('-핑')),true);assert.ok(output.includes(expected));}});
