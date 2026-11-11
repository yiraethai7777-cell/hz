'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const ad=require('../promotion/manager-ad');

test('Manager advertisement shows an engaging teaser before native full-view spacer',()=>{
 assert.match(ad.teaser,/전체보기/);
 assert.match(ad.teaser,/경고·강퇴/);
 assert.ok(ad.message.startsWith(ad.teaser+'\n'));
 assert.ok(ad.message.includes('\u200b'.repeat(1200)));
 assert.ok(ad.message.indexOf('🤖 카카오톡 매니저')>ad.message.indexOf('\u200b'.repeat(1200)));
 assert.match(ad.details,/관리형/);
 assert.match(ad.details,/게임형/);
 assert.match(ad.details,/종합형/);
 assert.match(ad.details,/open.kakao.com/);
 assert.ok(ad.message.length>1200&&ad.message.length<=4000);
});

test('first installation registers the promotional message without altering room ON/OFF flags',async()=>{
 const calls=[];
 const db={query:async(sql,args)=>{calls.push({sql,args});return {rowCount:1};}};
 assert.equal(await ad.install(db),true);
 assert.equal(calls.length,2);
 assert.match(calls[0].sql,/gl_manager_promotion_seed/);
 assert.match(calls[1].sql,/ON CONFLICT\(id\) DO UPDATE/);
 assert.equal(calls[1].args[0],ad.message);
 assert.doesNotMatch(calls[1].sql,/UPDATE hz_rooms/);
});

test('subsequent installations preserve the current master promotion message',async()=>{
 const calls=[];
 const db={query:async(sql,args)=>{calls.push({sql,args});return {rowCount:0};}};
 assert.equal(await ad.install(db),false);
 assert.match(calls[1].sql,/ON CONFLICT\(version\) DO NOTHING/);
});
