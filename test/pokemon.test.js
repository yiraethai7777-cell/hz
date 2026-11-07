'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {SPECIES,BY_NAME,spriteUrl,catchChance}=require('../game/pokemon-data');
const {createPokemon}=require('../game/pokemon');
const {renderSvg}=require('../game/pokemon-image');

function memoryPool(db){
 let queue=Promise.resolve();
 const query=async(sql,params)=>{
  const r=params?.length?await db.query(sql,params):(await db.exec(sql)).at(-1);
  return {...r,rowCount:r?.affectedRows??r?.rows?.length??0};
 };
 return {
  query,connect:async()=>{
   const before=queue;let release;
   queue=new Promise(resolve=>{release=resolve});
   await before;
   return {query,release};
  }
 };
}
test('Pokémon roster and canonical PokeAPI art URLs',()=>{
 assert.ok(SPECIES.length>=50);
 assert.equal(BY_NAME.get('피카츄').id,25);
 assert.equal(spriteUrl(25),'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png');
 assert.ok(catchChance(BY_NAME.get('뮤'),15)<catchChance(BY_NAME.get('피카츄'),15));
});
test('Image cards embed official art and all encounter details',()=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10]);
 const svg=renderSvg({pokemon:BY_NAME.get('피카츄'),png,level:7,balls:5,mode:'explore'});
 assert.match(svg,/data:image\/png;base64/);
 for(const expected of ['피카츄','No.025','전기','Lv.7','포획 가능 시간','60초','몬스터볼','!포획'])assert.ok(svg.includes(expected),expected);
});
test('search, capture, inventory and named Pokémon info persist in PostgreSQL',async()=>{
 const db=new PGlite();
 try{
  const pool=memoryPool(db);
  let clock=Date.parse('2026-11-07T12:00:00Z');
  // First roll: common rarity; second roll: first common. capture roll 0 succeeds.
  const sequence=[0,0,0.1,0,0.4,0.1,0.1,0.7];
  const random=()=>sequence.shift()??0.1;
  const service=createPokemon({pool,now:()=>clock,random,sleep:async()=>{},photo:async()=>{}});
  await service.init();
  let id=0;
  const ctx=()=>({roomId:'100',userId:'200',userName:'트레이너',messageId:String(++id)});
  const encounter=await service.withPlayer(ctx(),'explore');
  assert.equal(encounter.kind,'explore');
  assert.equal(encounter.level,6);
  assert.equal(encounter.balls,5);
  assert.match(encounter.text,/포획 가능 시간 · 60초/);
  const already=await service.withPlayer(ctx(),'explore');
  assert.equal(already.kind,'already');
  const caught=await service.withPlayer(ctx(),'capture');
  assert.equal(caught.kind,'capture');
  assert.equal(caught.success,true);
  assert.equal(caught.balls,4);
  const inv=await service.inventory(ctx());
  assert.match(inv,/보유 포켓몬 · 1마리/);
  assert.match(inv,/몬스터볼 · 4개/);
  assert.match(inv,/Lv.6/);
  const info=await service.info(ctx(),caught.pokemon.name);
  assert.equal(info.owned,1);
  assert.match(info.text,/내가 보유한 수 · 1마리/);
  const cooldown=await service.withPlayer(ctx(),'explore');
  assert.equal(cooldown.kind,'cooldown');
  clock+=20001;
  const encounter2=await service.withPlayer(ctx(),'explore');
  assert.equal(encounter2.kind,'explore');
  clock+=61000;
  const expired=await service.withPlayer(ctx(),'capture');
  assert.equal(expired.kind,'none');
  assert.match(expired.text,/먼저 !탐색/);
 }finally{await db.close();}
});
test('capture messages are deduplicated and daily balls replenish',async()=>{
 const db=new PGlite();
 try{
  const pool=memoryPool(db);
  let clock=Date.parse('2026-11-07T12:00:00Z');
  const service=createPokemon({pool,now:()=>clock,random:()=>0,sleep:async()=>{},photo:async()=>{}});
  await service.init();
  const context=(id)=>({roomId:'300',userId:'400',userName:'피카츄',messageId:id});
  await service.withPlayer(context('1'),'explore');
  await service.withPlayer(context('2'),'capture');
  await assert.rejects(()=>service.withPlayer(context('2'),'capture'),/이미 처리된/);
  let inv=await service.inventory(context('ignored'));
  assert.match(inv,/몬스터볼 · 4개/);
  clock+=24*60*60*1000;
  inv=await service.inventory(context('ignored'));
  assert.match(inv,/몬스터볼 · 5개/);
 }finally{await db.close();}
});
test('!탐색 sends progress and photo; !포켓봇정보 uses image and handles unknown names',async()=>{
 const db=new PGlite();
 try{
  const pool=memoryPool(db),photos=[],messages=[],edits=[];
  const service=createPokemon({pool,now:()=>Date.parse('2026-11-07T12:00:00Z'),
   random:()=>0,sleep:async()=>{},photo:async info=>photos.push(info)});
  await service.init();
  const ctx={roomId:'123',userId:'234',userName:'테스터',messageId:'1',
   send:async text=>{messages.push(text);return {status:0,body:{logId:'555'}};},
   chat:{editMessage:async(room,id,text)=>{edits.push({room,id,text});return {status:0}}}};
  await service.handle({...ctx,text:'#탐색'}, {connected:true});
  assert.equal(photos.length,1);
  assert.equal(photos[0].mode,'explore');
  assert.match(messages[0],/탐색/);
  assert.equal(edits.length,1);
  assert.equal(edits[0].id,'555');
  await service.handle({...ctx,text:'#포켓봇정보 피카츄'}, {connected:true});
  assert.equal(photos.at(-1).pokemon.id,25);
  assert.equal(photos.at(-1).mode,'info');
  await service.handle({...ctx,text:'#포켓봇정보 없는포켓몬'}, {connected:true});
  assert.match(messages.at(-1),/등록된 포켓몬 이름을 찾을 수 없습니다/);
 }finally{await db.close();}
});
