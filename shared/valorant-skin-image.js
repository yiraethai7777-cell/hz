'use strict';

// Send a compact NEXI photo board for a matched Valorant skin.
// Source images must be HTTPS assets from the published Valorant-API CDN.
const path=require('node:path');
const fs=require('node:fs/promises');
const os=require('node:os');
const {renderAsync}=require('@resvg/resvg-js');
const {safeMedia}=require('./valorant-skin');

const WIDTH=1140,COLS=2,CARD_HEIGHT=300;
const MAX_ASSET=1500000,MAX_IMAGE=4000000;
const fontFiles=['NotoSansKR-Regular.ttf','NotoSansKR-ExtraBold.ttf']
 .map(n=>path.join(__dirname,'../manage/attendance-image/assets',n));
function escapeXml(input){
 return String(input||'').replace(/[<>&"']/g,x=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[x]));
}
async function readPng(url,fetcher=globalThis.fetch){
 if(!safeMedia(url))throw Error('Untrusted skin image URL');
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),7500);
 if(timer.unref)timer.unref();
 try{
  const response=await fetcher(url,{
   signal:controller.signal,redirect:'error',
   headers:{Accept:'image/png','User-Agent':'NEXI-Skin-Images/1.0'}
  });
  if(!response.ok)throw Error('Image HTTP '+response.status);
  if(Number(response.headers?.get?.('content-length')||0)>MAX_ASSET)throw Error('Skin image too large');
  let bytes;
  if(response.body&&typeof response.body.getReader==='function'){
   const reader=response.body.getReader();
   const chunks=[];let length=0;
   while(true){
    const {done,value}=await reader.read();
    if(done)break;
    length+=value.byteLength;
    if(length>MAX_ASSET){await reader.cancel().catch(()=>{});throw Error('Skin image too large');}
    chunks.push(Buffer.from(value));
   }
   bytes=Buffer.concat(chunks);
  }else bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length<16||bytes.length>MAX_ASSET||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
   throw Error('Skin asset is not PNG');
  return bytes;
 }finally{clearTimeout(timer);}
}
function svgBoard(skin,images){
 const rows=Math.ceil(images.length/COLS);
 const height=175+rows*CARD_HEIGHT+48;
 const cards=images.map((item,i)=>{
  const col=i%COLS,row=Math.floor(i/COLS);
  const x=42+col*548,y=166+row*CARD_HEIGHT;
  const label=[...String(item.label)].slice(0,23).join('');
  const href='data:image/png;base64,'+item.png.toString('base64');
  return '<g>'+
   '<rect x="'+x+'" y="'+y+'" width="525" height="280" rx="20" fill="#171e2f" stroke="#424d68" stroke-width="2"/>'+
   '<rect x="'+(x+13)+'" y="'+(y+13)+'" width="499" height="216" rx="15" fill="#090d17"/>'+
   '<image x="'+(x+19)+'" y="'+(y+26)+'" width="487" height="190" preserveAspectRatio="xMidYMid meet" xlink:href="'+href+'"/>'+
   '<text x="'+(x+24)+'" y="'+(y+261)+'" font-size="25" fill="#edf1ff" font-weight="700">'+escapeXml(label)+'</text>'+
   '</g>';
 }).join('');
 const name=[...String(skin.name||'VALORANT SKIN')].slice(0,31).join('');
 return {height,svg:
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="'+WIDTH+'" height="'+height+'" viewBox="0 0 '+WIDTH+' '+height+'">'+
  '<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#1c263d"/><stop offset="0.48" stop-color="#0c1020"/><stop offset="1" stop-color="#1d1631"/></linearGradient></defs>'+
  '<rect width="'+WIDTH+'" height="'+height+'" fill="url(#bg)"/>'+
  '<rect x="30" y="25" width="1080" height="'+(height-50)+'" rx="28" stroke="#64748b" stroke-width="2" fill="none"/>'+
  '<g font-family="Noto Sans KR">'+
  '<text x="58" y="80" font-size="31" fill="#6de9fc" font-weight="700">NEXI  /  VALORANT SKIN</text>'+
  '<text x="58" y="135" font-size="41" fill="#ffffff" font-weight="800">'+escapeXml(name)+'</text>'+
  cards+
  '<text x="570" y="'+(height-17)+'" font-size="17" fill="#a8b7d1" text-anchor="middle">공개 API에 별도 이미지가 등록된 외형만 표시됩니다.</text>'+
  '</g></svg>'
 };
}
async function renderBoard({skin,photos,fetcher=globalThis.fetch,readImage=readPng,render=renderAsync}){
 const entries=Array.isArray(photos)?photos.slice(0,8):[];
 if(!entries.length)throw Error('No skin image assets');
 const settled=await Promise.allSettled(entries.map(async item=>({
  label:item.label,png:await readImage(item.url,fetcher)
 })));
 const images=settled.filter(x=>x.status==='fulfilled').map(x=>x.value);
 if(!images.length)throw Error('Failed to download preview images');
 const {svg,height}=svgBoard(skin,images);
 const result=await render(svg,{
  font:{loadSystemFonts:false,fontFiles,defaultFontFamily:'Noto Sans KR'},
  languages:['ko'],logLevel:'error'
 });
 const buffer=result.asPng();
 if(!Buffer.isBuffer(buffer)||buffer.length>MAX_IMAGE)throw Error('Rendered photo is too large');
 return {buffer,width:WIDTH,height,images:images.length};
}
async function sendPreview({client,roomId,skin,photos,fetcher=globalThis.fetch,
 renderImage=renderBoard,tempRoot=os.tmpdir()}){
 if(!client||typeof client.sendPhoto!=='function'||client.connected===false)
  throw Error('KakaoTalk photo upload is unavailable');
 const room=String(roomId);
 if(!/^\d{1,20}$/.test(room))throw Error('Invalid KakaoTalk room ID');
 const prepared=await renderImage({skin,photos,fetcher});
 const root=path.resolve(tempRoot);
 const folder=await fs.mkdtemp(path.join(root,'nexi-skin-'));
 try{
  const filename='nexi-valorant-skin.png';
  const file=path.join(folder,filename);
  await fs.writeFile(file,prepared.buffer,{flag:'wx',mode:0o600});
  const result=await client.sendPhoto(room,file,{
   filename,mime:'image/png',text:'🎨 NEXI | '+String(skin.name||'스킨')+' 외형 비교',
   width:prepared.width,height:prepared.height
  });
  if(!result?.complete||(typeof result.complete.status==='number'&&result.complete.status!==0))
   throw Error('KakaoTalk did not confirm photo upload');
  return {confirmed:true,images:prepared.images};
 }finally{await fs.rm(folder,{recursive:true,force:true});}
}
module.exports={sendPreview,renderBoard,svgBoard,readPng};
