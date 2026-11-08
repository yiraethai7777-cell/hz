'use strict';
const ORES=Object.freeze([
 {name:'석탄',icon:'🪨',weight:30,price:1000,tier:0},{name:'철광석',icon:'⚙️',weight:23,price:2500,tier:0},
 {name:'구리광석',icon:'🟠',weight:14,price:1800,tier:0},{name:'은광석',icon:'⚪',weight:10,price:4500,tier:1},
 {name:'금광석',icon:'🟡',weight:8,price:7000,tier:1},{name:'석영',icon:'▫️',weight:6,price:6000,tier:1},
 {name:'에메랄드',icon:'🟢',weight:4,price:18000,tier:2},{name:'루비',icon:'🔴',weight:2,price:25000,tier:2},
 {name:'사파이어',icon:'🔵',weight:1.5,price:30000,tier:2},{name:'다이아몬드',icon:'💎',weight:.8,price:50000,tier:3},
 {name:'미스릴',icon:'✨',weight:.5,price:80000,tier:3},{name:'고대수정',icon:'🔮',weight:.2,price:150000,tier:4}
]);
const PICKS=Object.freeze([{name:'나무',cost:'0'},{name:'돌',cost:'60000'},{name:'철',cost:'180000'},{name:'강철',cost:'540000'},{name:'다이아',cost:'1500000'},{name:'미스릴',cost:'3600000'}]);
const LOCATIONS=Object.freeze([{name:'광산입구',level:0,bonus:0},{name:'깊은동굴',level:2,bonus:.5},{name:'수정지대',level:4,bonus:1}]);
function state(p={}){const level=Math.max(0,Math.min(PICKS.length-1,Number(p.pick_level)||0));return {level,location:LOCATIONS.find(l=>l.name===p.location&&l.level<=level)||LOCATIONS[0]};}
function odds(p={}){const s=state(p),weights=ORES.map(o=>o.weight*(1+s.level*.2*o.tier)*(1+s.location.bonus*o.tier)),sum=weights.reduce((a,b)=>a+b,0);return weights.map(w=>w/sum);}
function pick(random,p){const chances=odds(p);let roll=random();for(let i=0;i<ORES.length;i++){roll-=chances[i];if(roll<0)return ORES[i];}return ORES.at(-1);}
function owned(p={}){const stored=Array.isArray(p.owned_picks)?p.owned_picks:Array.from({length:state(p).level+1},(_,i)=>i);return [...new Set([0,...stored.filter(i=>Number.isInteger(i)&&i>=0&&i<PICKS.length)])].sort((a,b)=>a-b);}
module.exports={ORES,PICKS,LOCATIONS,state,odds,pick,owned};
