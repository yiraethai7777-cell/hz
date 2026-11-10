'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const source=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const {isRetiredValorantCommand}=require('../shared/router');
const gameAliases=require('../game/command-aliases');
const retired=[
 '!발로on','!발로off','!발로명령어','!발로전적 홍길동#KR1','!발로저장 Demo#KR1',
 '!발로전적확인','!발로삭제 1','!발로승인','!발로승인해제',
 '!스킨 밴달','!스킨비교','!스킨가격 밴달','!스킨색상',
 '!전적 Demo#KR1','!티어 Demo#KR1','!최근전적','!승률','!헤드샷','!챔스노래 2025',
 '!요원 제트','!랜덤요원','!맵 어센트','!랜덤맵','!무기 밴달','!조준점',
 '!발로티어변동','!발로요원통계','!발로비교','!발로랭킹',
 '!내전예약','!내전등록','!내전참가','!내전참여','!내전팀짜기','!내전재편성',
 '!내전결과','!내전초기화','!티어등록',
 '!듀오모집','!듀오목록','!듀오신청','!듀오취소',
 '!파티모집','!파티참가','!파티퇴장','!파티목록','!파티종료','!파티정보'
];

test('retired Valorant commands are silently rejected for all users and rooms',()=>{
 for(const command of retired){
  assert.equal(isRetiredValorantCommand(command),true,command);
  assert.equal(gameAliases.isGameCommand(command),false,command);
 }
 for(const unrelated of ['!낚시','!채굴','!퀴즈','!관리명령어','!게임명령어','!명령어','!help','!출석','!보룸시작','y','네','1']){
  assert.equal(isRetiredValorantCommand(unrelated),false,unrelated);
 }
});

test('all Valorant runtime handlers and scheduler are unregistered',()=>{
 const router=source('shared/router.js'),entry=source('hz-new.js');
 assert.doesNotMatch(router,/require\(['"]\.\/valorant-/);
 assert.doesNotMatch(entry,/require\(['"]\.\/shared\/valorant-scrim-scheduler/);
 assert.match(router,/if\(isRetiredValorantCommand\(text\)\)return;/);
 assert.doesNotMatch(router,/jsonb_build_object\([^\n]*'valorant'/);
 assert.doesNotMatch(router,/발로란트 활성화/);
 assert.match(entry,/require\(['"]\.\/shared\/manager-output['"]\)\.install\(client\)/);
});

test('manager menus never mention Valorant commands, game commands still work',()=>{
 const help=source('shared/help.js');
 assert.doesNotMatch(help,/!발로|!스킨|!내전|!듀오모집|!파티모집|!발로전적/);
 for(const command of ['!낚시','!채굴','!퀴즈','!어망','!출석'])assert.match(help,new RegExp(command));
 for(const command of ['!낚시','!채굴','!퀴즈'])assert.equal(gameAliases.isGameCommand(command),true);
});
