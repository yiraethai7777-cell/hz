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
test('existing valorant OFF gate still protects new commands',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../shared/router.js'),'utf8');
 assert.match(source,/valGuide\.COMMANDS\.has\(newValorantCommand\)/);
 assert.match(source,/if\(!enabled\)return/);
 assert.match(source,/!발로명령어/);
});
