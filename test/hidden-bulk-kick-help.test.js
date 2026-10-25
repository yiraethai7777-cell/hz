'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {formatCommandHelp,commandLists,hidePrivateHelpCommands}=require('../shared/help');

test('the bulk kick command is absent from every published help menu',()=>{
 for(const body of [
  formatCommandHelp({manage:true,game:true},'관리'),
  formatCommandHelp({manage:true,game:true},'게임'),
  formatCommandHelp({manage:true,game:true}),
  ...Object.values(commandLists)
 ]) assert.ok(!body.includes('!일괄강퇴'), 'private command leaked into help menu');
});

test('private commands and their descriptions stay hidden even when added to source lists',()=>{
 const sample='!관리on\n└─ 허용\n\n!일괄강퇴\n└─ 내부 전용\n\n!관리off\n└─ 허용';
 const rendered=hidePrivateHelpCommands(sample);
 assert.ok(!rendered.includes('!일괄강퇴'));
 assert.ok(!rendered.includes('내부 전용'));
 assert.ok(rendered.includes('!관리on'));
 assert.ok(rendered.includes('!관리off'));
});
