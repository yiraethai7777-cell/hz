'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parsePush,numeric,observe,report}=require('../shared/read-receipts');

test('DECUNREAD parses lossless BSON Int64-like values',()=>{
 const p=parsePush({method:'DECUNREAD',body:{
  chatId:{toString:()=> '900000000000001'},
  userId:{toString:()=> '123456789012345'},
  watermark:{toString:()=> '9000000000000000001'}
 }});
 assert.deepEqual(p,{room:'900000000000001',user:'123456789012345',watermark:'9000000000000000001'});
 assert.equal(numeric(Number.MAX_SAFE_INTEGER+2),'');
 assert.equal(parsePush({body:{chatId:11,userId:12}}),null);
});
test('read pushes are ignored in OFF rooms or with incomplete IDs',async()=>{
 let queries=0;
 const db={query:async()=>{queries++;return {rows:[],rowCount:0};}};
 assert.equal(await observe({body:{chatId:'1111',userId:'2222',watermark:'3333'}},{db,power:async()=>false}),false);
 assert.equal(queries,0);
 assert.equal(await observe({body:{chatId:'1111',userId:'2222'}},{db,power:async()=>true}),false);
 assert.equal(queries,0);
});
test('observed reader is reported only when stored watermark covers replied message',async()=>{
 const calls=[];
 const db={query:async(sql,params=[])=>{
  calls.push({sql,params});
  if(sql.includes('CREATE TABLE'))return {rows:[],rowCount:0};
  if(sql.includes('INSERT INTO hz_read_watermarks'))return {rows:[],rowCount:1};
  if(sql.includes('FROM hz_read_watermarks'))return {rows:[{user_id:'7777',user_name:'읽은사람',watermark:'9000000000000000008'}],rowCount:1};
  throw Error('unknown query');
 }};
 const event={body:{chatId:'1111',userId:'7777',watermark:'9000000000000000008'}};
 assert.equal(await observe(event,{db,power:async()=>true}),true);
 const msg={message:{type:26,attachment:{src_logId:'9000000000000000001',src_userId:'8888'}}};
 const output=await report({roomId:'1111',msg,db,botId:'9999'});
 assert.match(output,/읽은사람 \(7777\)/);
 assert.match(output,/실제 이벤트/);
 assert.equal(calls.find(x=>x.sql.includes('FROM hz_read_watermarks')).params[1],'9000000000000000001');
});
test('without reply reference, status never fabricates reader names',async()=>{
 const output=await report({roomId:'1111',msg:{message:{type:1,text:'!읽기감지'}},db:{query:()=>{throw Error('query must not run')}}});
 assert.match(output,/답장으로/);
});
