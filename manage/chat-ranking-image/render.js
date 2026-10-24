'use strict';
const path=require('node:path');
const {renderAsync}=require('@resvg/resvg-js');
const {escapeXml}=require('../attendance-image/data');
const fontFiles=['NotoSansKR-Regular.ttf','NotoSansKR-ExtraBold.ttf'].map(n=>path.join(__dirname,'../attendance-image/assets',n));
function fitName(value,max){
 const clean=String(value||'이름 없음').toWellFormed().replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'');
 const chars=[...new Intl.Segmenter('ko',{granularity:'grapheme'}).segment(clean)].map(x=>x.segment);
 return chars.length>max?chars.slice(0,max-1).join('')+'…':clean;
}
function buildSvg(snapshot){
 const data=snapshot.top;
 if(!Array.isArray(data)||data.length>10)throw Error('Invalid ranking');
 const valueSize=(value,width,max)=>Math.min(max,Math.floor(width/(String(value).length*.65)));
 const maximum=data.length?BigInt(data[0].count):0n;
const txt=(x,y,t,size=26,color='#fff',extra='')=>`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" ${extra}>${escapeXml(t)}</text>`;
const colors=['#d9b64d','#c8cdd4','#c98c59'];
const rows=data.map((entry,i)=>{
 const name=fitName(entry.name,6),count=BigInt(entry.count);
 const y=435+i*78,c=colors[i]||'#a5a5a5',w=maximum>0n?Number(count*510n/maximum):0;
 return `<g><rect x="56" y="${y-43}" width="1088" height="70" rx="14" fill="${i<3?'#1b1b1b':'#121212'}"/>
 ${i<3?`<circle cx="100" cy="${y-8}" r="22" fill="${c}"/>`:''}
 ${txt(100,y+2,i+1,25,i<3?'#171717':'#858585','text-anchor="middle" font-weight="800"')}
 ${txt(156,y+3,name,30,'#f4f4f4','font-weight="800"')}
 <rect x="356" y="${y-25}" width="510" height="32" rx="8" fill="#252525"/>
 <rect x="356" y="${y-25}" width="${w}" height="32" rx="8" fill="${c}"/>
 ${txt(1102,y+2,count.toLocaleString('ko-KR')+'회',valueSize(count.toLocaleString('ko-KR')+'회',212,29),i<3?c:'#dedede','text-anchor="end" font-weight="800"')}
 </g>`;
}).join('');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1370" viewBox="0 0 1200 1370">
<defs><linearGradient id="bg" x2="0.3" y2="1"><stop stop-color="#1b1b1b"/><stop offset="0.45" stop-color="#080808"/><stop offset="1" stop-color="#101010"/></linearGradient><linearGradient id="edge"><stop stop-color="#ccc"/><stop offset=".5" stop-color="#565656"/><stop offset="1" stop-color="#999"/></linearGradient></defs>
<rect width="1200" height="1370" fill="#111"/>
<rect x="24" y="24" width="1152" height="1322" rx="36" fill="url(#bg)" stroke="url(#edge)" stroke-width="2"/>
<g font-family="Noto Sans KR">
${txt(60,83,'!채팅순위',24,'#c6c6c6','font-weight="800"')}${txt(1138,83,'우리 방 누적 기록',21,'#999','text-anchor="end"')}
${txt(64,171,'우리 방 채팅 순위',64,'#fff','font-weight="800"')}
${txt(67,220,'가장 활발하게 대화한 멤버 TOP 10',27,'#b8b8b8')}
<g transform="translate(1020 133)" fill="none" stroke="#ddd" stroke-width="5"><path d="M-39-35h75a15 15 0 0 1 15 15v37a15 15 0 0 1-15 15H3l-28 21V32h-14a15 15 0 0 1-15-15v-37a15 15 0 0 1 15-15Z"/><path d="M-27-6h52M-27 9H8" stroke-linecap="round"/></g>
<rect x="56" y="258" width="1088" height="79" rx="17" fill="#191919" stroke="#414141"/>
${txt(83,307,'집계 기준',23,'#929292')}${txt(203,307,'누적 채팅',27,'#fff','font-weight="800"')}
<path d="M445 279v38M805 279v38" stroke="#444"/>
${txt(475,307,'순위',23,'#929292')}${txt(553,307,'TOP 10',27,'#fff','font-weight="800"')}
${txt(836,307,'기준일',23,'#929292')}${txt(1113,307,snapshot.today.replaceAll('-','. '),25,'#eee','text-anchor="end"')}
${txt(100,376,'순위',21,'#888','text-anchor="middle"')}${txt(156,376,'닉네임',21,'#888')}${txt(356,376,'채팅 활동',21,'#888')}${txt(1102,376,'채팅 횟수',21,'#888','text-anchor="end"')}
${rows||txt(600,735,'아직 채팅 기록이 없습니다.',34,'#aaa','text-anchor="middle"')}
<rect x="56" y="1223" width="1088" height="76" rx="17" fill="#202020" stroke="#717171"/>
${txt(83,1270,'내 순위',23,'#aaa')}${txt(195,1270,snapshot.me?BigInt(snapshot.me.rank).toLocaleString('ko-KR')+'위':'미집계',valueSize(snapshot.me?.rank||'미집계',100,32),'#fff','font-weight="800"')}
${txt(324,1270,fitName(snapshot.name,10)+'님',27,'#eee','font-weight="800"')}${txt(1102,1270,BigInt(snapshot.me?.count||'0').toLocaleString('ko-KR')+'회',valueSize(BigInt(snapshot.me?.count||'0').toLocaleString('ko-KR')+'회',355,32),'#fff','text-anchor="end" font-weight="800"')}
${txt(600,1325,'1등 금색  ·  2등 은색  ·  3등 동색',20,'#999','text-anchor="middle"')}
</g></svg>`;

return svg;
}
let active=0;const waiting=[];
async function renderRanking(snapshot){
 if(active>=2){if(waiting.length>=16)throw Error('Ranking renderer busy');await new Promise(resolve=>waiting.push(resolve));}else active++;
 try{return (await renderAsync(buildSvg(snapshot),{font:{loadSystemFonts:false,fontFiles,defaultFontFamily:'Noto Sans KR'},languages:['ko'],logLevel:'error'})).asPng();}
 finally{if(waiting.length)waiting.shift()();else active--;}
}
module.exports={buildSvg,renderRanking};
