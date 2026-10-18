'use strict';
const assert=require('node:assert/strict');
module.exports=async({t,request,headers,query})=>{
const promotion=require('../promotion'),post=(route,b,h=headers)=>request(route,{method:'POST',headers:h,body:JSON.stringify(b)});
await t.test('operator common text, room switches and intervals preserve isolation and records',async()=>{
 assert.equal((await request('/api/admin/promotion-message')).status,401);
 assert.equal((await post('/api/admin/promotion-message',{message:'blocked'},{...headers,'X-CSRF-Token':''})).status,403);
 assert.equal((await post('/api/admin/promotion-message',{message:'운영자 공통 문구'})).status,200);
 for(const id of ['910','911'])await query('INSERT INTO hz_rooms(room_id,data) VALUES($1,$2::jsonb)',[id,JSON.stringify({name:'시험방 '+id,players:{keep:{points:123}},promo:{message:'기존 방 문구',allowed:false}})]);
 for(const id of ['910','911'])assert.equal((await post('/api/admin/promotion',{roomId:id,action:'start',minutes:20})).status,200);
 assert.equal((await post('/api/admin/promotion',{roomId:'910',action:'interval',minutes:30})).status,200);
 assert.equal((await query("SELECT data->'promo' AS p FROM hz_rooms WHERE room_id='910'")).rows[0].p.enabled,true);
 assert.equal((await post('/api/admin/promotion',{roomId:'910',action:'start',minutes:25})).status,400);
 await post('/api/admin/promotion-message',{message:'수정한 운영자 공통 문구'});
 const sends=[],chat={sendText:async(room,message)=>sends.push({room,message})};
 for(const id of ['910','911'])assert.equal(await promotion.deliver(id,chat,true),true);
 assert.deepEqual(sends.map(s=>s.message),['수정한 운영자 공통 문구','수정한 운영자 공통 문구']);
 await post('/api/admin/promotion',{roomId:'910',action:'stop'});
 assert.equal((await query("SELECT data->'promo' AS p FROM hz_rooms WHERE room_id='911'")).rows[0].p.enabled,true);
 assert.equal((await post('/api/admin/promotion-message',{action:'delete'})).status,400);
 assert.equal((await post('/api/admin/promotion-message',{action:'delete',confirm:true})).status,200);
 assert.equal((await post('/api/admin/promotion',{roomId:'911',action:'start',minutes:20})).status,400);
 const rows=(await query("SELECT data FROM hz_rooms WHERE room_id IN ('910','911')")).rows;
 for(const {data}of rows){assert.equal(data.promo.enabled,false);assert.equal(data.players.keep.points,123);}
 assert.equal((await query("SELECT count(*)::int AS n FROM gl_promotion_logs WHERE room_id IN ('910','911') AND status='SENT'")).rows[0].n,2);
 await require('../api/schema').init();assert.equal(await promotion.commonMessage(),'');
});
};
