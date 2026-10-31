'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {PNG}=require('pngjs');
const skins=require('../shared/valorant-skin');
const photos=require('../shared/valorant-skin-image');
const URL_BASE='https://media.valorant-api.com/';
const image=name=>URL_BASE+name+'/displayicon.png';
const color=name=>URL_BASE+'weaponskinchromas/'+name+'/fullrender.png';
function skin(id,name,tiers='premium'){
 return {
  uuid:id,displayName:name,contentTierUuid:tiers,
  displayIcon:image('weaponskins/'+id),
  levels:[
   {displayName:name+' Level 1',displayIcon:image('weaponskinlevels/'+id+'-base'),levelItem:null},
   {displayName:name+' Level 2',displayIcon:image('weaponskinlevels/'+id+'-up'),levelItem:'EEquippableSkinLevelItem::VFX'},
   {displayName:name+' Level 3',displayIcon:image('weaponskinlevels/'+id+'-final'),levelItem:'EEquippableSkinLevelItem::Finisher'}
  ],
  chromas:[
   {displayName:'기본',fullRender:color(id+'-default')},
   {displayName:'보라',fullRender:color(id+'-purple')},
   {displayName:'빨강',fullRender:color(id+'-red')},
   {displayName:'파랑',fullRender:color(id+'-blue')}
  ]
 };
}
const KO=[skin('a','싱귤래리티 밴달'),skin('b','싱귤래리티 팬텀'),skin('c','약탈자 밴달')];
const EN=[skin('a','Singularity Vandal'),skin('b','Singularity Phantom'),skin('c','Reaver Vandal')];
function fetchMock(calls){
 return async url=>{
  calls.push(url);
  const data=url.includes('contenttiers')?[{uuid:'premium',displayName:'Premium Edition'}]:
   url.includes('language=ko-KR')?KO:EN;
  return {ok:true,status:200,json:async()=>({status:200,data})};
 };
}
test('Korean aliases, misspellings and English search select proper skin',()=>{
 const items=[
  {name:'싱귤래리티 밴달',englishName:'Singularity Vandal'},
  {name:'싱귤래리티 팬텀',englishName:'Singularity Phantom'},
  {name:'약탈자 밴달',englishName:'Reaver Vandal'}
 ];
 for(const query of ['싱귤 밴달','싱귤벤달','싱굴 밴달','singular vandal'])
  assert.equal(skins.matchSkin(query,items).skin?.englishName,'Singularity Vandal',query);
 assert.equal(skins.matchSkin('약탈 벤달',items).skin?.englishName,'Reaver Vandal');
 assert.equal(skins.matchSkin('싱귤',items).skin,null,'collection name alone must ask user to disambiguate');
 assert.ok(skins.matchSkin('싱귤',items).choices.length>=2);
});
test('Catalog merges localized names with English aliases and tiers',async()=>{
 const calls=[];
 const result=await skins.downloadCatalog(fetchMock(calls));
 assert.equal(result.length,3);
 assert.equal(result[0].name,'싱귤래리티 밴달');
 assert.equal(result[0].englishName,'Singularity Vandal');
 assert.equal(result[0].tier,'Premium Edition');
 assert.equal(calls.length,3);
 assert.ok(calls.some(u=>u.includes('language=ko-KR')));
 assert.ok(calls.some(u=>u.includes('language=en-US')));
});
test('Info includes price qualifier, upgrades, effects, chromas and preview images',()=>{
 const data={
  name:'싱귤래리티 밴달',englishName:'Singularity Vandal',
  data:KO[0],tier:'Premium Edition'
 };
 const info=skins.explain(data);
 assert.match(info.text,/1,775 VP \(등급 일반가\)/);
 assert.match(info.text,/정확한 개별 가격은 공개 스킨 API에서 제공하지 않습니다/);
 assert.match(info.text,/3단계 \(기본 Lv.1 포함\)/);
 assert.match(info.text,/마무리 연출/);
 assert.match(info.text,/4종/);
 assert.match(info.text,/레디어나이트 비용은 공개 API로 확인할 수 없습니다/);
 assert.equal(info.photos.length,6);
 assert.equal(info.photos[0].label,'기본형 / Lv.1');
 assert.equal(info.photos[1].label,'최종 단계 제공 이미지 / Lv.3');
 assert.match(info.photos.at(-1).label,/^색상 4 · 파랑$/);
});
test('Official upgrade preview videos are used when no separate upgrade photo exists',()=>{
 const riotVideo='https://valorant.dyn.riotcdn.net/x/videos/release-06.08/test_default_universal.mp4';
 const otherVideo='https://media.valorant-api.com/streamedvideos/preview.mp4';
 assert.equal(skins.safeVideo(riotVideo),riotVideo);
 assert.equal(skins.safeVideo(otherVideo),otherVideo);
 assert.equal(skins.safeVideo('https://not-riot.example.com/x/videos/foo.mp4'),'');
 const base='https://media.valorant-api.com/weaponskinlevels/same/displayicon.png';
 const item={name:'테스트 밴달',englishName:'Test Vandal',tier:'Premium Edition',
  data:{levels:[
   {displayIcon:base,levelItem:null},
   {displayIcon:null,levelItem:'EEquippableSkinLevelItem::VFX',streamedVideo:riotVideo}
  ],chromas:[]}};
 const info=skins.explain(item);
 assert.equal(info.hasDistinctUpgrade,false);
 assert.equal(info.photos.length,1);
 assert.match(info.text,/업그레이드된 게임 내 외형\/효과는 위 미리보기 영상/);
 assert.ok(info.text.includes(riotVideo));
});
test('Do not label repeated upgrade image as a distinct preview',()=>{
 const data={name:'테스트 밴달',englishName:'Test Vandal',tier:'Premium Edition',
  data:{...KO[0],levels:[
   {displayIcon:image('weaponskinlevels/same')},
   {displayIcon:image('weaponskinlevels/same')}
  ],chromas:[]}};
 const result=skins.explain(data);
 assert.equal(result.hasDistinctUpgrade,false);
 assert.equal(result.photos.length,1);
 assert.match(result.text,/단계별 외형 이미지가 분리되어 있지 않으면/);
});
test('Rejects non-CDN and non-HTTPS skin images',()=>{
 for(const value of ['http://media.valorant-api.com/weaponskins/a/displayicon.png',
  'https://internal.example.com/weaponskins/a/displayicon.png',
  'https://media.valorant-api.com.evil.org/weaponskins/a/displayicon.png',
  'file:///etc/passwd','https://media.valorant-api.com/private/a.png'])
  assert.equal(skins.safeMedia(value),'',value);
});
test('!스킨 sends a single complete info reply and one photo sheet request',async()=>{
 const calls=[],messages=[],uploads=[];
 const handled=await skins.handle({
  text:'!스킨 싱귤 벤달',client:{connected:true},roomId:'1849',userId:'skin-test-user-1',
  fetcher:fetchMock(calls),send:async text=>messages.push(text),
  sendImage:async args=>uploads.push(args)
 });
 assert.equal(handled,true);
 assert.equal(messages.length,1);
 assert.match(messages[0],/싱귤래리티 밴달/);
 assert.match(messages[0],/업그레이드/);
 assert.match(messages[0],/VP 가격/);
 assert.equal(uploads.length,1);
 assert.equal(uploads[0].photos.length,6);
 assert.equal(calls.length,3);
});
test('No-argument command and ambiguous names never send images',async()=>{
 const calls=[],messages=[],uploads=[];
 await skins.handle({text:'!스킨',roomId:'1',userId:'skin-test-user-2',
  fetcher:fetchMock(calls),send:async text=>messages.push(text),
  sendImage:async arg=>uploads.push(arg)});
 await skins.handle({text:'!스킨 싱귤',roomId:'1',userId:'skin-test-user-3',
  fetcher:fetchMock(calls),send:async text=>messages.push(text),
  sendImage:async arg=>uploads.push(arg)});
 assert.match(messages[0],/사용법: !스킨/);
 assert.match(messages[1],/비슷한 스킨/);
 assert.equal(uploads.length,0);
});
test('Photo upload failure provides real image URLs without a false success claim',async()=>{
 const messages=[];
 await skins.handle({text:'!스킨 약탈 벤달',roomId:'1849',userId:'skin-test-user-4',
  fetcher:fetchMock([]),send:async text=>messages.push(text),
  sendImage:async()=>{throw Error('Kakao photo failed');}});
 assert.equal(messages.length,2);
 assert.match(messages[1],/비교 사진을 전송하지 못했습니다/);
 assert.match(messages[1],/https:\/\/media\.valorant-api\.com/);
});
test('Real PNG image board renderer returns a valid PNG with embedded variant photos',async()=>{
 const png=PNG.sync.write(new PNG({width:8,height:8}));
 const skinData={name:'싱귤래리티 밴달'};
 const available=[
  {label:'기본 Lv.1',url:image('weaponskinlevels/demo-base')},
  {label:'빨강',url:color('demo-red')}
 ];
 const result=await photos.renderBoard({
  skin:skinData,photos:available,
  readImage:async()=>png
 });
 assert.equal(result.images,2);
 assert.equal(result.width,1140);
 assert.ok(Buffer.isBuffer(result.buffer));
 assert.ok(result.buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
});
test('sendPreview uses existing KakaoForge sendPhoto and deletes temporary image',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'nexi-skin-test-'));
 const buffer=PNG.sync.write(new PNG({width:4,height:4}));
 let fileSeen=false,sentPath='';
 const client={connected:true,async sendPhoto(room,file,opts){
  fileSeen=!!(await fs.stat(file));
  sentPath=file;
  assert.equal(room,'1849');
  assert.equal(opts.mime,'image/png');
  assert.equal(opts.width,1140);
  return {complete:{status:0}};
 }};
 try{
  const result=await photos.sendPreview({
   client,roomId:'1849',skin:{name:'Test Skin'},photos:[],
   tempRoot:dir,
   renderImage:async()=>({buffer,width:1140,height:600,images:2})
  });
  assert.equal(result.confirmed,true);
  assert.equal(fileSeen,true);
  await assert.rejects(()=>fs.stat(sentPath),{code:'ENOENT'});
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('!스킨 is routed before game and DB readiness',async()=>{
 const file=await fs.readFile(path.join(__dirname,'../shared/router.js'),'utf8');
 const mod={exports:{}};
 const calls=[],messages=[];
 let handler=null;
 vm.runInNewContext(file,{
  module:mod,exports:mod.exports,Date,Promise,console,
  require(name){
   if(name==='./help')return {handleExtraMessage:async()=>false};
   if(name==='../game/command-aliases')return {isRetiredLegacyCommand:()=>false,isGameCommand:()=>false};
   if(name==='./unicode-output'||name==='./reply-delete')return {install(){}};
   if(name==='./valorant-settings')return {isEnabled:async()=>true};
   if(name==='./valorant-skin')return {handle:async args=>{
    calls.push(args.text);await args.send('스킨 검색 성공');return true;
   }};
   throw Error('Unexpected require '+name);
  }
 },{filename:'shared/router.js'});
 const client={onMessage(fn){handler=fn;},userId:'999',chat:{sendText:async(r,t)=>messages.push(t)}};
 mod.exports.attachRouter(client,{
  game:{message:()=>{throw Error('game used')}},
  management:{message:()=>{throw Error('manage used')}},
  ready:new Promise(()=>{})
 });
 await handler({room:{id:'1849'},sender:{id:'4444'},message:{text:'!스킨 싱귤 밴달'}});
 assert.deepEqual(calls,['!스킨 싱귤 밴달']);
 assert.deepEqual(messages,['스킨 검색 성공']);
});
