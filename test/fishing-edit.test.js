'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {isCatchResult,editableText,sendEditedCatch}=require('../game/fishing-edit');
const caught='🎣 \u0002123\u0003테스터\u0004님의 낚시 결과\n🐟 붕어 [일반] · 21cm\n'+
 '\u200b'.repeat(1200)+'\n💰 낚시 보상 · +100코인\n🎒 보유 물고기 · 1마리\n⏱ 다음 낚시 · 20초 후';
test('detects only successful fishing outcomes',()=>{
 assert.equal(isCatchResult(caught),true);
 assert.equal(isCatchResult('[ ! ] 아직 낚시 준비 중입니다. 10초 후 다시 시도하세요.'),false);
});
test('modification shows readable nickname instead of raw mention control codes',()=>{
 const result=editableText(caught);
 assert.ok(result.includes('@테스터님의 낚시 결과'));
 assert.ok(!result.includes('\u0002'));
 assert.ok(result.includes('붕어 [일반]'));
 assert.equal(result.includes('\u200b'.repeat(1200)),true);
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
 assert.deepEqual(waits,[1100,1500]);
 assert.equal(calls[1].logId,'9876');
 assert.ok(calls[2].body.includes('붕어 [일반]'));
 assert.ok(calls[2].body.endsWith('20초 후'));
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
