'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const recruit=require('../shared/valorant-recruit-reply');
const party=require('../shared/valorant-party');
const community=require('../shared/valorant-community');
function reply(original,bot='99999'){
 const msg={message:{attachment:{reply:{src_logId:original.message.logId,src_userId:original.sender.id}}}};
 return {msg,client:{userId:bot,fetchMessage:async()=>original}};
}
test('verified Kakao reply resolves actual duo and party recruiting owners',async()=>{
 const original={room:{id:'44444'},message:{logId:'77777',text:'!듀오모집 골드 경쟁전'},sender:{id:'22222'}};
 const ctx=reply(original);
 assert.deepEqual((({kind,owner})=>({kind,owner}))(await recruit.resolve({...ctx,roomId:'44444'})),{kind:'duo',owner:'22222'});
 original.message.text='!파티모집 3 경쟁전';assert.equal((await recruit.resolve({...ctx,roomId:'44444'})).kind,'party');
 original.message.text='임의의 다른 메시지';assert.equal(await recruit.resolve({...ctx,roomId:'44444'}),null);
 original.message.text='!듀오모집 골드';original.room.id='55555';
 assert.equal(await recruit.resolve({...ctx,roomId:'44444'}),null);
});
test('bot-authored recruitment reply requires recorded recruiting owner ID',async()=>{
 const source={room:{id:'44444'},message:{logId:'77777',text:'✅ 듀오 모집 등록\n모집자 ID: 22222'},sender:{id:'99999'}};
 const ctx=reply(source);
 assert.equal((await recruit.resolve({...ctx,roomId:'44444'})).owner,'22222');
 source.message.text='✅ 듀오 모집 등록\n모집자 ID: 미상';
 assert.equal(await recruit.resolve({...ctx,roomId:'44444'}),null);
});
test('recruitment owner notification uses a real mention marker',async()=>{
 const sent=[];
 await recruit.alertOwner({roomId:'44444',chat:{mention:(id,name)=>'\u0002'+id+'\u0003'+name+'\u0004'},send:async x=>sent.push(x),
  ownerId:'22222',ownerName:'모집자',applicantName:'지원자',kind:'duo'});
 assert.match(sent[0],/^\u000222222\u0003모집자\u0004님, 지원자님이 듀오 신청을 했습니다/);
});
function mockDb(){
 const parties=new Map(),notes=[];
 const query=async(sql,args=[])=>{
  if(sql.includes('CREATE TABLE')||sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK'||sql.includes('pg_advisory_xact_lock'))return {rowCount:0,rows:[]};
  if(sql.includes('SELECT owner_id FROM hz_valorant_parties')&&sql.includes('members @>')){
   const user=JSON.parse(args[1])[0].id;
   const rows=[...parties.values()].filter(p=>p.owner_id!==args[2]&&p.members.some(x=>x.id===user));
   return {rowCount:rows.length,rows};
  }
  if(sql.startsWith('SELECT members FROM hz_valorant_parties')){
   const p=parties.get(args[1]);return {rows:p?[p]:[],rowCount:p?1:0};
  }
  if(sql.startsWith('INSERT INTO hz_valorant_parties')){
   const p={owner_id:args[1],owner_name:args[2],capacity:args[3],description:args[4],members:JSON.parse(args[5])};
   parties.set(p.owner_id,p);return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('SELECT * FROM hz_valorant_parties')&&sql.includes('owner_id')){
   const p=parties.get(args[1]);return {rows:p?[p]:[],rowCount:p?1:0};
  }
  if(sql.startsWith('SELECT owner_id FROM hz_valorant_parties')&&sql.includes('owner_id<>')){
   const user=JSON.parse(args[1])[0].id;
   const rows=[...parties.values()].filter(p=>p.owner_id!==args[2]&&p.members.some(x=>x.id===user));
   return {rowCount:rows.length,rows};
  }
  if(sql.startsWith('UPDATE hz_valorant_parties SET members')){
   parties.get(args[1]).members=JSON.parse(args[2]);return {rowCount:1,rows:[]};
  }
  if(sql.startsWith('SELECT * FROM hz_valorant_parties')&&sql.includes('members @>')){
   const user=JSON.parse(args[1])[0].id,p=[...parties.values()].find(p=>p.members.some(x=>x.id===user));
   return {rows:p?[p]:[],rowCount:p?1:0};
  }
  if(sql.startsWith('DELETE FROM hz_valorant_parties')){
   const had=parties.delete(args[1]);return {rowCount:had?1:0,rows:[]};
  }
  throw Error('unexpected SQL: '+sql);
 };
 const client={query,release(){}};
 return {parties,notes,db:{query,connect:async()=>client}};
}
test('2-player party respects capacity and notifies only on new successful joins',async()=>{
 const {db,parties}=mockDb(),sent=[];
 const send=async x=>sent.push(x),chat={mention:(id,name)=>'\u0002'+id+'\u0003'+name+'\u0004'};
 const owner={text:'!파티모집 2 경쟁전',roomId:'44444',userId:'22222',userName:'모집자',db,send,chat};
 await party.handle(owner);
 assert.equal(parties.get('22222').capacity,2);
 await party.handle({...owner,text:'!파티참가 22222',userId:'33333',userName:'지원자'});
 assert.equal(parties.get('22222').members.length,2);
 assert.match(sent.at(-1),/모집자.*파티 참가/);
 await party.handle({...owner,text:'!파티참가 22222',userId:'44445',userName:'늦은지원'});
 assert.match(sent.at(-1),/정원이 가득/);
});
test('reformed scrim teams must differ while preserving all ten members',()=>{
 const players=Array.from({length:10},(_,i)=>({user_id:String(i+10000),rating:1000+i*100}));
 const old=community.choose(players);
 const newer=community.chooseDifferent(players,old.a.map(p=>p.user_id));
 assert.equal(newer.a.length,5);assert.equal(newer.b.length,5);
 assert.equal(new Set([...newer.a,...newer.b].map(p=>p.user_id)).size,10);
 assert.notDeepEqual(new Set(newer.a.map(p=>p.user_id)),new Set(old.a.map(p=>p.user_id)));
 assert.notDeepEqual(new Set(newer.a.map(p=>p.user_id)),new Set(old.b.map(p=>p.user_id)));
});
