'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const champions=require('../shared/valorant-champions-music');
test('Supports each official VALORANT Champions anthem from 2021 through 2026',async()=>{
 assert.deepEqual(champions.YEARS,['2021','2022','2023','2024','2025','2026']);
 const matches={
  2021:['Die For You','h7MYJghRWt0'],
  2022:['Fire Again','DqgK4llE1cw'],
  2023:['Ticking Away','CdZN8PI3MqM'],
  2024:['SUPERPOWER','DX4BE9GmpH4'],
  2025:['Last Shot','cLx3tyzht3Y'],
  2026:['If The Sun Burns Out Tonight','x8jAY2CoOBg']
 };
 for(const [year,[title,videoId]] of Object.entries(matches)){
  const sent=[];
  assert.equal(await champions.handle({text:'!챔스노래 '+year,send:async x=>sent.push(x)}),true);
  assert.equal(sent.length,1);
  assert.match(sent[0],new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
  assert.ok(sent[0].includes('https://www.youtube.com/watch?v='+videoId));
  assert.ok(!sent[0].includes('youtube-dl'));
 }
});
test('Rejects missing, unsupported, malformed or extra command arguments',async()=>{
 const tests=['!챔스노래','!챔스노래 2020','!챔스노래 2027','!챔스노래 2024 2025','!챔스노래 24'];
 for(const text of tests){
  const sent=[];
  assert.equal(await champions.handle({text,send:async x=>sent.push(x)}),true);
  assert.match(sent[0],/지원 연도: 2021 \/ 2022 \/ 2023 \/ 2024 \/ 2025 \/ 2026/);
 }
 assert.equal(await champions.handle({text:'!챔스노래2 2024',send:async()=>{throw Error('unexpected')}}),false);
});
test('!챔스노래 is disabled when the room VALORANT switch is OFF',async()=>{
 const routerSource=fs.readFileSync(path.join(__dirname,'../shared/router.js'),'utf8');
 const mod={exports:{}},sent=[],calls=[];
 let messageHandler,enabled=false;
 const client={userId:'bot',onMessage(fn){messageHandler=fn;},
  chat:{sendText:async(room,msg)=>sent.push(msg)}};
 vm.runInNewContext(routerSource,{
  module:mod,exports:mod.exports,console,Promise,Date,String,Number,RegExp,
  require(name){
   if(name==='./help')return {handleExtraMessage:async()=>false};
   if(name==='../game/command-aliases')return {isRetiredLegacyCommand:()=>false,isGameCommand:()=>false};
   if(name==='./unicode-output'||name==='./reply-delete')return {install(){}};
   if(name==='./valorant-settings')return {isEnabled:async()=>enabled};
   if(name==='./valorant-champions-music')return {handle:async args=>{
    calls.push(args.text);await args.send('🎵 음악 링크 전송');return true;
   }};
   throw Error('Unexpected require: '+name);
  }
 },{filename:'shared/router.js'});
 mod.exports.attachRouter(client,{game:{message(){}},management:{message(){}},ready:Promise.resolve()});
 const incoming={room:{id:'123'},sender:{id:'999'},message:{text:'!챔스노래 2024'}};
 await messageHandler(incoming);
 assert.equal(calls.length,0);
 enabled=true;
 await messageHandler(incoming);
 assert.deepEqual(calls,['!챔스노래 2024']);
 assert.deepEqual(sent,['🎵 음악 링크 전송']);
});
