'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const blocks=require('../shared/command-blocks');
test('command-only blocking is room-scoped and survives database-backed lookups',async()=>{
 const rows=new Map(),db={
  async query(sql,args=[]){
   if(sql.includes('CREATE TABLE IF NOT EXISTS hz_command_blocks'))return {rows:[],rowCount:0};
   if(sql.includes('CREATE TABLE IF NOT EXISTS hz_super_admins')||sql.includes('SELECT 1 FROM hz_super_admins'))return {rows:[],rowCount:0};
   if(sql.includes('FROM hz_command_blocks WHERE room_id=$1 AND user_id=$2 LIMIT 1')){
    const item=rows.get(args[0]+':'+args[1]);return {rows:item?[item]:[],rowCount:item?1:0};
   }
   if(sql.startsWith('SELECT user_id,user_name,actor_id,reason,created_at FROM hz_command_blocks')){
    const list=[...rows.values()].filter(x=>x.room_id===args[0]);return {rows:list,rowCount:list.length};
   }
   if(sql.includes('FROM gl_manage_admins'))return {rows:[],rowCount:0};
   if(sql.includes('INSERT INTO hz_command_blocks')){
    rows.set(args[0]+':'+args[1],{room_id:args[0],user_id:args[1],user_name:args[2],actor_id:args[3],reason:args[4]});
    return {rows:[{user_id:args[1]}],rowCount:1};
   }
   if(sql.includes('DELETE FROM hz_command_blocks')){
    const changed=rows.delete(args[0]+':'+args[1]);return {rows:changed?[{user_id:args[1]}]:[],rowCount:changed?1:0};
   }
   throw Error('Unexpected SQL: '+sql);
  }
 };
 // Block set uses the same existing production permissions module; inject a non-admin
 // through its public query contract by providing the mock DB.
 assert.equal(await blocks.blocked('10001','20002',db),false);
 await blocks.set({roomId:'10001',userId:'20002',userName:'사용자',actorId:'30003',reason:'도배',db,botId:'90000'});
 assert.equal(await blocks.blocked('10001','20002',db),true);
 assert.equal(await blocks.blocked('10002','20002',db),false);
 assert.equal((await blocks.list('10001',db)).length,1);
 await blocks.set({roomId:'10001',userId:'20002',actorId:'30003',on:false,db});
 assert.equal(await blocks.blocked('10001','20002',db),false);
});
test('block target validation and command detection',async()=>{
 assert.equal(blocks.identity('12345'),'12345');
 assert.equal(blocks.identity('invalid'),'');
 assert.equal(blocks.commandLike('!퀴즈'),true);
 assert.equal(blocks.commandLike('#정답 답'),true);
 assert.equal(blocks.commandLike('오늘은 날씨가 좋아요'),false);
});
test('router stops all blocked users before game, VALORANT or admin commands',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../shared/router.js'),'utf8');
 const gate=source.indexOf('if(await blocks.blocked(roomId,senderId))');
 const valorant=source.indexOf('const newValorantCommand=');
 assert.ok(gate>=0&&valorant>gate);
 assert.match(source,/await management\.message\(\{client,roomId,userId:senderId,userName/);
});
