'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../api/room-portal.js'),'utf8');
const SITE='f'.repeat(24),ROOM='18496234145974738';
function harness({authenticated=true,found=true,csrfValid=true}={}){
 const queries=[];
 let csrfChecked=0,commits=0,rollbacks=0;
 const client={
  async query(sql,params=[]){
   queries.push({sql,params});
   if(sql==='COMMIT'){commits++;return {rowCount:0,rows:[]};}
   if(sql==='ROLLBACK'){rollbacks++;return {rowCount:0,rows:[]};}
   if(/^DELETE FROM gl_room_portals/.test(sql)){
    if(found&&params[0]===ROOM&&params[1]===SITE)
     return {rowCount:1,rows:[{id:9,label:'테스트 웹',room_name:'테스트방'}]};
    return {rowCount:0,rows:[]};
   }
   return {rowCount:0,rows:[]};
  },
  release(){}
 };
 const db={query:(...args)=>client.query(...args),connect:async()=>client};
 const mocks={
  '../shared/db':{getPool:()=>db},
  '../shared/store':{id:v=>{const s=String(v);if(!/^\d{1,24}$/.test(s))throw Error('ID 형식 오류');return s;}},
  './auth':{
   session:async()=>authenticated?{user:'master',csrf:'test'}:null,
   csrf:()=>{csrfChecked++;if(!csrfValid)throw Error('CSRF 오류');}
  },
  './routes':{status:{connected:false}},
  '../shared/room-subscriptions':{init:async()=>{},view:row=>row,validPlan:x=>x,validDays:x=>x}
 };
 const module={exports:{}};
 vm.runInNewContext(source,{
  module,require:id=>Object.hasOwn(mocks,id)?mocks[id]:require(id),
  console,Buffer,process
 },{filename:'api/room-portal.js'});
 async function remove(body){
  return module.exports.routes({method:'DELETE',headers:{}},{},new URL('http://localhost/api/admin/room-portals'),body);
 }
 return {remove,queries,get commits(){return commits;},get rollbacks(){return rollbacks;},get csrfChecked(){return csrfChecked;}};
}
const valid=()=>({roomId:ROOM,site:SITE,confirm:true,confirmationRoomId:ROOM});

test('only master may delete portal; CSRF and typed room ID are required',async()=>{
 for(const [options,body,matcher] of [
  [{authenticated:false},valid(),/총관리자/],
  [{csrfValid:false},valid(),/CSRF/],
  [{}, {...valid(),confirm:false},/삭제할 방 ID/],
  [{}, {...valid(),confirmationRoomId:'9999'},/삭제할 방 ID/],
  [{}, {...valid(),site:'x'.repeat(24)},/삭제할 방 ID/]
 ]){
  const h=harness(options);
  await assert.rejects(h.remove(body),matcher);
  assert.equal(h.queries.some(q=>q.sql.startsWith('DELETE FROM gl_room_portals')),false);
 }
});

test('issued website deletion revokes only matching site, commits audit, preserves room state',async()=>{
 const h=harness();
 const result=await h.remove(valid());
 assert.equal(result.ok,true);
 assert.equal(result.roomId,ROOM);
 assert.equal(h.commits,1);
 assert.equal(h.rollbacks,0);
 assert.equal(h.csrfChecked,1);
 const deletion=h.queries.find(q=>q.sql.startsWith('DELETE FROM gl_room_portals'));
 assert.deepEqual(Array.from(deletion.params),[ROOM,SITE]);
 assert.equal(h.queries.some(q=>/^(DELETE|UPDATE) (?:FROM )?(?:hz_rooms|gl_room_subscriptions|gl_manage_rooms)/.test(q.sql)),false);
 assert.equal(h.queries.some(q=>q.sql.startsWith('INSERT INTO gl_audit')),true);
 assert.match(source,/gl_room_portal_sessions \([\s\S]*ON DELETE CASCADE/);
});

test('stale site slug fails closed and transaction rolls back',async()=>{
 const h=harness({found:false});
 await assert.rejects(h.remove(valid()),/이미 삭제|변경/);
 assert.equal(h.commits,0);
 assert.equal(h.rollbacks,1);
});

test('reissuing an issued room website reuses its existing subscription',()=>{
 assert.match(source,/!existing\.rowCount&&!activate&&!license/);
 assert.match(source,/roomSubscriptions/);
 const web=fs.readFileSync(path.join(__dirname,'../admin-web/room-portals.js'),'utf8');
 assert.match(web,/roomSubscriptions\[\$\('#room'\)\.value\]/);
 assert.match(web,/confirmationRoomId:typed\.trim\(\)/);
});
