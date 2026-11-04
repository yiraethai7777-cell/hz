'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {RODS,PETS}=require('../game/data');

function setup(){
 const seededMath=Object.create(Math);
 let state=0x1234abcd;
 seededMath.random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296;};
 const file=fs.readFileSync(path.join(__dirname,'../game/features.js'),'utf8');
 const module={exports:{}};
 vm.runInNewContext(file,{module,exports:module.exports,Math:seededMath,require},{filename:'game/features.js'});
 const tiers=['일반','희귀','영웅','전설','신화'];
 const ctx={RODS,PETS,FISH_TABLE:tiers.map(tier=>({name:tier,tier,weight:1}))};
 const features=module.exports(ctx);
 ctx.petBonus=features.petBonus;
 return {ctx,features};
}
function odds(features,luck,draws=50000){
 const totals={};
 for(let i=0;i<draws;i++){
  const tier=features.fishPick(luck).tier;
  totals[tier]=(totals[tier]||0)+1;
 }
 return Object.fromEntries(Object.entries(totals).map(([tier,count])=>[tier,count/draws]));
}

test('천상 낚싯대와 좋은 펫을 장착할수록 전설·신화 출현율이 체감되게 증가',()=>{
 const {features}=setup();
 const normal={rod:'나무',rodLevels:{},equippedPet:'',pets:{},luckUntil:0};
 const heavenly={...normal,rod:'천상'};
 const godPet={...heavenly,equippedPet:'창조의 신',pets:{'창조의 신':0}};
 assert.equal(features.rodLuck(normal),1);
 assert.equal(features.rodLuck(heavenly),8);
 assert.equal(features.rodLuck(godPet),16);
 const base=odds(features,features.rodLuck(normal));
 const high=odds(features,features.rodLuck(heavenly));
 const max=odds(features,features.rodLuck(godPet)*1.5);
 assert.ok(base['전설']>0.001&&base['전설']<0.003);
 assert.ok((base['신화']||0)>=0&&(base['신화']||0)<0.0004);
 assert.ok(high['전설']>base['전설']*2);
 assert.ok(high['신화']>(base['신화']||0)*3);
 assert.ok(max['전설']>high['전설']);
 assert.ok(max['신화']>high['신화']);
 assert.ok(max['전설']<0.075&&max['신화']<0.018);
});

test('기본 나무 낚시대의 등급 확률은 정확히 83/15/1.8/0.19/0.01%',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../game/features.js'),'utf8');
 const found=/const base=\[([^\]]+)\]/.exec(source);
 assert.ok(found,'기본 등급 가중치 정의가 없습니다.');
 const weights=found[1].split(',').map(Number);
 assert.deepEqual(weights,[8300,1500,180,19,1]);
 assert.equal(weights.reduce((a,b)=>a+b,0),10000);
});
