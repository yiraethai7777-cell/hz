'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const account=require('../shared/valorant-account');
function fakeDb(){
 const data=new Map();
 return {data,async query(sql,params=[]){
  if(sql.includes('CREATE TABLE IF NOT EXISTS'))return {rows:[]};
  if(sql.startsWith('INSERT INTO')){data.set(params[0],{riot_name:params[1],riot_tag:params[2],region:params[3]});return {rows:[],rowCount:1};}
  if(sql.startsWith('SELECT riot_name'))return {rows:data.has(params[0])?[data.get(params[0])]:[]};
  if(sql.startsWith('DELETE FROM')){const count=Number(data.delete(params[0]));return {rows:[],rowCount:count};}
  throw Error('Unexpected SQL: '+sql);
 }};
}
test('!발로저장 persists a per-Kakao-user shortcut, replace and remove are isolated',async()=>{
 const db=fakeDb(),sent=[];
 await account.handle({text:'!발로저장 bsh#3333 kr',userId:'kakao-a',db,send:async x=>sent.push(x),
  env:{VALORANT_APPROVED_PLAYERS:'bsh#3333'}});
 assert.equal((await account.load({db,userId:'kakao-a'})).name,'bsh');
 assert.equal(await account.load({db,userId:'kakao-b'}),null);
 assert.match(sent[0],/!발로전적확인/);
 await account.handle({text:'!발로저장 Other Player#AP1 ap',userId:'kakao-a',db,
  send:async x=>sent.push(x),env:{VALORANT_APPROVED_PLAYERS:'bsh#3333'}});
 assert.equal((await account.load({db,userId:'kakao-a'})).name,'Other Player');
 assert.match(sent[1],/저장만 완료/);
 await account.handle({text:'!발로삭제',userId:'kakao-a',db,send:async x=>sent.push(x)});
 assert.equal(await account.load({db,userId:'kakao-a'}),null);
 assert.match(sent[2],/삭제했습니다/);
});
test('Unapproved saved Riot ID never bypasses stats public-data consent gate',async()=>{
 const db=fakeDb(),sent=[],calls=[];
 await account.handle({text:'!발로저장 Someone#NA2 na',userId:'kakao-private',db,send:async x=>sent.push(x),
  env:{HENRIKDEV_API_KEY:'fake-key'}});
 await account.handle({text:'!발로전적확인',userId:'kakao-private',db,
  send:async x=>sent.push(x),env:{HENRIKDEV_API_KEY:'fake-key'},
  fetcher:async()=>{calls.push('API');throw Error('No request permitted');}});
 assert.equal(calls.length,0);
 assert.match(sent.at(-1),/공개 동의가 확인되지 않은 계정/);
});
test('Approved saved Riot ID invokes existing stats lookup with saved region',async()=>{
 const db=fakeDb(),sent=[],calls=[];
 const env={VALORANT_APPROVED_PLAYERS:'test player#KR1',HENRIKDEV_API_KEY:'fake-key'};
 await account.handle({text:'!발로저장 Test Player#KR1 ap',userId:'kakao-ok',db,env,
  send:async x=>sent.push(x)});
 const fetcher=async(url)=>{
  calls.push(url);
  const data=url.includes('/mmr/')?{account:{puuid:'test-puuid'},current:{tier:{name:'Bronze 1'},rr:17},peak:{tier:{name:'Silver 1'}}}:
   [{metadata:{map:{name:'Haven'},mode:{name:'Competitive'}},players:[{
    name:'Test Player',tag:'KR1',puuid:'test-puuid',team_id:'Red',agent:{name:'Jett'},
    stats:{kills:12,deaths:8,assists:3,headshots:12,bodyshots:24,legshots:4}
   }],teams:[{team_id:'Red',won:true}]}];
  return {ok:true,status:200,json:async()=>({status:200,data})};
 };
 await account.handle({text:'!발로전적확인',userId:'kakao-ok',db,env,fetcher,
  send:async x=>sent.push(x)});
 assert.equal(calls.length,3);
 assert.ok(calls.every(url=>url.includes('/ap/pc/Test%20Player/KR1')));
 assert.match(sent.at(-1),/현재 티어: 브론즈 1/);
 assert.match(sent.at(-1),/Haven/);
});
test('Malformed account IDs and blank Kakao IDs are rejected without writing to DB',async()=>{
 const db=fakeDb(),sent=[];
 for(const text of ['!발로저장','!발로저장 no-tag','!발로저장 X#1 unknown']){
  await account.handle({text,userId:'kakao-bad',db,send:async x=>sent.push(x)});
 }
 assert.equal(db.data.size,0);
 await account.handle({text:'!발로저장 test#NA1',userId:'',db,send:async x=>sent.push(x)});
 assert.equal(db.data.size,0);
});
test('Per-room !발로on gate also protects account save/check/delete commands',async()=>{
 const file=fs.readFileSync(path.join(__dirname,'../shared/router.js'),'utf8');
 const mod={exports:{}};
 let callback,enabled=false;
 const called=[],sent=[];
 const client={userId:'bot',onMessage(fn){callback=fn;},chat:{sendText:async(_room,msg)=>sent.push(msg)}};
 vm.runInNewContext(file,{
  module:mod,exports:mod.exports,console,Promise,Date,String,Number,RegExp,
  require(name){
   if(name==='./help')return {handleExtraMessage:async()=>false};
   if(name==='../game/command-aliases')return {isRetiredLegacyCommand:()=>false,isGameCommand:()=>false};
   if(name==='./unicode-output'||name==='./reply-delete')return {install(){}};
   if(name==='./valorant-settings')return {isEnabled:async()=>enabled};
   if(name==='./valorant-account')return {handle:async args=>{called.push(args.text);await args.send('계정 처리 성공');return true;}};
   throw Error('Unexpected require: '+name);
  }
 },{filename:'shared/router.js'});
 mod.exports.attachRouter(client,{game:{message(){}},management:{message(){}},ready:Promise.resolve()});
 const message=(text)=>({room:{id:'11'},sender:{id:'user-11'},message:{text}});
 for(const cmd of ['!발로저장 bsh#3333','!발로전적확인','!발로삭제'])
  await callback(message(cmd));
 assert.equal(called.length,0);
 enabled=true;
 for(const cmd of ['!발로저장 bsh#3333','!발로전적확인','!발로삭제'])
  await callback(message(cmd));
 assert.deepEqual(called,['!발로저장 bsh#3333','!발로전적확인','!발로삭제']);
 assert.equal(sent.length,3);
});
