'use strict';
// Public game command names. The legacy feature modules still parse # internally,
// but users send ! commands. Do not normalize management or unrelated commands.
const COMMANDS=new Set(`
게임가입 정보 코인순위 코인내역 코인아이디 코인송금 코인지급
낚시 낚시정보 어망 인벤 물고기도감 물고기판매 상점 낚시대구매 낚시장착
강화 보호권구매 보호권 구매행운 구매자동
펫뽑기 펫인벤 펫도감 펫기능 펫장착 펫강화
농장 농장정보 농장확장 씨앗구매 심기 수확 전체수확
퀴즈 정답 퀴즈정보 퀴즈순위
게임작동 게임중지 퀴즈작동 퀴즈중지 낚시작동 낚시중지 게임상태 게임정보
치트 회수 초기화 초기화확인 랭킹공개 랭킹비공개
핑`.trim().split(/\s+/));
const RETIRED=new Set([...COMMANDS,'게임순위']);
function commandName(text,prefix){
 const match=new RegExp('^\\'+prefix+'(\\S+)(?=\\s|$)').exec(String(text||'').trim());
 return match?.[1]||null;
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
 const raw=String(text||'').trim();
 return isGameCommand(raw)?'#'+raw.slice(1):raw;
}
function toLegacyMessage(msg,original,translated){
 if(translated===original||!msg)return msg;
 // Inherit the KakaoForge message object instead of discarding its methods
 // or mutating its message attachment/mention metadata.
 return Object.assign(Object.create(msg),{
  text:translated,
  message:Object.assign(Object.create(msg.message||null),{text:translated})
 });
}
module.exports={COMMANDS,isGameCommand,isRetiredLegacyCommand,toLegacy,toLegacyMessage};
