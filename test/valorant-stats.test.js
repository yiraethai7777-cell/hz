'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const valorant=require('../shared/valorant-stats');

const MMRS={
 status:200,data:{
  account:{name:'Demo User',tag:'KR1',puuid:'demo-puuid'},
  current:{tier:{name:'Diamond 2'},rr:77},
  peak:{tier:{name:'Ascendant 1'}}
 }
};
const MATCHES={status:200,data:[
 {metadata:{map:{name:'Haven'},mode:{name:'Competitive'}},
  players:[{name:'Demo User',tag:'KR1',puuid:'demo-puuid',team_id:'Red',agent:{name:'Jett'},
    stats:{kills:20,deaths:12,assists:4,headshots:20,bodyshots:60,legshots:20}}],
  teams:[{team_id:'Red',won:true}]},
 {metadata:{map:{name:'Ascent'},mode:{name:'Competitive'}},
  players:[{name:'Demo User',tag:'KR1',puuid:'demo-puuid',team_id:'Blue',agent:{name:'Omen'},
    stats:{kills:10,deaths:20,assists:6,headshots:15,bodyshots:70,legshots:15}}],
  teams:[{team_id:'Blue',won:false}]}
]};

function fetchMock(calls){
 return async(url,options)=>{
  calls.push({url,authorization:options.headers.Authorization});
  return {ok:true,status:200,json:async()=>url.includes('/mmr/')?MMRS:MATCHES};
 };
}
test('Riot ID parsing accepts spaces and server affinity but rejects malformed input',()=>{
 assert.deepEqual(valorant.parse('!전적 Demo User#KR1 ap'),{
  cmd:'!전적',name:'Demo User',tag:'KR1',region:'ap',player:'demo user#kr1'
 });
 assert.equal(valorant.parse('!티어 Player#KR1').region,'kr');
 assert.ok(valorant.parse('!전적 Demo').error);
 assert.equal(valorant.parse('!헤드샷').usage,true);
 assert.equal(valorant.parse('!알수없음 Player#KR1'),null);
});
test('MMR rank and RR, weighted headshot rate and matches are calculated',()=>{
 const p=valorant.mmr(MMRS.data);
 assert.equal(p.current,'다이아몬드 2');
 assert.equal(p.peak,'초월자 1');
 assert.equal(p.rr,77);
 const stats=valorant.aggregate(MATCHES.data,'Demo User','KR1','demo-puuid');
 assert.equal(stats.count,2);
 assert.equal(stats.wins,1);
 assert.equal(stats.losses,1);
 assert.equal(stats.winrate,50);
 assert.equal(stats.hs,17.5);
 assert.equal(stats.totalKills,30);
 assert.match(valorant.format('!전적',{name:'Demo User',tag:'KR1',region:'kr'},p,stats),/헤드샷률: 17.5%/);
 assert.match(valorant.format('!최근전적',{name:'Demo User',tag:'KR1',region:'kr'},null,stats),/1\. 🟢 승리/);
});
test('Unknown users, unknown outcomes and absent shots do not produce fabricated win/HS rates',()=>{
 const stats=valorant.aggregate([
  {players:[{name:'Demo User',tag:'KR1',team_id:'Blue',stats:{kills:12,deaths:9,assists:3}}],
   metadata:{map:{name:'Lotus'}},teams:[]}
 ],'Demo User','KR1','');
 assert.equal(stats.winrate,null);
 assert.equal(stats.hs,null);
 assert.match(valorant.format('!전적',{name:'Demo User',tag:'KR1',region:'kr'},null,stats),/헤드샷률: 확인 불가/);
});
test('No opt-in means no API request, regardless of apparent Riot ID',async()=>{
 const calls=[],sent=[];
 await valorant.handle({text:'!전적 Demo User#KR1',roomId:'1',userId:'91',
  env:{HENRIKDEV_API_KEY:'test-key'},
  fetcher:fetchMock(calls),send:async s=>sent.push(s)});
 assert.equal(calls.length,0);
 assert.match(sent[0],/공개 동의/);
});
test('API key missing returns actionable configuration notice',async()=>{
 const sent=[];
 await valorant.handle({text:'!전적 Demo User#KR1',roomId:'1',userId:'92',
  env:{VALORANT_APPROVED_PLAYERS:'Demo User#KR1'},
  send:async s=>sent.push(s)});
 assert.match(sent[0],/HENRIKDEV_API_KEY/);
});
test('All five commands produce scoped data from mocked provider API',async()=>{
 const actions=['!전적','!티어','!최근전적','!승률','!헤드샷'];
 const outputs=[],calls=[];
 for(let i=0;i<actions.length;i++){
  const sent=[];
  const handled=await valorant.handle({
   text:actions[i]+' Demo User#KR1',roomId:'55',userId:String(600+i),
   env:{VALORANT_APPROVED_PLAYERS:'Demo User#KR1',HENRIKDEV_API_KEY:'test-key'},
   fetcher:fetchMock(calls),send:async s=>sent.push(s)
  });
  assert.equal(handled,true);
  assert.equal(sent.length,1);
  outputs.push(sent[0]);
 }
 assert.match(outputs[0],/다이아몬드 2/);
 assert.match(outputs[0],/50.0%/);
 assert.match(outputs[1],/77/);
 assert.match(outputs[2],/Haven/);
 assert.match(outputs[3],/1승 1패/);
 assert.match(outputs[4],/17.5%/);
 assert.equal(calls.length,3,'MMR, competitive and all-mode matches are cached across commands');
 assert.ok(calls.some(c=>c.url.includes('mode=competitive&size=20')));
 assert.ok(calls.some(c=>c.url.endsWith('?size=20')));
 assert.ok(calls.every(c=>c.authorization==='test-key'));
});
test('Router recognizes VALORANT commands before waiting for game initialization',async()=>{
 const file=fs.readFileSync(path.join(__dirname,'../shared/router.js'),'utf8');
 const mod={exports:{}};
 let handler;
 const sent=[],calls=[];
 const client={userId:'99999',onMessage(fn){handler=fn;},
  chat:{sendText:async(room,body)=>sent.push(body)}};
 vm.runInNewContext(file,{
  module:mod,exports:mod.exports,console,Promise,Date,String,Number,RegExp,
  require(name){
   if(name==='./help')return {handleExtraMessage:async()=>false};
   if(name==='../game/command-aliases')return {isRetiredLegacyCommand:()=>false,isGameCommand:()=>false};
   if(name==='./unicode-output'||name==='./reply-delete')return {install(){}};
   if(name==='./valorant-stats')return {handle:async args=>{calls.push(args.text);await args.send('발로란트 응답 테스트');return true;}};
   throw Error('Unexpected require: '+name);
  }
 },{filename:'shared/router.js'});
 mod.exports.attachRouter(client,{
  game:{message:()=>{throw Error('Game handler reached');}},
  management:{message:()=>{throw Error('Management handler reached');}},
  ready:new Promise(()=>{})
 });
 await handler({room:{id:'7'},sender:{id:'21'},message:{text:'!발로전적 Player#KR1'}});
 assert.deepEqual(calls,['!발로전적 Player#KR1']);
 assert.deepEqual(sent,['발로란트 응답 테스트']);
});

