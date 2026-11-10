'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const guides=require('../shared/valorant-guides');
const extended=require('../shared/valorant-extended-stats');
const community=require('../shared/valorant-community');

test('valorant command sets are disjoint and include key requested features',()=>{
 const all=[...guides.COMMANDS,...extended.COMMANDS,...community.COMMANDS];
 assert.equal(new Set(all).size,all.length);
 for(const x of ['!발로명령어','!발로비교','!발로랭킹등록','!스킨비교','!요원','!무기','!내전팀짜기','!내전밸런스','!듀오신청'])
  assert.ok(all.includes(x),x);
});
test('scrim balance always yields five participants in each team',()=>{
 const players=Array.from({length:10},(_,i)=>({user_id:String(10+i),display_name:'P'+i,tier:'골드',rating:i*100}));
 for(let i=0;i<10;i++){
  const pair=community.choose(players);
  assert.equal(pair.a.length,5);
  assert.equal(pair.b.length,5);
  assert.equal(new Set([...pair.a,...pair.b].map(x=>x.user_id)).size,10);
  assert.ok(pair.delta<=100);
 }
 assert.equal(community.rating('골드2').value,1100);
 assert.equal(community.rating('다이아몬드3').value,1800);
 assert.equal(community.rating('unknown'),null);
});
test('RR history formats only available provider data',()=>{
 assert.match(extended.historyText([{currenttier_patched:'Gold 2',mmr_change_to_last_game:22,ranking_in_tier:56}]),/\+22 RR/);
 assert.match(extended.historyText([{currenttier_patched:'Gold 2',mmr_change_to_last_game:-18}]),/-18 RR/);
 assert.match(extended.historyText([{}]),/증감 미확인/);
 assert.match(extended.historyText([]),/기록이 없습니다/);
 assert.equal(extended.findRankNumber('다이아몬드 2'),1700);
 assert.equal(extended.findRankNumber('언랭크'),null);
});
test('agent and weapon guides retrieve public catalog, without Riot account',async()=>{
 const sent=[],requests=[];
 const fakeFetch=async url=>{
  requests.push(url);
  if(url.includes('/agents?'))return {ok:true,json:async()=>({data:[{
    displayName:'제트',isPlayableCharacter:true,description:'바람을 이용한 타격대',
    role:{displayName:'타격대'},abilities:[{displayName:'순풍',slot:'Ability1',description:'빠르게 이동'}]
  }]})};
  if(url.includes('/weapons?'))return {ok:true,json:async()=>({data:[{
    displayName:'밴달',shopData:{cost:2900},weaponStats:{magazineSize:25,fireRate:9.75,damageRanges:[{rangeStartMeters:0,rangeEndMeters:50,headDamage:160,bodyDamage:40,legDamage:34}]}
  }]})};
  return {ok:false,status:404};
 };
 await guides.handle({text:'!요원 제트',send:async x=>sent.push(x),fetcher:fakeFetch,userId:'15'});
 await guides.handle({text:'!무기 밴달',send:async x=>sent.push(x),fetcher:fakeFetch,userId:'15'});
 assert.match(sent[0],/순풍/);
 assert.match(sent[1],/2,900/);
 assert.equal(requests.length,2);
});
test('removed Valorant extensions are unreachable from the manager router',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../shared/router.js'),'utf8');
 assert.doesNotMatch(source,/valGuide\.COMMANDS\.has|valCommunity\.COMMANDS\.has|valParty\.COMMANDS\.has/);
 assert.doesNotMatch(source,/require\(['"]\.\/valorant-/);
 assert.match(source,/if\(isRetiredValorantCommand\(text\)\)return/);
});

test('tier registration and exactly ten Kakao mentions create balanced attack and defense teams',async()=>{
 const tiers=new Map(),games=[],sent=[];
 const db={async query(sql,args=[]){
  if(sql.includes('CREATE TABLE'))return {rows:[],rowCount:0};
  if(sql.includes('INSERT INTO hz_valorant_tier_profiles')){
   tiers.set(args[0],{user_id:args[0],tier:args[1],rating:args[2]});
   return {rows:[],rowCount:1};
  }
  if(sql.includes('UPDATE hz_valorant_scrim_players'))return {rows:[],rowCount:0};
  if(sql.includes('FROM hz_valorant_tier_profiles')&&sql.includes('ANY')){
   const rows=args[0].filter(id=>tiers.has(id)).map(id=>tiers.get(id));
   return {rows,rowCount:rows.length};
  }
  if(sql.includes('SELECT id FROM hz_valorant_scrim_games')){
   const rows=games.filter(g=>!g.winner).map((g,i)=>({id:i+1}));
   return {rows,rowCount:rows.length};
  }
  if(sql.includes('INSERT INTO hz_valorant_scrim_games')){
   games.push({a:JSON.parse(args[1]),b:JSON.parse(args[2]),winner:null});
   return {rows:[],rowCount:1};
  }
  if(sql.includes('UPDATE hz_valorant_scrim_games SET winner')){
   const item=games.find(g=>!g.winner);if(!item)return {rows:[],rowCount:0};
   item.winner=args[1];return {rows:[{id:1}],rowCount:1};
  }
  throw Error('unexpected SQL: '+sql);
 }};
 const base={roomId:'44444',db,send:async v=>sent.push(v),userId:'10001',userName:'P1'};
 const mentions=Array.from({length:10},(_,i)=>({userId:String(10001+i),name:'P'+(i+1)}));
 await community.handle({...base,text:'!내전팀짜기 '+mentions.slice(0,9).map(x=>'@'+x.name).join(' '),msg:{mentions:mentions.slice(0,9)}});
 assert.match(sent.at(-1),/9명 \/ 10명/);
 for(let i=0;i<10;i++)await community.handle({...base,text:'!티어등록 '+(i%2?'골드2':'실버2'),userId:mentions[i].userId,userName:mentions[i].name});
 await community.handle({...base,text:'!내전팀짜기 '+mentions.map(x=>'@'+x.name).join(' '),msg:{mentions}});
 assert.equal(games.length,1);
 assert.equal(games[0].a.length,5);
 assert.equal(games[0].b.length,5);
 assert.match(sent.at(-1),/공격팀/);
 assert.match(sent.at(-1),/수비팀/);
 assert.doesNotMatch(sent.at(-1),/\\\\n/);
 await community.handle({...base,text:'!내전결과 공격',senderType:1});
 assert.equal(games[0].winner,'A');
});

test('skin comparison supports comma and pipe separators',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../shared/valorant-guides.js'),'utf8');
 assert.match(source,/tail\.split\(\/\\s\*\[,\|\]\\s\*\//);
 const parse=input=>input.split(/\s*[,|]\s*/);
 assert.deepEqual(parse('약탈자 밴달, 프라임 밴달'),['약탈자 밴달','프라임 밴달']);
 assert.deepEqual(parse('약탈자 밴달 | 프라임 밴달'),['약탈자 밴달','프라임 밴달']);
});
