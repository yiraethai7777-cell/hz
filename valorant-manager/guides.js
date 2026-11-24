'use strict';
const {command,tail,clean}=require('./core');
const cache=new Map();
async function api(type){if(cache.has(type)&&cache.get(type).expires>Date.now())return cache.get(type).items;const r=await fetch('https://valorant-api.com/v1/'+type+'?language=ko-KR',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('공개 데이터 조회 실패');const j=await r.json();cache.set(type,{items:j.data,expires:Date.now()+3600000});return j.data}
function match(q,items){const s=clean(q).toLowerCase();return items.find(x=>x.displayName?.toLowerCase()===s)||items.find(x=>x.displayName?.toLowerCase().includes(s))}
const MORE='\\u200b'.repeat(600);
const proCrosshairs=[
 {name:'TenZ',type:'십자가',code:'0;s;1;P;c;5;o;0;f;0;0l;2;0v;2;0g;1;0o;1;0a;1;0f;0;1b;0'},
 {name:'Demon1',type:'십자가',code:'0;p;0;s;1;P;o;1;f;0;0t;1;0l;3;0o;2;0a;1;0f;0;1b;0;A;o;1;0t;1;0l;3;0o;2;0a;1;0f;0;1b;0;S;c;1;o;1'},
 {name:'aspas',type:'점',code:'0;s;1;P;o;1;d;1;0b;0;1b;0;S;c;0'},
 {name:'Jinggg',type:'십자가',code:'0;s;1;P;c;8;u;FF99FFFF;o;1;b;1;f;0;0l;3;0o;2;0a;1;0f;0;1b;0;S;c;5;o;1'},
 {name:'f0rsakeN',type:'십자가',code:'0;p;0;c;1;s;1;P;h;0;f;0;s;0;0l;3;0v;3;0g;1;0o;0;0a;1;0f;0;1b;0;A;o;1;d;1;0b;0;1b;0;S;d;0'},
 {name:'Primmie',type:'점',code:'0;s;1;P;o;1;d;1;f;0;0b;0;1b;0;S;o;1'},
 {name:'Derke',type:'십자가',code:'0;P;o;1;0t;1;0l;4;0o;2;0a;1;0f;0;1t;0;1l;1;1o;0;1a;1;1m;0;1f;0'},
 {name:'cNed',type:'십자가',code:'0;P;h;0;0l;5;0o;0;0a;1;0f;0;1b;0'},
 {name:'nAts',type:'점',code:'0;P;c;7;o;1;d;1;z;1;0b;0;1b;0'},
 {name:'Zekken',type:'십자가',code:'0;s;1;P;c;5;h;0;0l;3;0o;2;0a;1;0f;0;1b;0'}
];
function crosshairList(type){return proCrosshairs.filter(x=>!type||type==='전체'||x.type===type||x.name.toLowerCase()===type.toLowerCase()).map(x=>x.code)}
function crosshairSvg(type){const dots=type==='점',cells=Array.from({length:10},(_,i)=>{const x=100+(i%5)*180,y=95+Math.floor(i/5)*180,shape=dots?'<circle cx="'+x+'" cy="'+y+'" r="'+(2+i%4)+'" fill="#18f5c2"/>':'<path d="M'+(x-10-i%3)+' '+y+'h'+(20+(i%3)*2)+' M'+x+' '+(y-10-i%3)+'v'+(20+(i%3)*2)+'" stroke="#18f5c2" stroke-width="'+(1+i%3)+'"/>';return '<rect x="'+(x-75)+'" y="'+(y-65)+'" width="150" height="140" rx="12" fill="#17202a"/>'+shape+'<text x="'+x+'" y="'+(y+55)+'" text-anchor="middle" font-size="17" fill="white">'+(i+1)+'번</text>'}).join('');return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="940" height="390"><rect width="100%" height="100%" fill="#0d1117"/>'+cells+'</svg>')}
async function handle(ctx){const {text,send,sendImage,sendImages,sendImageBuffer}=ctx,c=command(text),q=tail(text);

if(c==='!요원'||c==='!랜덤요원'){const all=(await api('agents')).filter(x=>x.isPlayableCharacter&&x.displayName),a=c==='!랜덤요원'?all[Math.floor(Math.random()*all.length)]:match(q,all);if(!a)return send('❌ 요원을 찾지 못했습니다.');if(c==='!랜덤요원')return send(a.displayName);await send('🎭 '+a.displayName+'\n역할: '+(a.role?.displayName||'정보 없음')+'\n'+(a.description||'')+MORE+'\n'+(a.abilities||[]).filter(x=>x.displayName).map(x=>x.displayName+': '+(x.description||'')).join('\n'));if(sendImage&&a.fullPortrait)await sendImage(a.fullPortrait);return true}
if(c==='!맵'){const a=match(q,(await api('maps')).filter(x=>x.displayName));if(!a)return send('❌ 맵을 찾지 못했습니다.');await send('🗺️ '+a.displayName +MORE+'\n'+(a.tacticalDescription||a.narrativeDescription||'공개된 설명이 없습니다.'));const images=[a.splash,a.displayIcon].filter(Boolean);if(images.length===2&&sendImages)await sendImages(images);else if(sendImage)for(const src of images)await sendImage(src);return true}
if(c==='!랜덤맵'){const all=(await api('maps')).filter(x=>x.displayName);return send(all[Math.floor(Math.random()*all.length)].displayName)}
if(c==='!조준점'){
 const list=proCrosshairs.filter(x=>!q||q==='전체'||x.type===q||x.name.toLowerCase()===q.toLowerCase());
 if(!list.length)return send('사용법: !조준점 [점/십자가/전체/선수명]');
 await send('🎯 프로 선수 조준점 '+list.length+'개\n'+list.map((x,i)=>(i+1)+'. '+x.name+' ('+x.type+')').join('\n')+MORE+'\n'+list.map((x,i)=>(i+1)+'. '+x.name+'\n'+x.code).join('\n\n')+'\n※ 공개된 선수 설정 기준이며 현재 사용 설정과 다를 수 있습니다.');
 return true;
}

return false}
module.exports={handle,crosshairList,crosshairSvg};