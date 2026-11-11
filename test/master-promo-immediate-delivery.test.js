'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','promotion','index.js'),'utf8');

function mockPromotion({message='홍보 내용',lastAttempt=0,enabled=false,allowed=false,botPower=false,reply={status:0}}={}){
 const roomData={promo:{enabled,allowed,lastAttempt}};
 const logs=[],sends=[];
 const db={async query(sql,args=[]){
  if(sql.startsWith('SELECT message FROM gl_bot_promotion_settings'))
   return {rowCount:1,rows:[{message}]};
  if(sql.startsWith('INSERT INTO gl_promotion_logs')){
   logs.push('PENDING');return {rowCount:1,rows:[{id:1}]};
  }
  if(sql.startsWith('UPDATE gl_promotion_logs')){
   logs.push(sql.includes("status='SENT'")?'SENT':'FAILED');return {rowCount:1};
  }
  throw Error('Unexpected SQL: '+sql.slice(0,70));
 }};
 const mockedRequire=name=>{
  if(name==='../shared/db')return {getPool:()=>db};
  if(name==='../shared/store')return {roomTransaction:async(room,run)=>run(roomData,db),transaction:async fn=>fn(db),audit:async()=>{}};
  if(name==='../shared/bot-power')return {enabled:async()=>botPower};
  if(name==='./default-message')return {message:'fallback'};
  throw Error('Unexpected dependency: '+name);
 };
 const m={exports:{}};
 new Function('require','module','console',source)(mockedRequire,m,{warn(){},info(){},error(){}});
 const chat={sendText:async(room,body)=>{sends.push({room,body});return reply}};
 return {promotion:m.exports,chat,logs,sends};
}

test('master immediate send works when scheduled promotion is OFF and bot subscription is unavailable',async()=>{
 const x=mockPromotion();
 const result=await x.promotion.deliver('12345',x.chat,true,null,{master:true,detailed:true});
 assert.equal(result.sent,true);
 assert.equal(x.sends.length,1);
 assert.deepEqual(x.logs,['PENDING','SENT']);
});

test('Kakao API rejection is reported as failure, never success',async()=>{
 const x=mockPromotion({reply:false});
 const result=await x.promotion.deliver('12345',x.chat,true,null,{master:true,detailed:true});
 assert.equal(result.sent,false);
 assert.equal(x.sends.length,1);
 assert.deepEqual(x.logs,['PENDING','FAILED']);
});

test('manual send returns the actual cooldown reason',async()=>{
 const x=mockPromotion({lastAttempt:Date.now()});
 const result=await x.promotion.deliver('12345',x.chat,true,null,{master:true,detailed:true});
 assert.equal(result.sent,false);
 assert.match(result.reason,/30초/);
 assert.equal(x.sends.length,0);
});

test('scheduled promotions still require active room bot service',async()=>{
 const x=mockPromotion({enabled:true,allowed:true,botPower:false});
 assert.equal(await x.promotion.deliver('12345',x.chat),false);
 assert.equal(x.sends.length,0);
});

test('empty shared promotional content produces an actionable error',async()=>{
 const x=mockPromotion({message:''});
 const result=await x.promotion.deliver('12345',x.chat,true,null,{master:true,detailed:true});
 assert.equal(result.sent,false);
 assert.match(result.reason,/홍보 문구/);
 assert.equal(x.sends.length,0);
});
