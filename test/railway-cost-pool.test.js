'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const db=require('../shared/db');
const runtime=require('../shared/runtime');

test('game and manager reuse one shared PostgreSQL pool',async()=>{
 const oldUrl=process.env.DATABASE_URL;
 process.env.DATABASE_URL='postgresql://postgres:placeholder@127.0.0.1:5432/placeholder';
 try{
  const shared=db.getPool();
  const game=runtime.createRuntime();
  assert.strictEqual(game.pool,shared);
  const supplied={query:async()=>({rows:[]})};
  const injected=runtime.createRuntime({pool:supplied});
  assert.strictEqual(injected.pool,supplied,'dependency injection remains available');
 }finally{
  await db.closeDatabase();
  if(oldUrl===undefined)delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL=oldUrl;
 }
});
