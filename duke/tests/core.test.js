'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCore}=require('../core'),{normalize,id}=require('../kakao');
function setup(){const messages=[];return {messages,core:createCore({allowedRooms:new Set(['1']),send:async(r,t)=>messages.push([r,t]),now:()=>1700000000042,clock:()=>142})};}
const ev=text=>({roomId:'1',userId:'2',text,receivedAt:100});
test('four commands',async()=>{const {core,messages}=setup();for(const c of ['-도움말','-핑','-봇정보','-봇상태'])assert.equal(await core.handle(ev(c)),true);assert.equal(messages.length,4);assert.match(messages[1][1],/응답 : 42ms/);assert.match(messages[2][1],/sUBJvGYi/);assert.match(messages[3][1],/\u200b{1200}/);assert.match(messages[3][1],/오늘 명령어 : 4회\n전체 명령어 : 4회/);assert.doesNotMatch(messages[3][1],/요금|사용료|Hobby/);});
test('old prefix, unknown, other rooms silent',async()=>{const {core,messages}=setup();for(const e of [ev('!핑'),ev('-없는명령'),ev('hello'),{...ev('-핑'),roomId:'3'}])assert.equal(await core.handle(e),false);assert.equal(messages.length,0);});
test('module registration',async()=>{const {core,messages}=setup();core.register({name:'시험',execute:({args})=>args.join(',')});await core.handle(ev('-시험 a b'));assert.equal(messages[0][1],'a,b');});
test('large IDs',()=>{assert.equal(id(9007199254740992),null);assert.deepEqual(normalize({raw:{chatLog:{chatId:'18500479612113742',userId:'123',message:'-핑'}}},100),{roomId:'18500479612113742',userId:'123',text:'-핑',receivedAt:100});});
test('persistent counters',()=>{const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createCounter}=require('../metrics');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-'));try{let now=Date.parse('2026-11-26T14:59:00Z');let c=createCounter({dir,now:()=>now});c.record();c=createCounter({dir,now:()=>now});assert.equal(c.get().total,1);now+=60000;assert.equal(c.get().today,0);c.record();assert.equal(c.get().total,2);}finally{fs.rmSync(dir,{recursive:true,force:true});}});

test('recognition uses monotonic receipt time, not server timestamp or network RTT',async()=>{let output;const core=createCore({clock:()=>142,send:async(r,body)=>{output=body}});for(const [receivedAt,expected] of [[100,'응답 : 42ms'],[141.875,'응답 : 0.125ms']]){assert.equal(await core.handle({...ev('-핑'),receivedAt}),true);assert.ok(output.includes(expected),output);assert.ok(!output.includes('~'));}assert.equal(normalize({receivedAt:55},100).receivedAt,55);});

test('help, info and status use one legacy fold separator before all details; ping stays short',async()=>{const {core,messages}=setup();for(const c of ['-도움말','-봇정보','-봇상태','-핑'])await core.handle(ev(c));const separator='\u200b'.repeat(1200);const checks=[['등록 명령어 : 4개','-핑 : 봇 응답 확인'],['봇 이름 : 듀크봇','제작자 오픈프로필'],['서버 상태 : ONLINE','[ 서버 성능 ]']];for(let i=0;i<3;i++){const pieces=messages[i][1].split(separator);assert.equal(pieces.length,2);assert.ok(pieces[0].includes(checks[i][0]));assert.ok(!pieces[0].includes(checks[i][1]));assert.ok(pieces[1].includes(checks[i][1]));}assert.ok(!messages[3][1].includes(separator));});

test('help separates bot-only, game and management commands',async()=>{const {core,messages}=setup();for(const [name,section] of [['봇끄기','BOT'],['코인지급','BOT'],['인벤','GAME'],['벤','MANAGEMENT'],['삭제감지','OWNER']])core.register({name,section,execute:()=>''});await core.handle(ev('-도움말'));const detail=messages[0][1].split('\u200b'.repeat(1200))[1];assert.match(detail,/\[ 기본 명령어 \][\s\S]*\[ 게임명령어 \][\s\S]*-인벤[\s\S]*\[ 관리명령어 \][\s\S]*-벤[\s\S]*\[ 관리자명령어 \][\s\S]*-삭제감지[\s\S]*\[ 봇계정명령어 \][\s\S]*-봇끄기[\s\S]*-코인지급/);});

test('help output cached and invalidated on registration, with timing excluding content',async()=>{const out=[],logs=[];const core=createCore({send:async(r,t)=>out.push(t),logger:{log:(...a)=>logs.push(a)},now:()=>1700000000000});await core.handle(ev('-도움말'));await core.handle(ev('-도움말'));assert.equal(out[0],out[1]);assert.equal(logs.length,1);assert.match(logs[0][1],/receiveToCoreMs/);assert.match(logs[0][1],/sendAckMs/);core.register({name:'추가',description:'새 명령어',execute:()=>''});await core.handle(ev('-도움말'));assert.match(out.at(-1),/-추가 : 새 명령어/);assert.notEqual(out[0],out.at(-1));});
test('deferred counter batches writes, retains immediate in-memory counts, supports explicit flush',()=>{const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createCounter}=require('../metrics');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-counter-'));try{const keys=[],c=createCounter({dir,deferMs:1000,onPersist:k=>keys.push(k)});c.record();c.record();assert.equal(c.get().total,2);assert.equal(fs.existsSync(path.join(dir,'command-counts.json')),false);c.flush();assert.deepEqual(keys,['command-counts.json']);assert.equal(createCounter({dir}).get().total,2);c.flush();assert.equal(keys.length,1);}finally{fs.rmSync(dir,{recursive:true,force:true});}});

test('help lists developing commands separately without changing their original permissions',async()=>{
 const sent=[],seen=[];
 const core=createCore({send:async(r,t)=>sent.push(t),canExecute:(event,cmd)=>{seen.push(cmd.section);return true;}});
 const {registerVoiceRoom}=require('../manage/voice-room');
 registerVoiceRoom(core,{canManage:()=>false,getAdapter:()=>null});
 core.register({name:'비공개',section:'BOT',hidden:true,developing:true,execute:()=>''});
 core.register({name:'일반관리',section:'MANAGEMENT',execute:()=>''});
 await core.handle(ev('-도움말'));
 const detail=sent[0].split('[ 개발중 명령어 ]');
 assert.equal(detail.length,2);
 for(const name of ['보룸시작','보룸종료','보룸참가','진행자주기','진행자받기','스피커주기','스피커받기']){
  assert(!detail[0].includes('-'+name));
  assert(detail[1].includes('-'+name));
 }
 assert(detail[0].includes('-일반관리'));
 assert(!sent[0].includes('비공개'));
 assert.doesNotMatch(detail[1],/VOX|WebRTC|Keepalive|규격|패킷/i);
 await core.handle(ev('-보룸시작'));
 assert.equal(seen.at(-1),'MANAGEMENT');
 assert.match(sent.at(-1),/관리 권한이 없습니다/);
});
