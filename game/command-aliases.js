'use strict';
// Public game command names. The legacy feature modules still parse # internally,
// but users send ! commands. Do not normalize management or unrelated commands.
const COMMANDS=new Set(`
게임가입 정보 타자게임 코인순위 코인내역 코인아이디 코인송금 코인지급
낚시 낚시정보 어망 인벤 물고기도감 물고기판매 상점 낚시대ㄱㅁ 낚시장착
강화 보호권ㄱㅁ 보호권 ㄱㅁ행운 ㄱㅁ자동
펫뽑기 펫인벤 펫도감 펫기능 펫장착 펫강화
농장 농장정보 농장확장 씨앗ㄱㅁ 심기 수확 전체수확
퀴즈 정답 퀴즈정보 퀴즈순위
게임on 게임off 퀴즈작동 퀴즈중지 낚시작동 낚시중지 게임상태 게임정보
치트 회수 초기화 초기화확인 랭킹공개 랭킹비공개
핑`.trim().split(/\s+/));
// Block old # commands, including removed game toggles, before the legacy handlers.
const RETIRED=new Set([...COMMANDS,...[...COMMANDS].filter(x=>x.includes('ㄱㅁ')).map(x=>x.replace(/ㄱㅁ/g,'구매')),'게임순위','게임작동','게임중지']);
function commandName(text,prefix){
 const raw=String(text||'').trim();
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
 const raw=String(text||'').trim();
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
