'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCore}=require('../core'),{createBotPower}=require('../manage/bot-power');
test('power is room scoped, bot only, persisted, defaults on, ordinary users silent while off',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'duke-power-')),out=[],changes=[],dirty=[],send=async(r,t)=>out.push(t);
 try{
  const opts={dir,botId:()=> '9000',onChange:(...a)=>changes.push(a),onPersist:k=>dirty.push(k)};
  let p=createBotPower(opts),core=createCore({send,canHandle:p.canHandle});p.register(core);
  const cmd=(text,userId='9000',roomId='1000',isOpenChat=true)=>core.handle({text,userId,roomId,msg:{room:{id:roomId,isOpenChat},sender:{name:'회원'}}});
  assert.equal(p.enabled('1000'),true);
  await cmd('-봇끄기','3000');assert.match(out.at(-1),/봇 계정만/);assert.equal(p.enabled('1000'),true);
  await cmd('-봇끄기','9000','1000',false);assert.equal(p.enabled('1000'),true);
  await cmd('-봇끄기');assert.equal(p.enabled('1000'),false);assert.match(out.at(-1),/껐습니다/);
  const n=out.length;assert.equal(await cmd('-핑','3000'),false);assert.equal(await cmd('-봇켜기','3000'),false);assert.equal(out.length,n);
  await cmd('-핑');assert.match(out.at(-1),/ONLINE/);
  await cmd('-핑','3000','2000');assert.match(out.at(-1),/ONLINE/);
  p=createBotPower(opts);core=createCore({send,canHandle:p.canHandle});p.register(core);assert.equal(p.enabled('1000'),false);
  await cmd('-봇켜기');assert.equal(p.enabled('1000'),true);assert.match(out.at(-1),/켰습니다/);
  assert.deepEqual(changes,[['1000',false],['1000',true]]);assert.deepEqual(dirty,['bot-power.json','bot-power.json']);
  assert.equal(createBotPower(opts).enabled('1000'),true);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
