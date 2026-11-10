'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {formatCatchResult,isCatchResult,editableText,sendCatchResult}=require('../game/fishing-edit');
const caught=formatCatchResult({
 ctx:{n:amount=>Number(amount).toLocaleString('ko-KR'),FISHING_COOLDOWN_SECONDS:20},
 player:{rod:'나무',rodLevels:{나무:2},equippedPet:'창조의 신',inventory:[{}],level:4},
 catchInfo:{f:{name:'붕어',tier:'일반'},size:21,value:100,xp:48,up:false},
 mention:'\u0002123\u0003테스터\u0004'
});
test('detects only successful fishing outcomes',()=>{
 assert.equal(isCatchResult(caught),true);
 assert.equal(isCatchResult('[ ! ] 아직 낚시 준비 중입니다. 10초 후 다시 시도하세요.'),false);
});
test('modification shows readable nickname instead of raw mention control codes',()=>{
 const result=editableText(caught);
 assert.ok(result.includes('👤 @테스터님'));
 assert.ok(!result.includes('\u0002'));
 assert.ok(result.includes('🐟 붕어 · ⚪ 일반 · 21cm'));
 assert.equal((result.match(/\u200b/g)||[]).length,1200);
});
test('fishing sends exactly one final result without start, wait or edit calls',async()=>{
 const messages=[];const status=await sendCatchResult({result:caught,chat:{sendText:()=>assert.fail('No start message'),editMessage:()=>assert.fail('No edits')},sendFallback:async text=>messages.push(text),wait:()=>assert.fail('No animation delay')});assert.equal(status,'normal');assert.deepEqual(messages,[caught]);
});
test('plain fishing delivery failure propagates without retrying gameplay or editing',async()=>{
 let writes=0;await assert.rejects(sendCatchResult({result:caught,chat:{editMessage:()=>assert.fail('No edits')},sendFallback:async()=>{writes++;throw Error('offline');}}),/offline/);assert.equal(writes,1);
});
test('cooldown notices bypass editable message path',async()=>{
 const calls=[];const notice='[ ! ] 아직 낚시 준비 중입니다. 7초 후 다시 시도하세요.';
 const status=await sendCatchResult({chat:{},roomId:'321',result:notice,
  sendFallback:async x=>calls.push(x),wait:async()=>{}});
 assert.equal(status,'normal');
 assert.deepEqual(calls,[notice]);
});

test('fishing result hides rewards after KakaoTalk folding marker',()=>{
 assert.ok(caught.startsWith('🎣 카카오톡 게임 매니저 | 낚시 결과\n'));
 assert.ok(caught.includes('💰 낚시 보상 · +100코인'));
 assert.ok(caught.includes('⭐ 획득 경험치 · +48 XP'));
 assert.ok(caught.includes('🎣 낚시대 · 나무 +2'));
 assert.ok(caught.includes('🐾 장착 펫 · 창조의 신'));
 assert.ok(caught.includes('판매 예상가 · 100코인'));
 assert.ok(caught.includes('보유 물고기 · 1마리'));
 const mark='\u200b'.repeat(1200);
 assert.equal((caught.match(/\u200b/g)||[]).length,1200);
 assert.ok(caught.indexOf('🐟 붕어')<caught.indexOf(mark));
 assert.ok(caught.indexOf(mark)<caught.indexOf('💰 낚시 보상'));
 assert.ok(caught.length<4010);
});
test('fishing result shows level-up and rarity when applicable',()=>{
 const text=formatCatchResult({
  ctx:{n:String,FISHING_COOLDOWN_SECONDS:20},
  player:{rod:'나무',rodLevels:{나무:1},equippedPet:'없음',inventory:[{}],level:5},
  catchInfo:{f:{name:'월광비늘어',tier:'영웅'},size:51.4,value:21595,xp:48,up:true},
  mention:'홍길동'
 });
 assert.ok(text.includes('🟣 영웅'));
 assert.ok(text.includes('⬆️ 레벨 UP · Lv.5'));
});

test('a hanging edit API cannot delay plain fishing delivery',async()=>{
 const messages=[];await sendCatchResult({result:caught,chat:{editMessage:()=>new Promise(()=>{})},sendFallback:async text=>messages.push(text)});assert.deepEqual(messages,[caught]);
});
