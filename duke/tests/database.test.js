'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createDatabase,tableFor}=require('../database'),{createCounter}=require('../metrics');
test('database schema, existing local migration, batched persistence and recovery',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const engine=new PGlite();
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-db-'));let db;
 const pool={query:(q,params)=>q==='SELECT current_database() AS name'?Promise.resolve({rows:[{name:'duke'}]}):engine.query(q,params),end:async()=>{}};
 const logger={log(){},error(){}};
 try{
  const counter=createCounter({dir,now:()=>1700000000000});counter.record();
  db=createDatabase({dir,pool,logger,intervalMs:60000});await db.init();
  let row=(await engine.query('SELECT payload FROM duke_command_counts')).rows[0];assert.equal(row.payload.total,1);
  const c=createCounter({dir,now:()=>1700000000000,onPersist:db.mark});c.record();c.record();assert.match(db.status().database,/저장 대기/);assert.equal(await db.flush(),true);
  row=(await engine.query('SELECT payload FROM duke_command_counts')).rows[0];assert.equal(row.payload.total,3);
  await db.close();db=null;fs.unlinkSync(path.join(dir,'command-counts.json'));
  db=createDatabase({dir,pool,logger,intervalMs:60000});await db.init();assert.equal(createCounter({dir,now:()=>1700000000000}).get().total,3);
  assert.equal(tableFor('../auth.json'),null);assert.equal(tableFor('management-logs/123.json'),'duke_management_logs');
 }finally{if(db)await db.close();await engine.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('wrong database rejected before schema changes',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-db-'));try{let calls=0;const db=createDatabase({dir,pool:{query:async()=>{calls++;return {rows:[{name:'railway'}]};}}});await assert.rejects(db.init(),/unexpected database/);assert.equal(calls,1);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
