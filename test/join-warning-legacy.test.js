'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {PGlite}=require('@electric-sql/pglite');

test('legacy management join and leave templates receive active warning counts and reasons',async()=>{
 const storage=new PGlite(),sent=[];
 const localRequire=createRequire(path.join(__dirname,'../manage/index.js'));
 const db={query:async(sql,args)=>{
  if(sql.includes('FROM gl_manage_warnings'))return storage.query(sql,args);
  if(sql.includes('AS enabled'))return {rows:[{enabled:true}]};
  if(sql.includes('FROM gl_manage_members'))return {rows:[{joins:2,leaves:1,last_joined_at:new Date()}]};
  if(sql.includes('FROM gl_manage_actions'))return {rows:[{n:0}]};
  if(sql.includes('FROM hz_members'))return {rows:[{}]};
  if(sql.includes('AS value FROM hz_rooms'))return {rows:[{value:'(이름) (입장횟수)/(퇴장횟수) (경고횟수)/(경고사유)'}]};
  return {rows:[]};
 }};
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../manage/index.js'),'utf8'),{
  module,exports:module.exports,require:id=>id==='../shared/db'?{getPool:()=>db}:localRequire(id),
  process,console,Date,Intl,Set,Number,String,Object,RegExp,Promise
 });
 try{
  await storage.exec(`CREATE TABLE gl_manage_warnings(id BIGSERIAL PRIMARY KEY,room_id TEXT,user_id TEXT,reason TEXT,removed BOOLEAN DEFAULT FALSE)`);
  await storage.query('INSERT INTO gl_manage_warnings(room_id,user_id,reason,removed) VALUES ($1,$2,$3,FALSE),($1,$2,$4,TRUE),($5,$2,$4,FALSE)',
   ['100','9007199254740993123','도배','제외 사유','200']);
  const context={roomId:'100',userId:'9007199254740993123',userName:'회원',send:async text=>sent.push(text)};
  await module.exports.join(context);
  assert.equal(sent.pop(),'회원 2/1 1/도배');
  await module.exports.leave(context);
  assert.equal(sent.pop(),'회원 2/1 1/도배');
  await storage.exec('UPDATE gl_manage_warnings SET removed=TRUE');
  await module.exports.join(context);
  assert.equal(sent.pop(),'회원 2/1 0/없음');
 }finally{await storage.close();}
});

test('entry command documents, saves and resets warning reason templates with existing permissions',async()=>{
 const storage=new PGlite(),sent=[];
 const db={query:(sql,args)=>storage.query(sql,args)};
 const localRequire=createRequire(path.join(__dirname,'../manage/commands-v2.js'));
 const module={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../manage/commands-v2.js'),'utf8'),{
  module,exports:module.exports,require:id=>id==='../shared/db'?{getPool:()=>db}:localRequire(id),
  process,console,Date,Intl,Set,Number,String,Object,RegExp,Promise
 });
 try{
  await storage.exec(`CREATE TABLE gl_manage_rooms(room_id TEXT PRIMARY KEY,enabled BOOLEAN);
   CREATE TABLE gl_manage_admins(room_id TEXT,user_id TEXT);
   CREATE TABLE hz_rooms(room_id TEXT PRIMARY KEY,data JSONB DEFAULT '{}',updated_at TIMESTAMPTZ DEFAULT NOW());
   INSERT INTO gl_manage_rooms VALUES('100',TRUE)`);
  const context={roomId:'100',userId:'200',senderType:4,send:async text=>sent.push(text)};
  await module.exports.handle({...context,text:'!입장변경'});
  assert.ok(sent.pop().includes('(경고사유)'));
  const template='(멘션) 경고 (경고횟수)개\n사유: (경고사유)';
  await module.exports.handle({...context,text:'!입장변경 '+template});
  const saved=async()=>(await storage.query("SELECT data->>'joinTemplate' AS value FROM hz_rooms WHERE room_id='100'")).rows[0]?.value;
  assert.equal(await saved(),template);
  await module.exports.handle({...context,senderType:2,text:'!입장변경 권한 없음'});
  assert.equal(await saved(),template);
  await module.exports.handle({...context,text:'!입장변경 기본'});
  assert.equal(await saved(),'');
 }finally{await storage.close();}
});
