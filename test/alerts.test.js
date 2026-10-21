'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  alertsEnabled, allowedToConfigure, formatMentionNotice,
  handleAlertCommand, processMentionAlerts
} = require('../manage/alerts');

test('alert switches require active management and an unlocked room', () => {
  assert.equal(alertsEnabled({manage:true,locked:false}, 'mentionAlertsEnabled'),true);
  assert.equal(alertsEnabled({manage:true,mentionAlertsEnabled:false},'mentionAlertsEnabled'),false);
  assert.equal(alertsEnabled({manage:false},'mentionAlertsEnabled'),false);
  assert.equal(alertsEnabled({manage:true,locked:true},'profileAlertsEnabled'),false);
});

test('notification formatting uses Seoul time and excludes message bodies', () => {
  const notice = formatMentionNotice('12345','바닐라 구미❤️',[
    {sender_id:'22222',sender_name:'STAR/z',created_at:'2026-10-21T10:12:00.000Z'}
  ]);
  assert.match(notice,/NEXUS \| MENTION/);
  assert.match(notice,/부재중 멘션이 1건/);
  assert.match(notice,/10\.21/);
  assert.match(notice,/7:12/);
  assert.match(notice,/STAR\/z/);
  assert.match(notice,/\u200b{1000}/);
  assert.doesNotMatch(notice,/멘션 내용|원문/);
});

test('only owners, managers, and configured bot administrators can toggle', () => {
  assert.equal(allowedToConfigure({senderType:1}),true);
  assert.equal(allowedToConfigure({senderType:4}),true);
  assert.equal(allowedToConfigure({senderType:2}),false);
});

test('command settings are persisted per room without replacing other flags', async () => {
  const sql=[], replies=[];
  const db={query:async (q,params)=>{
    sql.push({q,params});
    if(q.startsWith('SELECT'))return {rows:[{data:{manage:true,mentionAlertsEnabled:false}}]};
    return {rows:[],rowCount:1};
  }};
  const base={roomId:'room',senderType:1,userId:'77',send:async msg=>replies.push(msg)};
  assert.equal(await handleAlertCommand({...base,text:'#멘션감지켜기'},db),true);
  assert.deepEqual(sql[0].params,['room','mentionAlertsEnabled',true]);
  assert.match(sql[0].q,/jsonb_set\(hz_rooms\.data/);
  assert.equal(await handleAlertCommand({...base,text:'#감지상태'},db),true);
  assert.match(replies.at(-1),/멘션 감지: OFF/);
  const count=sql.length;
  assert.equal(await handleAlertCommand({...base,text:'#아무말'},db),false);
  assert.equal(sql.length,count);
});

test('mention alerts record real mention metadata without storing source text', async () => {
  const statements=[], replies=[];
  const db={query:async(q,params)=>{
    statements.push({q,params});
    if(q.startsWith('SELECT data'))return {rows:[{data:{manage:true}}]};
    if(q.includes('WITH picked'))return {rows:[]};
    return {rows:[],rowCount:1};
  }};
  await processMentionAlerts({
    roomId:'room',userId:'20001',botId:'9999',userName:'철수',isBotAccount:false,
    msg:{room:{id:'room'},message:{text:'무시할 내용',logId:'1234'},mentions:[
      {userId:'30001',name:'영희'}, {userId:'30001',name:'영희'}
    ]},
    send:async text=>replies.push(text)
  },db);
  const inserted=statements.filter(x=>x.q.includes('INSERT INTO hz_mention_alerts'));
  assert.equal(inserted.length,1);
  assert.deepEqual(inserted[0].params,['room','30001','20001','철수','1234']);
  assert.equal(replies.length,0);
});
