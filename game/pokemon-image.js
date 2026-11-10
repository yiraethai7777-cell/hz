'use strict';
// Reuses the existing NEXI SVG -> PNG -> KakaoForge sendPhoto pipeline.
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {renderAsync}=require('@resvg/resvg-js');
const {spriteUrl,difficulty}=require('./pokemon-data');
const FONT_FILES=['NotoSansKR-Regular.ttf','NotoSansKR-ExtraBold.ttf']
 .map(name=>path.join(__dirname,'../manage/attendance-image/assets',name));
const W=920,H=1110,MAX_PNG=4000000;
const esc=x=>String(x??'').replace(/[<>&"']/g,c=>({
 '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'
})[c]);
function renderSvg({pokemon,balls=0,mode='explore',iv=null,owned=0,png}){
 const title=mode==='explore'?'야생 포켓몬 발견':mode==='caught'?'포획 성공':'포켓몬 정보';
 const accent=pokemon.rarity==='전설'?'#f5c15f':pokemon.rarity==='희귀'?'#ae9efc':'#73e0bc';
 const image='data:image/png;base64,'+png.toString('base64');
 const subtitle=mode==='explore'?'!포획 으로 잡아보세요!':
  mode==='caught'?'인벤토리에 보관되었습니다.':'KAKAOTALK MANAGER / POKÉDEX';
 const lines=mode==='explore'?
  [['도감번호','No.'+String(pokemon.id).padStart(3,'0')],
   ['타입',pokemon.type],['포획 난이도',difficulty(pokemon)],
   ['포획 가능 시간','60초'],['몬스터볼',String(balls)+'개 보유']]:
  mode==='caught'?
  [['도감번호','No.'+String(pokemon.id).padStart(3,'0')],
   ['타입',pokemon.type],['개체값',String(iv)+'%'],
   ['희귀도',pokemon.rarity],['남은 몬스터볼',String(balls)+'개']]:
  [['도감번호','No.'+String(pokemon.id).padStart(3,'0')],
   ['타입',pokemon.type],['희귀도',pokemon.rarity],
   ['포획 난이도',difficulty(pokemon)],['보유 수량',String(owned)+'마리'],
   ['이미지 출처','PokeAPI/sprites']];
 const texts=lines.map(([label,value],i)=>{
  const y=698+i*59;
  return '<text x="88" y="'+y+'" font-size="27" fill="#9db2c9">'+esc(label)+'</text>'+
   '<text x="833" y="'+y+'" text-anchor="end" font-size="30" fill="#f4f9ff" font-weight="700">'+esc(value)+'</text>';
 }).join('');
 return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'">'+
  '<defs><linearGradient id="b" x2="1" y2="1"><stop stop-color="#12263d"/><stop offset="1" stop-color="#0a1120"/></linearGradient></defs>'+
  '<rect width="920" height="1110" rx="32" fill="url(#b)"/>'+
  '<rect x="35" y="35" width="850" height="1040" rx="32" fill="none" stroke="#2c425c" stroke-width="3"/>'+
  '<g font-family="Noto Sans KR">'+
  '<text x="75" y="94" fill="'+accent+'" font-size="33" font-weight="800">KAKAOTALK MANAGER / POKÉMON</text>'+
  '<text x="75" y="158" fill="#f4faff" font-size="40" font-weight="800">'+esc(title)+'</text>'+
  '<rect x="68" y="181" width="784" height="418" rx="23" fill="#1e3146"/>'+
  '<circle cx="460" cy="390" r="192" fill="#2c455b"/>'+
  '<image x="210" y="198" width="500" height="380" preserveAspectRatio="xMidYMid meet" xlink:href="'+image+'"/>'+
  '<text x="82" y="641" fill="'+accent+'" font-size="39" font-weight="800">'+esc(pokemon.name)+'</text>'+
  '<rect x="65" y="663" width="790" height="370" rx="19" fill="#101f30"/>'+
  texts+
  '<text x="460" y="1059" text-anchor="middle" fill="'+accent+'" font-size="28" font-weight="700">'+esc(subtitle)+'</text>'+
  '</g></svg>';
}
// Keep original official artwork in memory: no SVG rendering for outgoing photos.
const ART_CACHE_LIMIT=32,ART_CACHE_MAX_BYTES=16*1024*1024;
const artCache=new Map(),pendingArtwork=new Map();
let artBytes=0;
function remember(number,bytes){
 if(bytes.length>ART_CACHE_MAX_BYTES)return;
 const old=artCache.get(number);
 if(old){artBytes-=old.length;artCache.delete(number);}
 artCache.set(number,bytes);artBytes+=bytes.length;
 while(artCache.size>ART_CACHE_LIMIT||artBytes>ART_CACHE_MAX_BYTES){
  const oldest=artCache.keys().next().value;
  artBytes-=artCache.get(oldest).length;artCache.delete(oldest);
 }
}
function validPng(bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length<24||bytes.length>1600000||
    !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('Invalid Pokémon PNG');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(!width||!height||width>4096||height>4096)throw Error('Invalid Pokémon image size');
 return {width,height};
}
async function downloadArtwork(number,fetcher){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),6500);
 if(timer.unref)timer.unref();
 try{
  const response=await fetcher(spriteUrl(number),{signal:controller.signal,redirect:'error',
   headers:{Accept:'image/png','User-Agent':'NEXI-Pokemon/1.0'}});
  if(!response?.ok)throw Error('Pokémon artwork HTTP '+response?.status);
  if(Number(response.headers?.get?.('content-length')||0)>1600000)throw Error('Artwork too large');
  const bytes=Buffer.from(await response.arrayBuffer());
  validPng(bytes);
  return bytes;
 }finally{clearTimeout(timer);}
}
async function fetchArtwork(number,fetcher=globalThis.fetch){
 const id=Number(number);
 // An injected mock fetcher is deliberately not cached.
 if(fetcher!==globalThis.fetch)return downloadArtwork(id,fetcher);
 const cached=artCache.get(id);
 if(cached){artCache.delete(id);artCache.set(id,cached);return cached;}
 if(pendingArtwork.has(id))return pendingArtwork.get(id);
 const task=downloadArtwork(id,fetcher).then(bytes=>{remember(id,bytes);return bytes;})
  .finally(()=>pendingArtwork.delete(id));
 pendingArtwork.set(id,task);
 return task;
}
async function createCard({pokemon,balls=0,mode='explore',iv=null,owned=0,
 fetcher=globalThis.fetch,renderer=renderAsync}){
 const png=await fetchArtwork(pokemon.id,fetcher);
 const svg=renderSvg({pokemon,balls,mode,iv,owned,png});
 const image=await renderer(svg,{font:{loadSystemFonts:false,fontFiles:FONT_FILES,defaultFontFamily:'Noto Sans KR'},languages:['ko'],logLevel:'error'});
 const buffer=image.asPng();
 if(!Buffer.isBuffer(buffer)||buffer.length>MAX_PNG)throw Error('Pokemon result PNG too large');
 return {buffer,width:W,height:H};
}
async function sendCard({client,roomId,pokemon,tempRoot=os.tmpdir(),loadArtwork=fetchArtwork}){
 if(client?.connected!==true||typeof client.sendPhoto!=='function')throw Error('Photo client unavailable');
 const started=Date.now();
 const bytes=await loadArtwork(pokemon.id);
 const {width,height}=validPng(bytes);
 const downloadMs=Date.now()-started;
 const folder=await fs.mkdtemp(path.join(path.resolve(tempRoot),'nexi-pokemon-'));
 try{
  const filename='pokemon-'+pokemon.id+'.png',full=path.join(folder,filename);
  await fs.writeFile(full,bytes,{flag:'wx',mode:0o600});
  const result=await client.sendPhoto(String(roomId),full,{filename,mime:'image/png',
   width,height,text:'🎮 카카오톡 게임 매니저 | '+pokemon.name});
  if(!result?.complete||Number(result.complete.status??0)!==0)
   throw Error('Pokémon photo not confirmed by KakaoTalk');
  const elapsed=Date.now()-started;
  if(elapsed>900)console.log('[NEXI POKEMON PHOTO TIMING]',{
    pokemonNo:pokemon.id,downloadMs,uploadMs:elapsed-downloadMs,totalMs:elapsed,bytes:bytes.length
  });
  return true;
 }finally{await fs.rm(folder,{recursive:true,force:true});}
}
module.exports={renderSvg,fetchArtwork,createCard,sendCard,validPng,cacheInfo:()=>({items:artCache.size,bytes:artBytes})};
