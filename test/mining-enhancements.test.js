'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const rules=require('../game/mining-rules'),{run}=require('../game/message-progress');
test('12 ores preserve all old minerals and better picks and places improve rare chances',()=>{
 assert.equal(rules.ORES.length,12);for(const name of ['석탄','철광석','금광석','에메랄드','다이아몬드','고대수정'])assert.ok(rules.ORES.find(o=>o.name===name));
 const rare=p=>rules.odds(p).reduce((sum,n,i)=>sum+(rules.ORES[i].tier>=2?n:0),0);
 for(let level=1;level<6;level++)assert.ok(rare({pick_level:level})>rare({pick_level:level-1}));
 assert.ok(rare({pick_level:4,location:'수정지대'})>rare({pick_level:4,location:'깊은동굴'}));
 assert.ok(Math.abs(rules.odds({pick_level:5,location:'수정지대'}).reduce((a,b)=>a+b,0)-1)<1e-9);
 assert.equal(rules.ORES.find(o=>o.name==='고대수정').price,150000);
});
test('pasted mining commands normalize without modifying original message',()=>{
 const aliases=require('../game/command-aliases'),text='!광물판\u200b매 전&#xCCB4;';assert.ok(aliases.isGameCommand(text));assert.equal(aliases.toLegacy(text),'#광물판매 전체');const msg={text,id:'12345'};const mapped=aliases.toLegacyMessage(msg,text,aliases.toLegacy(text));assert.equal(msg.text,text);assert.equal(mapped.text,'#광물판매 전체');assert.equal(mapped.id,'12345');
});
test('stalled edit times out into exactly one result fallback and stops animation',async()=>{
 const sent=[],edits=[];const result=await run({roomId:'1000',sendStart:async()=>({status:0,body:{logId:'1234'}}),edit:async(...args)=>{edits.push(args);return new Promise(()=>{});},sendFallback:async text=>sent.push(text),stages:['start','progress','final'],result:'final',delays:[0,0],wait:async()=>{},timeoutMs:15});assert.equal(result,'fallback');assert.deepEqual(sent,['final']);assert.equal(edits.length,1);
});
test('nested edit rejection triggers fallback even when outer status says success',async()=>{
 const sent=[];await run({roomId:'1000',sendStart:async()=>({status:0,body:{logId:'1234'}}),edit:async()=>({status:0,body:{status:-500}}),sendFallback:async t=>sent.push(t),stages:['start','final'],result:'final',delays:[0],wait:async()=>{},timeoutMs:20});assert.deepEqual(sent,['final']);
});
test('shop responds once, reuses seed and rod data, and performs reads only',async()=>{
 const {createShop,format}=require('../game/shop'),responses=[];const shop=createShop({pool:{query:async sql=>{assert.match(sql,/^SELECT /);return {rows:[{pick_level:2,location:'깊은동굴'}]};}}});
 for(const category of ['','곡괭이','낚싯대','씨앗','소모품']){const before=responses.length;await shop.handle({text:'#상점'+(category?' '+category:''),roomId:'1000',userId:'2000',send:async t=>responses.push(t)});assert.equal(responses.length,before+1);assert.match(responses.at(-1),/🛒 NEXI/);}
 assert.match(format('곡괭이',{pick_level:2}),/현재 · 철 \+2/);assert.match(format('씨앗'),/!씨앗ㄱㅁ/);assert.match(format('낚싯대'),/!낚시대ㄱㅁ/);
});
