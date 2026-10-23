'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const createState=require('../shared/state');
const createFeatures=require('../game/features');
const data=require('../game/data');

function createRoomFixture(initial){
 const queries=[];
 let saved=initial==null?null:JSON.parse(JSON.stringify(initial));
 const client={
  release(){},
  async query(sql,params){
   queries.push(String(sql));
   if(String(sql).includes('SELECT data FROM hz_rooms')&&String(sql).includes('FOR UPDATE'))
     return {rows:saved==null?[]:[{data:JSON.parse(JSON.stringify(saved))}]};
   if(String(sql).startsWith('INSERT INTO hz_rooms')){
    if(saved==null)saved=JSON.parse(params[1]);
    return {rowCount:1};
   }
   if(String(sql).startsWith('UPDATE hz_rooms SET data=')){
    saved=JSON.parse(params[1]);
    return {rowCount:1};
   }
   return {rows:[],rowCount:0};
  }
 };
 const ctx={pool:{connect:async()=>client}};
 const state=createState(ctx);
 Object.assign(ctx,state);
 return {queries,ctx,state,getSaved:()=>saved};
}
test('existing room read skips unnecessary INSERT and UPDATE',async()=>{
 const f=createRoomFixture({name:'Test',game:true,quizEnabled:true,fishEnabled:true,
  manage:false,locked:false,players:{},attendance:{},quiz:null,quizQueue:[],lastQuiz:-1,promo:{
   enabled:false,antiSpam:true,sentTimes:[]}});
 const result=await f.state.withRoom('111','Test',async d=>d.game?'ok':'bad');
 assert.equal(result,'ok');
 assert.equal(f.queries.filter(x=>x.startsWith('INSERT INTO hz_rooms')).length,0);
 assert.equal(f.queries.filter(x=>x.startsWith('UPDATE hz_rooms SET')).length,0);
 assert.equal(f.queries.filter(x=>x.includes('FOR UPDATE')).length,1);
});
test('changed game room still persists and transaction commits',async()=>{
 const f=createRoomFixture({name:'Test',game:true,players:{},attendance:{}});
 await f.state.withRoom('111','Test',async d=>{d.game=false;});
 assert.equal(f.getSaved().game,false);
 assert.equal(f.queries.filter(x=>x.startsWith('UPDATE hz_rooms SET')).length,1);
 assert.equal(f.queries.at(-1),'COMMIT');
});
test('missing game room is initialized exactly once',async()=>{
 const f=createRoomFixture(null);
 await f.state.withRoom('111','Test',async d=>d.game);
 assert.equal(f.queries.filter(x=>x.startsWith('INSERT INTO hz_rooms')).length,1);
 assert.equal(f.queries.filter(x=>x.includes('FOR UPDATE')).length,2);
 assert.equal(f.getSaved().name,'Test');
});
test('auto fishing skips inactive or not-yet-due rooms',async()=>{
 const now=Date.now();
 const rows=[
  {room_id:'1',data:{game:true,fishEnabled:true,players:{}}},
  {room_id:'2',data:{game:true,fishEnabled:true,players:{a:{autoUntil:now+60000,lastFish:now}}}}
 ];
 let locked=0;
 const ctx={
  globalChat:{},FISHING_COOLDOWN_SECONDS:30,
  pool:{query:async()=>({rows})},
  withRoom:async()=>{locked++;return[];},
  send:async()=>{},
 };
 await createFeatures(ctx).autoFishTick();
 assert.equal(locked,0);
 rows.push({room_id:'3',data:{game:true,fishEnabled:true,players:{a:{autoUntil:now+60000,lastFish:0}}}});
 await createFeatures(ctx).autoFishTick();
 assert.equal(locked,1);
});
test('QUIZ title and question precede fold; difficulty follows fold',async()=>{
 const ctx={
  QUIZZES:data.QUIZZES,economyEnabled:false,
  QUIZ_SECONDS:60,QUIZ_COOLDOWN_SECONDS:15,QUIZ_REWARD:10000,QUIZ_XP:30,
  id:value=>String(value??''),n:value=>Number(value).toLocaleString('ko-KR'),
  shuffle:items=>items.reverse(),globalBotId:'9999'
 };
 const game=createFeatures(ctx);
 ctx.player=game.player;ctx.nextQuiz=game.nextQuiz;
 const room={name:'Test',players:{},game:true,quizEnabled:true,fishEnabled:true,locked:false};
 const msg={room:{id:'111'},sender:{id:'5555',name:'Tester'},message:{text:'#퀴즈'}};
 const first=await game.handleGame(room,{},msg,false);
 const fold='\u200b'.repeat(1200);
 const pos=first.indexOf(fold);
 assert.ok(pos>0);
 assert.match(first.slice(0,pos),/^\[ # \] QUIZ\n\nQ\. /);
 assert.doesNotMatch(first.slice(0,pos),/\[ (쉬움|도전) · /);
 assert.ok(first.slice(pos+fold.length).includes(
  '[ '+room.quiz.difficulty+' · '+room.quiz.kind+' ]'));
 assert.doesNotMatch(first,/NEXUS QUIZ/);
 const active=await game.handleGame(room,{},msg,false);
 const again=active.indexOf(fold);
 assert.match(active.slice(0,again),/^\[ # \] QUIZ\n\nQ\. /);
 assert.ok(active.slice(again+fold.length).includes(
  '[ '+room.quiz.difficulty+' · '+room.quiz.kind+' ]'));
});
