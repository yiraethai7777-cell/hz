'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
test('quotes reject stale data, closed sessions and failed providers',async()=>{
 const previous=global.fetch,now=Math.floor(Date.now()/1000),prices=require('../game/prices');
 const meta={regularMarketPrice:100,regularMarketTime:now,currency:'KRW',currentTradingPeriod:{regular:{start:now-60,end:now+3600}}};
 global.fetch=async()=>({ok:true,json:async()=>({chart:{result:[{meta}]}})});
 try{assert.equal((await prices.getMarketPrice('005930')).priceKrw,100);
 meta.regularMarketTime=now-901;await assert.rejects(()=>prices.getMarketPrice('005930'),/오래/);
 meta.regularMarketTime=now;meta.currentTradingPeriod.regular.end=now-1;await assert.rejects(()=>prices.getMarketPrice('005930'),/거래시간/);
 global.fetch=async()=>({ok:false,status:503});await assert.rejects(()=>prices.getQuote('AAPL'),/503/);
 }finally{global.fetch=previous;}
});
test('stock search and DST market hours use real symbols and local exchange time',async()=>{
 const {searchStocks}=require('../game/stock-search'),{isMarketOpen}=require('../game/market-hours');
 assert.match(await searchStocks('삼성전자'),/005930.KS/);assert.match(await searchStocks('NVDA'),/코드: NVDA/);
 assert.equal(isMarketOpen('AAPL',new Date('2026-07-01T13:30:00Z')).open,true);
 assert.equal(isMarketOpen('AAPL',new Date('2026-01-05T13:30:00Z')).open,false);
 assert.equal(isMarketOpen('AAPL',new Date('2026-01-05T14:30:00Z')).open,true);
});
test('inventory pagination preserves every line and stays within message limits',async()=>{
 const runtime=require('../shared/runtime').createRuntime({economyEnabled:false,pool:{}}),sent=[];
 const source=Array.from({length:1000},(_,i)=>`#${i+1} 보존 물고기 1000cm`).join('\n');
 await runtime.send({sendText:async(room,text)=>sent.push(text)},'1',source);
 assert.ok(sent.length>1);assert.ok(sent.every(text=>text.length<=4500));assert.match(sent.at(-1),/#1000 /);
 assert.equal(sent.map(s=>s.replace(/^\[\d+\/\d+\]\n/,'')).join('\n'),source);
});
test('quiz expiry, fish sale and pet equip plus enhancement preserve other records',async()=>{
 const runtime=require('../shared/runtime').createRuntime({economyEnabled:false,pool:{}}),room=runtime.blankRoom('test'),db={};
 const msg={room:{id:'1'},sender:{id:'1001',name:'테스트'},text:'!상점'};
 await runtime.handleGame(room,db,msg,false);const p=room.players['1001'];p.points=100000;p.pets={'고양이':0};
 room.quiz={kind:'수학',answers:['4'],question:'2+2',expiresAt:Date.now()-1};msg.text='!정답 4';assert.match(await runtime.handleGame(room,db,msg,false),/시간이 지났/);assert.equal(p.points,100000);
 msg.text='!펫장착 최고';assert.match(await runtime.handleGame(room,db,msg,false),/장착 완료/);msg.text='!펫강화';assert.match(await runtime.handleGame(room,db,msg,false),/강화 완료/);assert.equal(p.pets['고양이'],1);
 p.inventory=[{name:'보존물고기',size:1,tier:'일반',value:1234,salePending:true}];const before=p.points;msg.text='!물고기판매 all';assert.match(await runtime.handleGame(room,db,msg,false),/판매 완료/);assert.equal(p.inventory.length,0);assert.equal(p.points,before+1234);assert.equal(p.pets['고양이'],1);
});
test('promotion follows clock boundaries, starts at the next slot and removes scheduled starts',()=>{
 const {patch,nextBoundary,boundaryDue}=require('../promotion');assert.throws(()=>patch({message:'문구'},'schedule',{}),/지원하지/);
 for(const [minutes,at,expected]of [[20,'2026-10-18T01:01:00+09:00','2026-10-18T01:20:00+09:00'],[20,'2026-10-18T01:40:00+09:00','2026-10-18T02:00:00+09:00'],[30,'2026-10-18T01:31:00+09:00','2026-10-18T02:00:00+09:00']])assert.equal(nextBoundary(minutes,new Date(at).getTime()),new Date(expected).getTime());
 assert.equal(boundaryDue(20,new Date('2026-10-18T01:20:45+09:00').getTime()),true);assert.equal(boundaryDue(20,new Date('2026-10-18T01:21:00+09:00').getTime()),false);
 const p=patch({message:'문구',allowed:true,nextRunAt:9999999999999},'start',{minutes:20});assert.equal(p.nextRunAt,null);assert.equal(p.clockAligned,true);assert.equal(patch(p,'stop').enabled,false);
});


test('copied password-hash whitespace is normalized without changing passwords or session secrets',()=>{
 const auth=require('../api/auth'),oldHash=process.env.GL_ADMIN_PASSWORD_HASH,oldSecret=process.env.GL_SESSION_SECRET;
 try{const hash=auth.hashPassword('  exact password  ');process.env.GL_ADMIN_PASSWORD_HASH=' \n'+hash+'\r\n ';process.env.GL_SESSION_SECRET=' s'.repeat(32);const config=auth.config();assert.equal(config.ready,true);assert.equal(config.hash,hash);assert.equal(config.secret,process.env.GL_SESSION_SECRET);assert.notEqual(auth.hashPassword('exact password',hash.split(':')[0]),hash);}
 finally{if(oldHash===undefined)delete process.env.GL_ADMIN_PASSWORD_HASH;else process.env.GL_ADMIN_PASSWORD_HASH=oldHash;if(oldSecret===undefined)delete process.env.GL_SESSION_SECRET;else process.env.GL_SESSION_SECRET=oldSecret;}
});
