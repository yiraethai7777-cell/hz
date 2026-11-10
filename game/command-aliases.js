'use strict';
const {normalize}=require('./command-text');
// Public game command names. The legacy feature modules still parse # internally,
// but users send ! commands. Do not normalize management or unrelated commands.
const COMMANDS=new Set(`
게임가입 정보 코인순위 코인내역 코인아이디 코인송금 코인지급 코인초기화 게임초기화
낚시 낚시정보 어망 인벤 물고기도감 물고기판매 물고기전송 상점 낚시대ㄱㅁ 낚시장착
강화 보호권ㄱㅁ 보호권 ㄱㅁ행운 ㄱㅁ자동
펫뽑기 펫인벤 펫도감 펫기능 펫장착 펫강화
농장 농장정보 농장확장 씨앗ㄱㅁ 심기 수확 전체수확
광산 채굴 광물인벤 광물판매 곡괭이 곡괭이강화 곡괭이구매 곡괭이장착 채굴지
퀴즈 정답 퀴즈정보 퀴즈순위

게임on 게임off 퀴즈작동 퀴즈중지 낚시작동 낚시중지 게임상태 게임정보
치트 회수 초기화 초기화확인 랭킹공개 랭킹비공개
핑`.trim().split(/\s+/));
// Block old # commands, including removed game toggles, before the legacy handlers.
const RETIRED=new Set([...COMMANDS,...[...COMMANDS].filter(x=>x.includes('ㄱㅁ')).map(x=>x.replace(/ㄱㅁ/g,'구매')),'게임순위','게임작동','게임중지',...["발로on","발로off","발로명령어","발로전적","발로저장","발로전적확인","발로삭제","발로승인","발로승인해제","스킨","스킨비교","스킨색상","스킨가격","전적","티어","최근전적","승률","헤드샷","챔스노래","요원","랜덤요원","맵","랜덤맵","무기","조준점","발로티어변동","발로요원통계","발로비교","발로랭킹","발로랭킹등록","발로랭킹탈퇴","티어등록","내전예약","내전등록","내전참여","내전참가","내전탈퇴","내전참가자","내전팀짜기","내전재편성","내전선수교체","내전밸런스","내전결과","내전순위","내전초기화","듀오모집","듀오목록","듀오신청","듀오취소","파티모집","파티참가","파티퇴장","파티목록","파티종료","파티정보"]]);
function commandName(text,prefix){
 const raw=normalize(text);
 if(raw.charAt(0)!==prefix)return null;
 const token=raw.split(/\s+/,1)[0].slice(1);
 return token||null;
}
function isGameCommand(text){
 const name=commandName(text,'!');
 return !!name&&COMMANDS.has(name);
}
function isRetiredLegacyCommand(text){
 const name=commandName(text,'#');
 return !!name&&RETIRED.has(name);
}
function toLegacy(text){
 const raw=normalize(text);
 return isGameCommand(raw)?'#'+raw.slice(1).replace(/ㄱㅁ/g,'구매'):raw;
}
function toLegacyMessage(msg,original,translated){
 if(translated===original||!msg||typeof msg!=='object')return msg;
 // Preserve KakaoForge methods and its original message object. Shadow
 // text properties safely even when the source uses readonly accessors.
 const mapped=Object.create(msg);
 const attachment=msg.message&&typeof msg.message==='object'?Object.create(msg.message):{};
 Object.defineProperty(attachment,'text',{value:translated,enumerable:true,configurable:true});
 Object.defineProperty(mapped,'text',{value:translated,enumerable:true,configurable:true});
 Object.defineProperty(mapped,'message',{value:attachment,enumerable:true,configurable:true});
 Object.defineProperty(mapped,'__gameCommandFastPath',{value:true,configurable:true});
 return mapped;
}
module.exports={COMMANDS,isGameCommand,isRetiredLegacyCommand,toLegacy,toLegacyMessage};
