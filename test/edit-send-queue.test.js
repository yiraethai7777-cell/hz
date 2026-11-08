'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {KakaoForgeClient}=require('../dist/client/client');
function fake(queue=Promise.resolve()){
 const calls=[];const client=Object.create(KakaoForgeClient.prototype);
 Object.assign(client,{_carriage:{modifyMsg:async(...args)=>{calls.push(args);return {status:0};}},_resolveChatId:id=>id,_sendQueue:queue,_lastSendAt:0,sendIntervalMs:0});return {client,calls};
}
test('actual edit API waits in the same send queue as ordinary messages',async()=>{
 let release;const {client,calls}=fake(new Promise(r=>release=r));const editing=client.editMessage('1000','90071992547409931234','result');
 await new Promise(r=>setImmediate(r));assert.equal(calls.length,0);release();await editing;assert.equal(calls.length,1);assert.equal(calls[0][1],'90071992547409931234');
});
test('expired queued progress is never sent later and does not consume a send slot',async()=>{
 let release;const {client,calls}=fake(new Promise(r=>release=r));const edit=client.editMessage('1000','1234','old progress',{deadlineAt:Date.now()-1});const rejected=assert.rejects(edit,/deadline expired/);
 release();await rejected;assert.deepEqual(calls,[]);assert.equal(client._lastSendAt,0);
});
test('rate-rejected progress retries only the final result on the same message',async()=>{
 const texts=[],fallback=[],waits=[];const status=await require('../game/message-progress').run({roomId:'1000',sendStart:async()=>({status:0,body:{logId:'1234'}}),edit:async(room,log,text)=>{texts.push(text);return texts.length===1?{body:{status:-303}}:{status:0};},sendFallback:async t=>fallback.push(t),stages:['start','progress','final'],result:'final',delays:[0,0],wait:async ms=>waits.push(ms),timeoutMs:100});
 assert.equal(status,'edited');assert.deepEqual(texts,['progress','final']);assert.deepEqual(fallback,[]);assert.deepEqual(waits,[0,1600]);
});
test('a rate-rejected fallback WRITE is retried with the already saved result',async()=>{
 let calls=0;const texts=[];const status=await require('../game/message-progress').run({roomId:'1000',edit:null,sendFallback:async t=>{texts.push(t);return ++calls===1?{body:{status:-303}}:{status:0};},result:'saved result',stages:[],delays:[],wait:async()=>{},timeoutMs:100});assert.equal(status,'fallback');assert.deepEqual(texts,['saved result','saved result']);
});
