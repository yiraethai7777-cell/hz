'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const approvals=require('../shared/valorant-approvals');
const stats=require('../shared/valorant-stats');
function fakeDb(){
 const rows=new Map();
 const db={rows,queries:[],async query(sql,args=[]){
  this.queries.push({sql,args});
  if(sql.includes('CREATE TABLE IF NOT EXISTS'))return{rows:[]};
  if(sql.startsWith('SELECT EXISTS('))return{rows:[{approved:rows.has(args[0])}]};
  if(sql.startsWith('INSERT INTO hz_valorant_approved_players')){
   rows.set(args[0],{name:args[1],tag:args[2],by:args[3]});
   return {rowCount:1};
  }
  if(sql.startsWith('DELETE FROM hz_valorant_approved_players'))
   return {rowCount:Number(rows.delete(args[0]))};
  throw Error('Unexpected SQL: '+sql);
 }};
 return db;
}
const target=(name='Shine',tag='3333')=>stats.parse('!전적 '+name+'#'+tag+' ap');
test('DB approvals recognize normalized Riot IDs and can be added/revoked without env changes',async()=>{
 const db=fakeDb(),env={VALORANT_APPROVED_PLAYERS:'bsh#3333'};
 const shine=target();
 assert.equal(await approvals.isApproved(shine,{db,env}),false);
 await approvals.approve(shine,{approvedBy:'bot-user',db});
 assert.equal(await approvals.isApproved(target('shine'),{db,env}),true);
 assert.equal(await approvals.isApproved(target('bsh'),{db,env}),true,'old env allowlist remains compatible');
 assert.equal(await approvals.revoke(shine,{db}),true);
 assert.equal(await approvals.isApproved(shine,{db,env}),false);
 assert.equal(db.rows.size,0);
});
test('Only the bot account may manage approvals; arbitrary users cannot enroll themselves',async()=>{
 const db=fakeDb(),replies=[];
 const send=async t=>replies.push(t);
 assert.equal(await approvals.handle({text:'!발로승인 Shine#3333',userId:'attacker',isBotAccount:false,db,send}),true);
 assert.equal(db.rows.size,0);
 assert.equal(replies.length,0);
 assert.equal(await approvals.handle({text:'!발로승인 Shine#3333',userId:'bot',isBotAccount:true,db,send}),true);
 assert.match(replies.at(-1),/허용 목록\(DB\)에 추가/);
 assert.equal(db.rows.size,1);
 await approvals.handle({text:'!발로승인해제 Shine#3333',userId:'attacker',isBotAccount:false,db,send});
 assert.equal(db.rows.size,1);
 await approvals.handle({text:'!발로승인해제 Shine#3333',userId:'bot',isBotAccount:true,db,send});
 assert.equal(db.rows.size,0);
});
test('Saved account alone does not enter approved player list and DB failures block requests',async()=>{
 const db=fakeDb(),shine=target();
 assert.equal(await approvals.isApproved(shine,{db,env:{}}),false);
 const broken={query:async()=>{throw Error('DB unavailable');}};
 await assert.rejects(()=>approvals.isApproved(shine,{db:broken,env:{}}),/DB unavailable/);
});
test('DB-approved player uses existing formatted Valorant lookup and fallback rate limiting',async()=>{
 const db=fakeDb(),shine=target();
 await approvals.approve(shine,{approvedBy:'bot-user',db});
 const calls=[],sent=[];
 const fetcher=async url=>{
  calls.push(url);
  const data=url.includes('/mmr/')?
   {account:{puuid:'shine-puuid'},current:{tier:{name:'Bronze 2'},rr:34},peak:{tier:{name:'Silver 1'}}}:
   [{metadata:{map:{name:'Lotus'},mode:{name:'Competitive'}},
     players:[{name:'Shine',tag:'3333',puuid:'shine-puuid',team_id:'Red',agent:{name:'Jett'},
       stats:{kills:20,deaths:14,assists:5,headshots:10,bodyshots:20,legshots:10}}],
     teams:[{team_id:'Red',won:true}]}];
  return {ok:true,status:200,json:async()=>({status:200,data})};
 };
 await stats.handle({text:'!발로전적 Shine#3333 ap',roomId:'77',userId:'db-approved-user',
  env:{HENRIKDEV_API_KEY:'test-key'},db,fetcher,send:async msg=>sent.push(msg)});
 assert.equal(calls.length,3);
 assert.ok(calls.every(c=>c.includes('/ap/pc/Shine/3333')));
 assert.match(sent[0],/현재 티어: 브론즈 2/);
 assert.match(sent[0],/20\/14\/5/);
});
