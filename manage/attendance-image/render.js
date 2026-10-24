'use strict';
const fs=require('node:fs'),path=require('node:path');
const {renderAsync}=require('@resvg/resvg-js');
const {calendar,escapeXml}=require('./data');
const asset=name=>path.join(__dirname,'assets',name);
const decorations=Object.fromEntries(['check','calendar'].map(name=>[name,'data:image/png;base64,'+fs.readFileSync(asset(name+'.png')).toString('base64')]));
const fontFiles=['NotoSansKR-Regular.ttf','NotoSansKR-ExtraBold.ttf'].map(asset);
const clean=value=>String(value).toWellFormed().replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,'');
const units=value=>[...value].reduce((n,c)=>n+(/[^\u0020-\u007e]/u.test(c)?1:.57),0);
function layoutName(value){
 const name=clean(value||'이름 없음')+'님';if(name.length>4096)throw Error('Nickname too long');
 const graphemes=[...new Intl.Segmenter('ko',{granularity:'grapheme'}).segment(name)].map(x=>x.segment);
 if(units(name)*58<=540)return {size:58,lines:[name]};
 const size=Math.max(32,Math.min(50,Math.floor(540/units(name))));
 if(units(name)*size<=540)return {size,lines:[name]};
 const lines=[''];let index=0;
 for(const g of graphemes){
  if(units(lines[index]+g)*32>530){if(index===1){lines[1]=lines[1].slice(0,-1)+'…';break;}index++;lines[index]='';}
  lines[index]+=g;
 }return {size:32,lines};
}
const number=(value,label)=>{if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid '+label);return value;};
function localized(value){return BigInt(value).toLocaleString('ko-KR');}
function dateLabel(date){const [year,month,day]=date.split('-').map(Number),weekday=['일','월','화','수','목','금','토'][new Date(date+'T00:00:00Z').getUTCDay()];return `${year}년 ${month}월 ${day}일 (${weekday})`;}
function text(x,y,value,size=24,fill='#f8f8f8',extra=''){return `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${escapeXml(value)}</text>`;}
function icon(kind,x,y){
 const color=kind==='coin'?'#dcdcdc':'#e3e3e3';
 const shapes={calendar:'<rect x="-12" y="-10" width="24" height="23" rx="3"/><path d="M-7 -15v9 M7 -15v9 M-11 -3h22"/>',check:'<circle r="13"/><path d="m-6 0 4 4 8-9"/>',flame:'<path d="M0 14C-18 10-9-3-4-10c0 8 5 4 5-5 12 13 15 22 4 29 4-8-2-11-3-12 0 6-8 8-2 12Z" fill="'+color+'" stroke="none"/>',chart:'<path d="M-11 10V1 M0 10V-8 M11 10V-15" stroke="#a8a8a8" stroke-width="6"/>',coin:'<ellipse cy="-6" rx="12" ry="5" fill="#dcdcdc"/><path d="M-12 -5v12c0 7 24 7 24 0V-5 M-12 0c0 7 24 7 24 0 M-12 6c0 7 24 7 24 0"/>'};
 return `<g transform="translate(${x} ${y})"><circle r="29" fill="#0e0e0e" stroke="${kind==='coin'?'#909090':'#9a9a9a'}" stroke-width="1.2"/><g fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${shapes[kind]}</g></g>`;
}
function buildSvg(input){
 const {name,today,attendanceDate,streak,total,reward}=input;
 const year=Number(String(today).slice(0,4)),month=Number(String(today).slice(5,7));
 const dates=input.dates??input.calendar?.cells.filter(c=>c?.attended).map(c=>c.date)??[];
 const grid=calendar({year,month,dates,today});number(streak,'streak');number(total,'total');
 if(typeof attendanceDate!=='string'||attendanceDate>today||!dates.includes(attendanceDate))throw Error('Stored attendance record is required');
 if(!/^\d{1,19}$/.test(String(reward)))throw Error('Invalid reward');
 const label=dateLabel(today),nameLayout=layoutName(name);
 const nameSvg=nameLayout.lines.map((line,i)=>text(314,nameLayout.lines.length===1?190:156+i*39,line,nameLayout.size,'#fff','font-weight="800"')).join('');
 const last=grid.cells.filter(Boolean).at(-1),rows=Math.max(5,last.row+1),cellHeight=(276-(rows-1)*6)/rows;
 const cells=grid.cells.slice(0,rows*7).map((c,index)=>{
  const x=88+(index%7)*184,y=650+Math.floor(index/7)*(cellHeight+6);
  const checked=c?.attended,current=c?.highlightToday;
  const rank=checked?input.ranks?.[c.date]:undefined;
  const medal=({1:'#d4af37',2:'#c0c0c0',3:'#cd7f32'})[rank];
  const box=`<rect x="${x}" y="${y}" width="174" height="${cellHeight}" rx="12" data-rank="${rank??''}" fill="${medal|| (current?'url(#selected)':'url(#cell)')}" stroke="${medal||(checked?'#b2b2b2':'#303030')}" stroke-width="${current?2.5:1}" ${current?'filter="url(#glow)"':''}/>`;
  if(!c)return box;
  const color=medal?'#171717':current?'#fff':c.weekend==='sunday'?'#888888':c.weekend==='saturday'?'#939393':'#e2e2e2';
  const mark=checked?`<circle cx="${x+157}" cy="${y+12}" r="${current?17:10}" fill="${medal?'#f5f5f5':'#c6c6c6'}" ${current?'filter="url(#glow)"':''}/><path d="m${x+150} ${y+12} 5 5 9-10" fill="none" stroke="#3b3b3b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`:'';
  return `<g data-date="${c.date}" data-attended="${Boolean(checked)}">${box}${text(x+87,y+cellHeight/2+8,c.day,24,color,'text-anchor="middle"'+(current?' font-weight="800"':''))}${mark}</g>`;
 }).join('');
 const streakText=localized(streak)+'일',totalText=localized(total)+'회',rewardText='+'+localized(reward);
 const fit=(value,width,max)=>Math.min(max,Math.floor(width/units(value)));
 return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1448" height="1086" viewBox="0 0 1448 1086">
 <defs><filter id="monochrome" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter>
 <linearGradient id="background" x2=".7" y2="1"><stop stop-color="#222222"/><stop offset=".22" stop-color="#0a0a0a"/><stop offset="1" stop-color="#0a0a0a"/></linearGradient>
 <linearGradient id="frame" x2="1" y2="1"><stop stop-color="#d5d5d5"/><stop offset=".28" stop-color="#646464"/><stop offset=".65" stop-color="#b7b7b7"/><stop offset="1" stop-color="#575757"/></linearGradient>
 <linearGradient id="panel" x2=".2" y2="1"><stop stop-color="#181818"/><stop offset="1" stop-color="#0c0c0c"/></linearGradient>
 <linearGradient id="cell" x2=".5" y2="1"><stop stop-color="#1c1c1c"/><stop offset="1" stop-color="#121212"/></linearGradient>
 <linearGradient id="selected" x2=".4" y2="1"><stop stop-color="#414141"/><stop offset="1" stop-color="#1e1e1e"/></linearGradient>
 <filter id="glow" x="-25%" y="-65%" width="150%" height="230%"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
 <linearGradient id="fade"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".13" stop-color="#fff"/><stop offset=".98" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
 <linearGradient id="vertical-fade" x2="0" y2="1"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".04" stop-color="#fff"/><stop offset=".96" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
 <radialGradient id="check-fade"><stop offset=".86" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
 <mask id="art-fade"><rect x="848" y="85" width="557" height="260" fill="url(#fade)"/></mask>
 <mask id="art-vertical"><rect x="848" y="85" width="557" height="260" fill="url(#vertical-fade)"/></mask>
 <mask id="check-mask"><rect x="91" y="131" width="195" height="190" fill="url(#check-fade)"/></mask>
 </defs>
 <g><rect width="1448" height="1086" fill="#141414"/>
 <rect x="32" y="24" width="1384" height="1034" rx="44" fill="url(#background)" stroke="url(#frame)" stroke-width="3"/>
 <g font-family="Noto Sans KR" font-weight="400">
 ${text(80,82,'출석체크',26,'#fff','font-weight="800"')}
 ${text(1377,77,today.replaceAll('-','. ')+' ('+label.slice(-2,-1)+')',23,'#bdbdbd','text-anchor="end"')}
 <g mask="url(#art-vertical)"><image filter="url(#monochrome)" x="848" y="85" width="557" height="260" xlink:href="${decorations.calendar}" mask="url(#art-fade)"/></g>
 <image filter="url(#monochrome)" x="91" y="131" width="195" height="190" xlink:href="${decorations.check}" mask="url(#check-mask)"/>
 ${nameSvg}${text(314,256,'출석 완료되셨습니다!',43,'#fff','font-weight="800"')}
 ${text(315,309,'오늘도 함께해 주셔서 감사합니다.',26,'#c6c6c6')}${text(690,309,'♥',27,'#b5b5b5')}
 <rect x="56" y="345" width="1338" height="160" rx="23" fill="url(#panel)" stroke="#5e5e5e"/>
 ${[380,720,940,1156].map(x=>`<path d="M${x} 371v109" stroke="#383838"/>`).join('')}
 ${icon('calendar',124,401)}${icon('check',440,401)}${icon('flame',780,401)}${icon('chart',1000,401)}${icon('coin',1216,401)}
 ${text(178,409,'오늘 날짜',22,'#cacaca')}${text(492,409,'출석 날짜',22,'#cacaca')}${text(827,409,'연속 출석',22,'#cacaca')}${text(1047,409,'누적 출석',22,'#cacaca')}${text(1264,409,'획득 코인',22,'#cacaca')}
 ${text(220,470,label,fit(label,292,30),'#fff','text-anchor="middle" font-weight="800"')}${text(550,470,dateLabel(attendanceDate),fit(label,292,30),'#fff','text-anchor="middle" font-weight="800"')}
 ${text(830,473,streakText,fit(streakText,180,46),'#b4b4b4','text-anchor="middle" font-weight="800"')}${text(1048,473,totalText,fit(totalText,180,46),'#a5a5a5','text-anchor="middle" font-weight="800"')}${text(1273,473,rewardText,fit(rewardText,205,46),'#dbdbdb','text-anchor="middle" font-weight="800"')}
 <rect x="56" y="523" width="1338" height="428" rx="24" fill="url(#panel)" stroke="#707070"/>
 ${[122,1325].map((x,i)=>`<circle cx="${x}" cy="568" r="24" fill="#0f0f0f" stroke="#959595"/><path d="m${x+(i?-4:4)} 560 ${i?8:-8} 8 ${i?-8:8} 8" stroke="#f3f3f3" stroke-width="3" fill="none"/>`).join('')}
 ${text(724,579,`${year}년 ${month}월`,38,'#fff','text-anchor="middle" font-weight="800"')}
 <path d="M88 601h1272" stroke="#2f2f2f"/>
 ${grid.weekdays.map((day,i)=>text(175+i*184,636,day,23,i===0?'#848484':i===6?'#8b8b8b':'#d8d8d8','text-anchor="middle"')).join('')}
 ${cells}
 <path d="M64 978h1320" stroke="#959595"/>
 <g transform="translate(83 1018)" fill="#bcbcbc"><path d="M0 13V-6 M0 3C-19 4-17-13-17-13 0-15 0 1 0 3 M0 1C0-15 15-15 15-15 17 0 3 3 0 1" stroke="#bcbcbc" stroke-width="2"/></g>
 ${text(122,1027,'오늘도 출석 완료! 꾸준한 하루가 멋진 변화를 만듭니다. 항상 응원할게요!',20,'#f6f6f6')}
 ${text(1325,1027,'1등 금 · 2등 은 · 3등 동',20,'#bfbfbf','text-anchor="end"')}
 </g></g></svg>`;
}
let active=0;const waiting=[];
async function renderAttendance(input){
 if(active>=2){if(waiting.length>=16)throw Error('Image renderer busy');await new Promise(resolve=>waiting.push(resolve));}else active++;
 try{
  const svg=buildSvg(input);
  return (await renderAsync(svg,{font:{loadSystemFonts:false,fontFiles,defaultFontFamily:'Noto Sans KR'},languages:['ko'],logLevel:'error'})).asPng();
 }finally{if(waiting.length)waiting.shift()();else active--;}
}
module.exports={buildSvg,renderAttendance,layoutName};
