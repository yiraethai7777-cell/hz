'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
test('existing attendance rewards and duplicate protection remain authoritative after image errors',async()=>{
 const previous=process.env.DATABASE_URL;process.env.DATABASE_URL='postgres://localhost/attendance-isolated';
 const pool=require('../shared/db').getPool(),originalQuery=pool.query,originalConnect=pool.connect;
 const {PGlite}=require('@electric-sql/pglite'),db=new PGlite();let queue=Promise.resolve();
 const query=async(sql,args)=>{
  // PGlite has one connection. Serialize transactions below instead of emulating advisory locks.
  if(sql.includes('pg_advisory_xact_lock'))return {rows:[],rowCount:1};
  const r=args?.length?await db.query(sql,args):(await db.exec(sql)).at(-1);return {...r,rowCount:r?.rows?.length||r?.affectedRows||0};
 };
 pool.query=query;pool.connect=async()=>{const wait=queue;let release;queue=new Promise(r=>release=r);await wait;return{query,release};};
 try{
  await require('../game/wallet').initWallet();const {initAttendance,attend}=require('../manage/attendance');await initAttendance();
  const results=await Promise.all([attend('100','2001','기존출석자'),attend('100','2001','기존출석자')]);
  assert.equal(results.filter(x=>x.includes('출석 완료!')).length,1);assert.equal(results.filter(x=>x.includes('이미 출석')).length,1);
  let rows=(await query("SELECT balance FROM hz_wallets WHERE room_id='100' AND user_id='2001'")).rows;assert.equal(Number(rows[0].balance),30000);
  assert.equal((await query("SELECT * FROM hz_coin_logs WHERE type='ATTENDANCE'")).rows.length,1);
  const detail=await attend('100','2001','변경된 이름',{detailed:true});
  assert.equal(detail.isNew,false);assert.match(detail.message,/이미 출석/);assert.equal(detail.date,require('../manage/attendance-image/data').kstDate());
  const today=require('../manage/attendance-image/data').kstDate(),day=new Date(today+'T00:00:00Z');day.setUTCDate(day.getUTCDate()-1);const yesterday=day.toISOString().slice(0,10);
  await query("INSERT INTO hz_new_attendance(room_id,user_id,user_name,attend_date) VALUES('100','2002','연속출석자',$1::date)",[yesterday]);
  const reply=await attend('100','2002','연속출석자');assert.match(reply,/연속 출석: 2일/);assert.match(reply,/31,000코인/);
  // Simulate a failed image step after attendance is already committed.
  await assert.rejects(async()=>{throw Error('image upload failed');},/image upload failed/);
  await attend('100','2002','연속출석자');rows=(await query("SELECT balance FROM hz_wallets WHERE room_id='100' AND user_id='2002'")).rows;assert.equal(Number(rows[0].balance),31000);
  const snapshot=await require('../manage/attendance-image/data').readSnapshot(pool,{roomId:'100',userId:'2002'});assert.equal(snapshot.reward,'31000');assert.equal(snapshot.total,2);
 }finally{pool.query=originalQuery;pool.connect=originalConnect;await db.close();if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;}
});