test('!발로전적 responds with tier RR win rate headshots KDA and recent results together',async()=>{
 const calls=[],sent=[];
 assert.equal(valorant.parse('!발로전적 Demo User#KR1').cmd,'!발로전적');
 const handled=await valorant.handle({
  text:'!발로전적 Demo User#KR1',
  roomId:'77',userId:'7777771',
  env:{HENRIKDEV_API_KEY:'test-key',VALORANT_APPROVED_PLAYERS:'Demo User#KR1'},
  fetcher:fetchMock(calls),send:async body=>sent.push(body)
 });
 assert.equal(handled,true);
 assert.equal(sent.length,1);
 for(const value of ['🎯 NEXI | VALORANT','다이아몬드 2','77','초월자 1','50.0%','17.5%','30/32/10','Haven','Ascent'])
  assert.ok(sent[0].includes(value),value);
 assert.ok(calls.some(c=>c.url.includes('/v3/mmr/')));
 assert.ok(calls.some(c=>c.url.includes('/v4/matches/')));
});

test('!발로전적 lists 20 recent games across all modes and keeps competitive stats separate',async()=>{
 const calls=[],replies=[];
 const player=(i)=>({
  name:'Recent Tester',tag:'KR2',puuid:'recent-puuid',team_id:'Red',
  agent:{name:i%2?'Jett':'Omen'},
  stats:{kills:10+i,deaths:8,assists:4,headshots:10,bodyshots:30,legshots:10}
 });
 const makeMatch=(i,mode)=>({
  metadata:{map:{name:'Map'+i},mode:{name:mode}},
  players:[player(i)],teams:[{team_id:'Red',won:i%2===0}]
 });
 const competitive=Array.from({length:20},(_,i)=>makeMatch(i,'Competitive'));
 const mixed=Array.from({length:23},(_,i)=>makeMatch(i,i%2?'Deathmatch':'Competitive'));
 const fetcher=async url=>{
  calls.push(url);
  const data=url.includes('/mmr/')?{
   account:{puuid:'recent-puuid'},current:{tier:{name:'Gold 3'},rr:19},
   peak:{tier:{name:'Platinum 1'}}
  }:url.includes('mode=competitive')?competitive:mixed;
  return {ok:true,status:200,json:async()=>({status:200,data})};
 };
 await valorant.handle({
  text:'!발로전적 Recent Tester#KR2',roomId:'1',userId:'87670002',
  env:{HENRIKDEV_API_KEY:'fake-key',VALORANT_APPROVED_PLAYERS:'Recent Tester#KR2'},
  fetcher,send:async x=>replies.push(x)
 });
 assert.equal(replies.length,1);
 const output=replies[0];
 assert.match(output,/최근 경쟁전 20경기/);
 assert.match(output,/승패: 10승 10패/);
 assert.match(output,/📋 최근 경기 \(최대 20경기 · 전체 모드\)/);
 assert.match(output,/1\. 🟢 승리 · \[경쟁전\] Map0/);
 assert.match(output,/2\. 🔴 패배 · \[데스매치\] Map1/);
 assert.match(output,/20\. 🔴 패배 · \[데스매치\] Map19/);
 assert.doesNotMatch(output,/21\. /);
 assert.doesNotMatch(output,/Map20|Map21|Map22/);
 assert.equal((output.match(/\n\d+\. /g)||[]).length,20);
 assert.ok(calls.some(url=>url.includes('mode=competitive&size=20')));
 assert.ok(calls.some(url=>url.endsWith('?size=20')));
 assert.equal(calls.length,3);
});
