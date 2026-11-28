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
  fs.mkdirSync(path.join(dir,'game-accounts'));fs.writeFileSync(path.join(dir,'game-accounts','123.json'),JSON.stringify({users:{456:{joinedAt:1700000000000,coins:0,inventory:{}}}}));db.mark('game-accounts/123.json');assert.equal(await db.flush(),true);assert.equal((await engine.query('SELECT payload FROM duke_game_accounts')).rows[0].payload.users['456'].coins,0);
  const {createSavedAccounts}=require('../valorant/saved-accounts');
  const saved=createSavedAccounts({dir,onPersist:db.mark});
  saved.save('456',{name:'Player',tag:'KR1',region:'kr'});
  assert.equal(await db.flush(),true);
  assert.equal((await engine.query('SELECT payload FROM duke_valorant_accounts')).rows[0].payload[0].name,'Player');
  await db.close();db=null;fs.unlinkSync(path.join(dir,'valorant-accounts','456.json'));fs.unlinkSync(path.join(dir,'command-counts.json'));fs.unlinkSync(path.join(dir,'game-accounts','123.json'));
  db=createDatabase({dir,pool,logger,intervalMs:60000});await db.init();assert.equal(createCounter({dir,now:()=>1700000000000}).get().total,3);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'game-accounts','123.json'),'utf8')).users['456'].joinedAt,1700000000000);assert.equal(tableFor('game-accounts/123.json'),'duke_game_accounts');assert.deepEqual(createSavedAccounts({dir}).list('456'),[{name:'Player',tag:'KR1',region:'kr'}]);assert.equal(tableFor('valorant-accounts/456.json'),'duke_valorant_accounts');assert.equal(tableFor('../auth.json'),null);assert.equal(tableFor('management-logs/123.json'),'duke_management_logs');
 }finally{if(db)await db.close();await engine.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('wrong database rejected before schema changes',async()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-db-'));try{let calls=0;const db=createDatabase({dir,pool:{query:async()=>{calls++;return {rows:[{name:'railway'}]};}}});await assert.rejects(db.init(),/unexpected database/);assert.equal(calls,1);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
