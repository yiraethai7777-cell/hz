'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {attachRouter} = require('../shared/router');
const {createGame} = require('../game');
const {getPool} = require('../shared/db');
const manage = require('../manage');

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
    ctx.text='!게임순위';await game.message(ctx);assert.equal(legacyCalls,2);
  } finally {pool.query=query;legacy.attachModules=attach;market.message=marketMessage;process.env.DATABASE_URL=oldEnv||'';}
});
