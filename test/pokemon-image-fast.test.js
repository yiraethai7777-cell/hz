'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {sendCard,fetchArtwork,validPng,cacheInfo}=require('../game/pokemon-image');
const {BY_NAME}=require('../game/pokemon-data');
function samplePng(){
 const b=Buffer.alloc(32);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);
 b.writeUInt32BE(475,16);b.writeUInt32BE(475,20);return b;
}
test('Pokemon photo sends the unmodified PNG, no SVG card rendering',async()=>{
 const pokemon=BY_NAME.get('피카츄');
 const source=samplePng(),seen=[];
 const client={connected:true,sendPhoto:async(room,file,options)=>{
  const output=await fs.readFile(file);
  seen.push({room,output,options});
  return {complete:{status:0}};
 }};
 assert.equal(validPng(source).width,475);
 await sendCard({client,roomId:'1234567',pokemon,loadArtwork:async()=>source});
 assert.equal(seen.length,1);
 assert.equal(seen[0].room,'1234567');
 assert.equal(seen[0].options.width,475);
 assert.equal(seen[0].options.height,475);
 assert.deepEqual(seen[0].output,source);
});
test('same Pokémon artwork is downloaded once and reused from in-process cache',async()=>{
 const png=samplePng(),pokemon=BY_NAME.get('피카츄');
 let calls=0;
 const before=globalThis.fetch;
 globalThis.fetch=async url=>{
  calls++;
  assert.match(url,/official-artwork\/25\.png$/);
  return {ok:true,status:200,headers:{get:()=>String(png.length)},
   arrayBuffer:async()=>Uint8Array.from(png).buffer};
 };
 try{
  const a=await fetchArtwork(pokemon.id);
  const b=await fetchArtwork(pokemon.id);
  assert.deepEqual(a,png);
  assert.strictEqual(a,b);
  assert.equal(calls,1);
  assert.ok(cacheInfo().items>0);
 }finally{globalThis.fetch=before;}
});
