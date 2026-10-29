'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {BSON,Long}=require('bson');
const lossless=require('lossless-json');
const {PGlite}=require('@electric-sql/pglite');
const {id,original}=require('../shared/delete-message');
const ROOM='18496234145974738',MID='3962250785802233857';

test('wire BSON and lossless JSON preserve raw IDs through actual message/delete builders',async()=>{
 const {KakaoForgeClient}=require('../dist/client/client');
 const {LocoPacket}=require('../dist/protocol/loco-packet');
 const {normalizeIdValue}=require('../dist/utils/helpers');
 assert.equal(normalizeIdValue(Number(MID)),0);
 assert.equal(id(Number(MID)),null);
 for(const raw of [
  LocoPacket.parseBody(BSON.serialize({id:Long.fromString(MID),chatRoomId:Long.fromString(ROOM),userId:279125041,message:'테스트',authorName:'fixture'})),
  lossless.parse(`{"id":${MID},"chatRoomId":${ROOM},"userId":279125041,"message":"테스트","authorName":"fixture"}`)
 ]){
  const client=new KakaoForgeClient({autoConnect:false,autoReconnect:false});
  client._chatRooms.set(ROOM,{roomName:'fixture'});
  client._ensureMemberList=()=>{};
  const msg=await client._buildMessageEvent({chatLog:raw});
  assert.equal(String(msg.message.logId),MID);
  assert.equal(String(msg.room.id),ROOM);
  assert.equal(original(msg).messageId,MID);
  assert.equal(original(msg).text,'테스트');
  const event=await client._buildModerationEventFromPush('delete',{method:'SYNCDLMSG',body:{chatId:raw.chatRoomId,logId:raw.id}});
  assert.equal(String(event.message.logId),MID);
  assert.equal(String(event.room.id),ROOM);
 }
 const mismatch=original({raw:{chatLog:{id:MID,logId:'3962250818677188609',chatRoomId:ROOM}}});
 assert.equal(mismatch.comparison.idLogMatch,false);
});

test('PostgreSQL stores exact IDs, retrieves original once, and never warns on a miss',async()=>{
 const db=new PGlite(),dir=await fs.mkdtemp(path.join(os.tmpdir(),'delete-watch-'));
 const logs=[];let fail=false,fileFail=false;
 const query=async(sql,params)=>{
  if(fail&&sql.startsWith('INSERT INTO gl_manage_temp_messages'))throw Object.assign(new Error('private body and connection credentials'),{code:'08006'});
  const result=await db.query(sql,params);return {...result,rowCount:result.affectedRows??result.rows.length};
 };
 const pool={query,connect:async()=>({query,release(){}})};
 await db.exec(`CREATE TABLE gl_manage_rooms(room_id TEXT PRIMARY KEY,enabled BOOLEAN,deleted_enabled BOOLEAN);
 CREATE TABLE gl_manage_temp_messages(room_id TEXT,message_id TEXT,user_id TEXT,user_name TEXT,body TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(room_id,message_id));
 CREATE TABLE gl_manage_deleted_processed(room_id TEXT,message_id TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),PRIMARY KEY(room_id,message_id));
 CREATE TABLE gl_manage_warnings(room_id TEXT,user_id TEXT,user_name TEXT,reason TEXT,issuer_id TEXT,removed BOOLEAN DEFAULT FALSE);`);
 await query('INSERT INTO gl_manage_rooms VALUES($1,true,true)',[ROOM]);
 const m={exports:{}};
 vm.runInNewContext(await fs.readFile(path.join(__dirname,'../manage/delete-watch.js'),'utf8'),{
  module:m,exports:m.exports,process:{env:{DELETE_LOG_DIR:dir}},console:Object.fromEntries(['log','warn','error'].map(k=>[k,(...a)=>logs.push(a.join(' '))])),
  require:n=>n==='../shared/db'?{getPool:()=>pool}:n==='../shared/delete-message'?require('../shared/delete-message'):n==='node:fs/promises'?{...fs,appendFile:async(...args)=>{if(fileFail)throw Object.assign(new Error('private path'),{code:'EACCES'});return fs.appendFile(...args);}}:require(n)
 });
 const watcher=m.exports,sent=[];
 try{
  const record={roomId:ROOM,messageId:MID,userId:'279125041',userName:'private-name',text:'테스트',botId:'9999'};
  assert.equal(await watcher.observe(record),true);
  assert.equal(await watcher.observe(record),true);
  const rows=await query('SELECT * FROM gl_manage_temp_messages');
  assert.equal(rows.rows[0].message_id,MID);assert.equal(rows.rows[0].room_id,ROOM);
  assert.equal(await watcher.onDelete({...record,send:async text=>sent.push(text)}),true);
  assert.match(sent[0],/테스트/);assert.match(sent[0],/경고 1회 지급/);
  assert.equal(await watcher.onDelete({...record,send:async text=>sent.push(text)}),false);
  // A mismatched fetch response must never provide an unrelated original.
  await watcher.onDelete({...record,messageId:'3962250818677188609',fetchOriginal:async()=>({raw:{chatLog:{id:MID,chatRoomId:ROOM,userId:'279125041',message:'unrelated'}}}),send:async text=>sent.push(text)});
  assert.match(sent.at(-1),/원문 미확인으로 경고 미지급/);
  assert.equal((await query('SELECT * FROM gl_manage_warnings')).rows.length,1);
  fileFail=true;
  await watcher.observe({...record,messageId:'3962250785802233858'});
  assert.equal((await query('SELECT * FROM gl_manage_temp_messages')).rows.length,2);
  fail=true;
  await assert.rejects(()=>watcher.observe({...record,messageId:'3962250785802233859'}));
  assert.ok(logs.some(x=>x.includes('"status":"inserted"')));
  assert.ok(logs.some(x=>x.includes('"status":"duplicate"')));
  assert.ok(logs.some(x=>x.includes('"stage":"insert"')&&x.includes('08006')));
  assert.ok(logs.some(x=>x.includes('EACCES')));
  assert.doesNotMatch(logs.join('\n'),new RegExp(`${MID}|${ROOM}|테스트|private|unrelated`));
 }finally{await db.close();await fs.rm(dir,{recursive:true,force:true});}
});
