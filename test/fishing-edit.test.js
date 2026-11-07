'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {formatCatchResult,isCatchResult,editableText,sendEditedCatch}=require('../game/fishing-edit');
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
 assert.equal(result.includes('\u200b'),false);
});
test('one fishing message is updated through two MODIFYMSG calls',async()=>{
 const calls=[],waits=[],fallback=[];
 const chat={
  async sendText(roomId,body){calls.push({kind:'WRITE',roomId,body});return {status:0,body:{logId:'9876'}};},
  async editMessage(roomId,logId,body){calls.push({kind:'MODIFYMSG',roomId,logId,body});return {status:0};}
 };
 const status=await sendEditedCatch({chat,roomId:'321',result:caught,name:'테스터',
  sendFallback:async text=>fallback.push(text),wait:async ms=>{waits.push(ms);}});
 assert.equal(status,'edited');
 assert.deepEqual(calls.map(x=>x.kind),['WRITE','MODIFYMSG','MODIFYMSG']);
 assert.equal(calls[0].body,'🎣 NEXI | 낚시\n\n🌊 테스터님이 낚시를 시작했습니다.');
 assert.equal(calls[1].body,'🎣 NEXI | 낚시\n\n🐟 물고기를 끌어올리고 있습니다…');
 assert.deepEqual(waits,[1100,1500]);
 assert.equal(calls[1].logId,'9876');
 assert.ok(calls[2].body.includes('붕어 · ⚪ 일반'));
 assert.ok(calls[2].body.includes('다음 낚시 · 20초 후'));
 assert.ok(calls[2].body.endsWith('━━━━━━━━━━━━━━━━━━'));
 assert.deepEqual(fallback,[]);
});
test('failed edit falls back to existing fishing result without re-awarding',async()=>{
 const calls=[],fallback=[];
 const chat={
  async sendText(){calls.push('WRITE');return {status:0,body:{logId:'99'}};},
  async editMessage(){calls.push('MODIFYMSG');return {status:-1};}
 };
 const status=await sendEditedCatch({chat,roomId:'321',result:caught,name:'테스터',
  sendFallback:async text=>fallback.push(text),wait:async()=>{}});
 assert.equal(status,'fallback');
 assert.deepEqual(calls,['WRITE','MODIFYMSG']);
 assert.deepEqual(fallback,[caught]);
});
test('cooldown notices bypass editable message path',async()=>{
 const calls=[];const notice='[ ! ] 아직 낚시 준비 중입니다. 7초 후 다시 시도하세요.';
 const status=await sendEditedCatch({chat:{},roomId:'321',result:notice,
  sendFallback:async x=>calls.push(x),wait:async()=>{}});
 assert.equal(status,'normal');
 assert.deepEqual(calls,[notice]);
});

test('compact fishing result preserves all information without fold padding',()=>{
 assert.ok(caught.startsWith('🎣 NEXI | 낚시 결과\n'));
 assert.ok(caught.includes('💰 +100코인 · ⭐ +48 XP'));
 assert.ok(caught.includes('🎣 나무 +2 · 🐾 창조의 신'));
 assert.ok(caught.includes('판매 예상가 · 100코인'));
 assert.ok(caught.includes('보유 물고기 · 1마리'));
 assert.equal(caught.includes('\u200b'),false);
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
