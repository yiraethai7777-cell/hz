'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {calendar,kstDate,escapeXml,readSnapshot}=require('../manage/attendance-image/data');
test('attendance calendar uses real weekdays, leap years and only recorded checks',()=>{
 for(const [year,month,length,start]of [[2026,2,28,0],[2024,2,29,4],[2026,10,31,4],[2026,12,31,2]]){
  const prefix=`${year}-${String(month).padStart(2,'0')}`,days=[prefix+'-01',prefix+'-'+length];
  const grid=calendar({year,month,dates:days,today:prefix+'-01'});
  assert.equal(grid.cells.length,42);const actual=grid.cells.filter(Boolean);assert.equal(actual.length,length);
  assert.equal(actual[0].column,start);assert.equal(actual.at(-1).day,length);
  assert.equal(actual.filter(x=>x.attended).length,2);assert.equal(actual.filter(x=>x.highlightToday).length,1);
  for(const c of actual){assert.equal(c.column,c.weekday);if(!days.includes(c.date))assert.equal(c.attended,false);}
 }
 assert.throws(()=>calendar({year:2026,month:13}),/month/);
 assert.throws(()=>calendar({year:2026,month:2,dates:['2026-02-29']}),/date/);
 const noAttendance=calendar({year:2026,month:10,today:'2026-10-19'});assert.equal(noAttendance.cells.filter(x=>x?.highlightToday).length,0);
});
test('Korean midnight, XML injection and long names remain data',()=>{
 assert.equal(kstDate(new Date('2026-10-18T14:59:59Z')),'2026-10-18');
 assert.equal(kstDate(new Date('2026-10-18T15:00:00Z')),'2026-10-19');
 assert.equal(escapeXml('긴한글'.repeat(60)+'<&"\'\u0000').includes('<'),false);
 assert.equal(escapeXml('<script>&"\''),'&lt;script&gt;&amp;&quot;&apos;');
});
test('snapshot reads committed per-user records and actual rewards with no writes or cross-user mixing',async()=>{
 const {PGlite}=require('@electric-sql/pglite'),db=new PGlite();
 const query=async(sql,args)=>args?.length?db.query(sql,args):(await db.exec(sql)).at(-1);
 await db.exec(`CREATE TABLE hz_new_attendance(room_id TEXT,user_id TEXT,user_name TEXT,attend_date DATE,attended_at TIMESTAMPTZ,PRIMARY KEY(room_id,user_id,attend_date));
 CREATE TABLE hz_coin_logs(room_id TEXT,user_id TEXT,type TEXT,amount BIGINT,created_at TIMESTAMPTZ);`);
 for(const [user,name,day,reward]of [['1','첫 사용자','2026-10-18',30000],['1','긴닉네임'.repeat(40),'2026-10-19',31000],['2','다른 사용자','2026-10-19',30000],['3','동메달','2026-10-19',30000],['4','일반','2026-10-19',30000]]){
  await query('INSERT INTO hz_new_attendance VALUES($1,$2,$3,$4::date,$5::timestamptz)',['100',user,name,day,day+'T01:02:03+09:00']);
  await query("INSERT INTO hz_coin_logs VALUES('100',$1,'ATTENDANCE',$2,$3::timestamptz)",[user,reward,day+'T01:02:03+09:00']);
 }
 const calls=[];let queue=Promise.resolve();const pool={connect:async()=>{const wait=queue;let release;queue=new Promise(r=>release=r);await wait;return{query:async(s,p)=>{calls.push(s);return query(s,p);},release};}};
 try{
  const [a,b]=await Promise.all(['1','2'].map(userId=>readSnapshot(pool,{roomId:'100',userId,now:new Date('2026-10-18T18:00:00Z')})));
  assert.equal(a.total,2);assert.equal(a.streak,2);assert.equal(a.reward,'31000');assert.equal(a.name,'긴닉네임'.repeat(40));
  assert.equal(b.total,1);assert.equal(b.streak,1);assert.equal(b.reward,'30000');assert.equal(b.name,'다른 사용자');
  assert.equal(a.calendar.cells.filter(x=>x?.attended).length,2);assert.equal(b.calendar.cells.filter(x=>x?.attended).length,1);
  assert.equal(a.ranks['2026-10-18'],1);assert.equal(a.ranks['2026-10-19'],1);
  assert.equal(b.ranks['2026-10-19'],2);
  for(const [userId,rank]of [['3',3],['4',4]]){
   const value=await readSnapshot(pool,{roomId:'100',userId,now:new Date('2026-10-19T00:00:00Z')});assert.equal(value.ranks['2026-10-19'],rank);
  }
  const otherRoom=await readSnapshot(pool,{roomId:'200',userId:'1',now:new Date('2026-10-19T00:00:00Z')});assert.deepEqual(otherRoom.ranks,{});
  const next=await readSnapshot(pool,{roomId:'100',userId:'1',now:new Date('2026-11-01T00:00:00Z')});assert.equal(next.calendar.cells.filter(x=>x?.attended).length,0);assert.equal(next.reward,null);assert.equal(next.total,2);assert.deepEqual(next.ranks,{});
  const boundary=await readSnapshot(pool,{roomId:'100',userId:'1',attendanceDate:'2026-10-19',now:new Date('2026-10-19T15:00:00Z')});assert.equal(boundary.today,'2026-10-20');assert.equal(boundary.attendanceDate,'2026-10-19');assert.equal(boundary.reward,'31000');assert.equal(boundary.calendar.cells.filter(x=>x?.highlightToday).length,0);
  assert.ok(calls.every(s=>!/\bINSERT|\bUPDATE|\bDELETE|\bALTER|\bCREATE/.test(s)));
  // A new loader invocation reads the same durable rows without any in-memory state.
  assert.equal((await readSnapshot(pool,{roomId:'100',userId:'1',now:new Date('2026-10-19T00:00:00Z')})).reward,'31000');
 }finally{await db.close();}
});
