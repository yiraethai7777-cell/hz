'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {attachRouter} = require('../shared/router');
const {createGame} = require('../game');
const {getPool} = require('../shared/db');
const manage = require('../manage');

test('retired ban registration commands and stored registrations cannot kick on join',async()=>{
  const oldEnv=process.env.DATABASE_URL;process.env.DATABASE_URL='postgres://localhost/test';
  const pool=getPool(),query=pool.query;const statements=[],replies=[];let kicks=0;
  pool.query=async(sql)=>{
    statements.push(sql);
    if(sql.includes('AS enabled'))return {rows:[{enabled:true}]};
    if(sql.includes('SELECT joins,leaves'))return {rows:[{joins:2,leaves:1}]};
    if(sql.includes('count(*)'))return {rows:[{n:0}]};
    return {rows:[{user_id:'9007199254740993123'}],rowCount:1};
  };
  const ctx={roomId:'room',userId:'5678',userName:'test',senderType:1,
    send:async s=>replies.push(s),kick:async()=>{kicks++;}};
  try{
    for(const text of ['!벤등록 9007199254740993123','!벤등록해제 9007199254740993123','!벤등록목록']){
      assert.equal(await manage.message({...ctx,text}),false);
    }
    await manage.join(ctx);
    assert.equal(kicks,0);
    assert.ok(statements.every(sql=>!sql.includes('gl_manage_bans')));
    await manage.message({...ctx,text:'!관리명령어'});
    assert.doesNotMatch(replies.at(-1),/벤등록/);
    assert.match(replies.at(-1),/!벤 ID/);
  }finally{pool.query=query;if(oldEnv===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldEnv;}
});

test('room owners and managers may kick; ordinary and unknown members remain denied', async () => {
  const oldEnv=process.env.DATABASE_URL,oldOwner=process.env.GL_OWNER_ID;
  process.env.DATABASE_URL='postgres://localhost/test';delete process.env.GL_OWNER_ID;
  const pool=getPool(),query=pool.query;
  let registered=false,kicks=0;const replies=[];
  pool.query=async sql=>sql.includes('AS enabled')?{rows:[{enabled:true}]}:
    sql.includes('FROM gl_manage_admins')?{rows:registered?[{}]:[],rowCount:registered?1:0}:{rows:[],rowCount:1};
  const ctx={roomId:'room',userId:'1234',text:'!벤 9007199254740993123',
    send:async s=>replies.push(s),kick:async()=>{kicks++;}};
  try {
    for(const type of [1,4]){await manage.message({...ctx,senderType:type});assert.match(replies.at(-1),/강퇴 요청 완료/);}
    assert.equal(kicks,2);
    for(const type of [2,undefined,0]){await manage.message({...ctx,senderType:type});assert.match(replies.at(-1),/관리 권한이 없습니다/);}
    assert.equal(kicks,2);
    registered=true;await manage.message({...ctx,senderType:2});assert.equal(kicks,3);
    await manage.message({...ctx,senderType:1,text:'!관리중지'});
    assert.match(replies.at(-1),/GL봇 계정만/);
  } finally {pool.query=query;if(oldEnv===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldEnv;
    if(oldOwner===undefined)delete process.env.GL_OWNER_ID;else process.env.GL_OWNER_ID=oldOwner;}
});

test('router forwards protocol member role and exact departed ID to kick API',async()=>{
  let callback;const requests=[];
  const client={userId:'1234',chat:{sendText:async()=>{}},onMessage(fn){callback=fn;},
    openChatKick:async(...args)=>{requests.push(args);return {status:0};}};
  let context;
  attachRouter(client,{game:{},management:{message:async ctx=>{context=ctx;return true;}}});
  await callback({room:{id:'room'},sender:{id:'5678',type:1},text:'!벤 9007199254740993123'});
  assert.equal(context.senderType,1);
  await context.kick('9007199254740993123');
  assert.deepEqual(requests,[['room','9007199254740993123']]);
  await assert.rejects(context.kick('1234'),/내보낼 수 없습니다/);
  await assert.rejects(context.kick('5678'),/내보낼 수 없습니다/);
  client.openChatKick=async()=>({status:-1});
  await assert.rejects(context.kick('9007199254740993123'),/요청 실패/);
});

test('single registration, both KakaoForge signatures, help and attendance isolation', async () => {
  let callback, registrations=0;
  const replies=[],games=[],management=[];
  const client={userId:'1234',chat:{sendText:async (room,body)=>replies.push(body)},
    onMessage(fn){registrations++;callback=fn;}};
  const game={toggle:async ctx=>games.push(ctx),message:async ctx=>games.push(ctx)};
  attachRouter(client,{game,management:{message:async ctx=>{management.push(ctx);return false;}}});
  const msg=text=>({room:{id:'room'},sender:{id:'1234'},text});
  const oldEnv=process.env.DATABASE_URL;
  process.env.DATABASE_URL='postgres://localhost/test';
  const pool=getPool(),query=pool.query;
  pool.query=async()=>({rows:[{game:true,manage:true}]});
  try {await callback(msg('!명령어'));}
  finally {pool.query=query;process.env.DATABASE_URL=oldEnv||'';}
  assert.equal(replies.length,1);
  assert.match(replies[0],/\u200b{1200}/);
  assert.equal(games.length,0);
  await callback(client.chat,msg('!주식구매 삼성전자 1'));
  assert.equal(games.at(-1).text,'!주식구매 삼성전자 1');
  await callback(msg('!출석'));
  assert.equal(games.length,1);
  await callback(msg('!게임작동'));
  assert.equal(games.at(-1).isBotAccount,true);
  await callback({...msg('!게임중지'),sender:{id:'9999'}});
  assert.equal(games.at(-1).isBotAccount,false);
  assert.equal(registrations,1);
});

test('game toggles independently of management; only bot may toggle', async () => {
  const oldEnv=process.env.DATABASE_URL;
  process.env.DATABASE_URL='postgres://localhost/test';
  const pool=getPool(),query=pool.query,enabled=manage.enabled;
  const state={game:false,manage:false,players:{alice:{points:777}},quizEnabled:true};
  const statements=[];const replies=[];
  pool.query=async (sql,params)=>{statements.push(sql);state.game=params[1];return {rows:[]};};
  manage.enabled=async ()=>{throw new Error('Game toggle must not query management');};
  const game=createGame({});
  const ctx={roomId:'room',text:'!게임작동',isBotAccount:false,send:async s=>replies.push(s)};
  try {
    await game.toggle(ctx);assert.equal(statements.length,0);
    ctx.isBotAccount=true;
    await game.toggle(ctx);assert.equal(statements.length,1);assert.equal(state.game,true);
    state.manage=true;await game.toggle(ctx);assert.equal(state.game,true);
    state.manage=false;assert.equal(state.game,true);
    ctx.text='!게임중지';await game.toggle(ctx);assert.equal(state.game,false);
    assert.deepEqual(state.players,{alice:{points:777}});
    assert.ok(statements.every(sql=>sql.includes("jsonb_set(hz_rooms.data,'{game}'")));
  } finally {pool.query=query;manage.enabled=enabled;process.env.DATABASE_URL=oldEnv||'';}
});

test('management toggles are bot-only and update only management state in a transaction', async () => {
  const oldEnv=process.env.DATABASE_URL;
  process.env.DATABASE_URL='postgres://localhost/test';
  const pool=getPool(),connect=pool.connect;
  const calls=[];
  pool.connect=async ()=>({query:async (sql,params)=>{calls.push({sql,params});return {rows:[]};},release(){calls.push({sql:'release'});}});
  const ctx={roomId:'room',userId:'1234',userName:'bot',text:'!관리중지',isBotAccount:false,send:async ()=>{}};
  try {
    await manage.message(ctx);assert.equal(calls.length,0);
    ctx.isBotAccount=true;await manage.message(ctx);
    assert.equal(calls[0].sql,'BEGIN');
    assert.equal(calls.at(-2).sql,'COMMIT');
    const update=calls.find(c=>c.sql.includes('INSERT INTO hz_rooms'));
    assert.ok(update.sql.includes("jsonb_set(hz_rooms.data,'{manage}'"));
    assert.ok(!update.sql.includes("'{game}'"));
    assert.deepEqual(update.params,['room',false]);
  } finally {pool.connect=connect;process.env.DATABASE_URL=oldEnv||'';}
});

test('legacy games are captured without overwriting the real listener; stopped market is blocked', async () => {
  const oldEnv=process.env.DATABASE_URL;
  process.env.DATABASE_URL='postgres://localhost/test';
  const pool=getPool(),query=pool.query;
  const legacy=require('../shared/runtime'),attach=legacy.attachModules;
  const market=require('../game/commands'),marketMessage=market.message;
  let registrations=0,legacyCalls=0,marketCalls=0,gameOn=false;
  const client={userId:'1234',onMessage(){registrations++;},onJoin(){}};
  pool.query=async sql=>({rows:sql.includes('SELECT data')?[{data:{game:gameOn}}]:[{}]});
  legacy.attachModules=async adapter=>{adapter.onMessage(async ()=>{legacyCalls++;});adapter.onJoin(()=>{});};
  market.message=async ()=>{marketCalls++;};
  try {
    const game=createGame(client);await game.init();
    assert.equal(registrations,0);
    const ctx={roomId:'room',text:'!코인',msg:{},chat:{},send:async ()=>{}};
    await game.message(ctx);assert.equal(marketCalls,0);
    gameOn=true;await game.message(ctx);assert.equal(marketCalls,1);
    ctx.text='!낚시';await game.message(ctx);assert.equal(legacyCalls,1);
    ctx.text='!펫도감';await game.message(ctx);assert.equal(legacyCalls,2);
  } finally {pool.query=query;legacy.attachModules=attach;market.message=marketMessage;process.env.DATABASE_URL=oldEnv||'';}
});
