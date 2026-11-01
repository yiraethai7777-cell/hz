'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const roles=require('../shared/super-admin');
function dbMock(){
 const rows=new Map();
 return {rows,async query(sql,args=[]){
  if(sql.includes('CREATE TABLE IF NOT EXISTS'))return{rowCount:0,rows:[]};
  if(sql.startsWith('INSERT INTO hz_super_admins')){
   const key=args[0]+':'+args[1],added=!rows.has(key);
   if(added)rows.set(key,{user_id:args[1],granted_by:args[2]});
   return {rowCount:Number(added),rows:[]};
  }
  if(sql.startsWith('DELETE FROM hz_super_admins'))return {rowCount:Number(rows.delete(args[0]+':'+args[1])),rows:[]};
  if(sql.startsWith('SELECT 1 FROM hz_super_admins')){
   const found=rows.has(args[0]+':'+args[1]);return {rowCount:Number(found),rows:found?[{exists:1}]:[]};
  }
  if(sql.startsWith('SELECT user_id,granted_by,created_at FROM hz_super_admins')){
   const matches=[...rows].filter(([key])=>key.startsWith(args[0]+':')).map(([key,row])=>row);
   return {rowCount:matches.length,rows:matches};
  }
  throw Error('Unexpected SQL: '+sql);
 }};
}
test('Superadmins are room-scoped, remain in PostgreSQL, and can be revoked',async()=>{
 const db=dbMock();
 assert.equal(roles.valid('18488833697726831'),'18488833697726831');
 assert.equal(roles.valid('non-numeric'),'');
 assert.equal(await roles.isSuperAdmin('18488833697726831','1234567890',db),false);
 assert.equal(await roles.update('18488833697726831','1234567890','bot','add',db),true);
 assert.equal(await roles.update('18488833697726831','1234567890','bot','add',db),false);
 assert.equal(await roles.isSuperAdmin('18488833697726831','1234567890',db),true);
 assert.equal(await roles.isSuperAdmin('18488833697726832','1234567890',db),false);
 assert.equal((await roles.list('18488833697726831',db)).length,1);
 assert.equal(await roles.update('18488833697726831','1234567890','web:admin','remove',db),true);
 assert.equal(await roles.isSuperAdmin('18488833697726831','1234567890',db),false);
});
test('Untrusted room/user IDs are rejected before any writes',async()=>{
 const db=dbMock();
 await assert.rejects(()=>roles.update('oops','1234567890','bot','add',db),/확인/);
 await assert.rejects(()=>roles.update('18488833697726831','x OR 1=1','bot','add',db),/확인/);
 assert.equal(db.rows.size,0);
});
