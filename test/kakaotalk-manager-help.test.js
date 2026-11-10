'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const help=require('../shared/help');

const flags=(game,manage)=>({game,manage});
const GAME='카카오톡 게임 매니저';
const MANAGEMENT='카카오톡 관리 매니저';

test('관리만 ON: !명령어, !관리명령어, !help 모두 관리 메뉴 한 개',()=>{
 for(const command of ['!명령어','!관리명령어','!help']){
  const messages=help.commandMenuMessages(flags(false,true),command==='!관리명령어'?'관리':'');
  assert.equal(messages.length,1,command);
  assert.ok(messages[0].includes(MANAGEMENT));
  assert.ok(!messages[0].includes('🧩 퀴즈'));
 }
});

test('게임만 ON: !명령어, !게임명령어, !help 모두 게임 메뉴 한 개',()=>{
 for(const command of ['!명령어','!게임명령어','!help']){
  const messages=help.commandMenuMessages(flags(true,false),command==='!게임명령어'?'게임':'');
  assert.equal(messages.length,1,command);
  assert.ok(messages[0].includes(GAME));
  assert.ok(!messages[0].includes('👮 제재 명령어'));
 }
});

test('종합 모드: !명령어 / !help 는 두 개의 독립 메시지를 순서대로 보냄',async()=>{
 for(const text of ['!명령어','!help']){
  const delivered=[];
  const db={query:async(sql,args)=>{
   assert.match(sql,/gl_manage_rooms/);
   assert.match(sql,/hz_rooms/);
   assert.deepEqual(args,['1234567890']);
   return {rows:[{game:true,manage:true}]};
  }};
  const done=await help.sendRoomCommandHelp({
   text,roomId:'1234567890',db,prefix:'!',send:async body=>delivered.push(body)
  });
  assert.equal(done,true);
  assert.equal(delivered.length,2,'종합은 반드시 게임과 관리를 따로 보냄');
  assert.ok(delivered[0].includes(GAME),'첫 메시지는 게임 목록');
  assert.ok(delivered[0].includes('!퀴즈'));
  assert.ok(delivered[1].includes(MANAGEMENT),'두 번째 메시지는 관리 목록');
  assert.ok(delivered[1].includes('!경고'));
  assert.ok(delivered.every(s=>s.includes('\u200b'.repeat(1200))),'각 목록은 기존 전체보기 여백 유지');
  assert.ok(delivered.every(s=>!s.includes('!일괄강퇴')),'숨김 명령은 노출하지 않음');
 }
});

test('모드별 명시적 메뉴는 해당 메뉴만 보내며 OFF 안내도 정확함',()=>{
 const both=flags(true,true);
 assert.equal(help.commandMenuMessages(both,'게임').length,1);
 assert.ok(help.commandMenuMessages(both,'게임')[0].includes(GAME));
 assert.equal(help.commandMenuMessages(both,'관리').length,1);
 assert.ok(help.commandMenuMessages(both,'관리')[0].includes(MANAGEMENT));
 const off=help.commandMenuMessages(flags(false,false));
 assert.equal(off.length,1);
 assert.match(off[0],/게임과 관리 기능이 모두 꺼져/);
 assert.match(help.commandMenuMessages(flags(false,true),'게임')[0],/게임 기능은 중지/);
 assert.match(help.commandMenuMessages(flags(true,false),'관리')[0],/관리 기능은 중지/);
});

test('다중 접두사에서도 3가지 명령어 목록 표기가 설정 접두사와 일치',()=>{
 const both=help.commandMenuMessages(flags(true,true),'','.');
 assert.equal(both.length,2);
 assert.match(both[0],/\.퀴즈/);
 assert.match(both[1],/\.경고/);
 assert.doesNotMatch(both[0],/!퀴즈/);
 assert.doesNotMatch(both[1],/!경고/);
});

test('지원하지 않는 텍스트는 DB 조회·전송 없이 통과',async()=>{
 const result=await help.sendRoomCommandHelp({
  text:'!퀴즈',roomId:'1234567890',db:{query(){throw Error('must not query');}},
  prefix:'!',send(){throw Error('must not send');}
 });
 assert.equal(result,false);
});
