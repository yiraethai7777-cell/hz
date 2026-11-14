'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {summarize}=require('../scripts/vox30-hangup-evidence');
test('candidate 10004 cannot be mistaken for a verified hangup',()=>{
 const data=[{source:'VOX_HANGUP_METADATA_PROBE',event:'hangup_called'},
  {source:'VOX_HANGUP_METADATA_PROBE',event:'outgoing_vox_method',method:10004}];
 const result=summarize(data.map(JSON.stringify).join('\n'));
 assert.equal(result.hangupCalls,1);
 assert.equal(result.candidate10004,true);
 assert.equal(result.verifiedServerHangup,false);
});
test('untrusted payload fields are never passed through',()=>{
 const result=summarize(JSON.stringify({source:'VOX_HANGUP_METADATA_PROBE',
  event:'outgoing_vox_method',method:11009,secret:'SECRET'}));
 assert.deepEqual(result.observedMethods,[11009]);
 assert.equal(JSON.stringify(result).includes('SECRET'),false);
});
