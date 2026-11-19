'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

test('unchanged one-second profile snapshots avoid repeated database reads, renames still notify',async()=>{
 const code=fs.readFileSync(path.resolve(__dirname,'../manage/profile-watch.js'),'utf8');
 const m={exports:{}},room='18496234145974738',user='12345678';
 let time=100000,visibleName='Alice',rosterQueries=0,memberQueries=0;
 const alerts=[];
 const ctx={
  pool:{query:async(sql)=>{
   if(sql.includes('FROM hz_rooms')){rosterQueries++;return {rows:[{room_id:room}]};}
   if(sql.includes('FROM hz_members')){memberQueries++;return {rows:[{user_id:user,name:'Alice',observed_open_profile_link:''}]};}
   if(sql.startsWith('UPDATE hz_members'))return {rowCount:1,rows:[]};
   throw Error('Unexpected query '+sql);
  }},
  profileObserve:async()=>null,
  send:async(_chat,_room,message)=>alerts.push(message)
 };
 const client={
  connected:true,userId:'99999999',chat:{},
  on:()=>{},getChatRooms:async()=>{},
  getKnownChatRooms:()=>[{id:room}]
 };
 const moduleRequire=n=>{
  if(n==='../shared/live-roster')return {refresh:async()=>({members:[{id:user,name:visibleName,profileLinkId:null,profileType:1}]})};
  if(n==='./profile-alerts')return {sendNotice:async()=>{}};
  if(n==='../shared/bot-power')return {enabled:async()=>true};
  return require(n);
 };
 vm.runInNewContext(code,{
  module:m,exports:m.exports,require:moduleRequire,
  console:{log(){},warn(){},error(){}},
  process:{env:{}},Date
 });
 const watcher=m.exports.createWatcher(ctx,client,{now:()=>time});
 await watcher.tick();
 assert.equal(memberQueries,1);
 time+=1000;
 await watcher.tick();
 assert.equal(memberQueries,1,'unchanged snapshot should not read hz_members again');
 assert.equal(rosterQueries,1);
 visibleName='Bob';
 time+=1000;
 await watcher.tick();
 assert.equal(memberQueries,2,'name change must refresh member records');
 assert.ok(alerts.some(a=>a.includes('Alice')&&a.includes('Bob')));
});
