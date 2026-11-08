'use strict';
// ARDEN presentation affects text generated within an enabled room's message context only.
const {AsyncLocalStorage}=require('node:async_hooks');
const gameAliases=require('../game/command-aliases');
const storage=new AsyncLocalStorage();
const BRAND='𝑨𝑹𝑫𝑬𝑵';
const THEMES=Object.freeze({
 GAME:{icon:'🎮',label:'GAME'},SECURITY:{icon:'🛡️',label:'SECURITY'},
 ATTENDANCE:{icon:'✅',label:'ATTENDANCE'},ACTIVITY:{icon:'📊',label:'ACTIVITY'},
 EVENT:{icon:'🎁',label:'EVENT'},CLAN:{icon:'⚜️',label:'CLAN'}
});
function category(text){
 const command=String(text??'').trim().split(/\s+/)[0];
 if(/^!클랜(?:가입|탈퇴|정보|설정on|설정off)$/.test(command))return 'CLAN';
 if(command==='ㅊㅅ'||/^!(?:출석|출석이미지|출석순위)$/.test(command))return 'ATTENDANCE';
 if(/^!(?:채팅순위|채팅순위전체|채팅정보)$/.test(command))return 'ACTIVITY';
 if(/^!(?:이벤|이벤트)/.test(command))return 'EVENT';
 if(gameAliases.isGameCommand(command)||/^!(?:게임명령어|타자게임|방게임시작|방게임종료|방게임명령어|출항|조황|수조|가방|도전|제출|명예의전당|교환소|어류도감|입문|놀이정보)$/.test(command))return 'GAME';
 if(/^!(?:관리|방관리|경고|방경고|차단|방차단|kick|k$|내풀|벤해제|벤기록|방관리기록|관리로그|입퇴장로그|입장변경|퇴장변경|프로필로그|공지|현공지삭제|삭제감지|멘션감지|도배감지|프로필감지|일괄강퇴|관리자|최고관리자|읽기감지|id$|멘션$|방강퇴|방입장변경|방퇴장변경)/.test(command))return 'SECURITY';
 return null;
}
function scope({roomId,text,active},operation){
 return storage.run({roomId:String(roomId),active:active===true,category:category(text)},operation);
}
function activeFor(roomId){
 const current=storage.getStore();
 return current?.active===true&&current.roomId===String(roomId);
}
function decorate(roomId,body){
 const current=storage.getStore();
 if(!activeFor(roomId)||typeof body!=='string'||!body.trim()||!current.category)return body;
 const theme=THEMES[current.category],heading=theme.icon+' '+BRAND+' | '+theme.label;
 if(body.startsWith('📜 명령어 안내 · NEXI')){
  return body.replace(/^📜 명령어 안내 · NEXI/,heading)
    .replace(/^(?:🎮|🛡️) (?:게임|관리) 명령어 · NEXI/m,heading)
    .replace(/✦ NEXI · 게임 & 관리 도우미\s*$/, '⚜️ '+BRAND+' · NEXI');
 }
 if(body.startsWith('⚜️ '+BRAND+' |')||body.startsWith(heading))return body;
 // A progress message is edited in-place by the original engine; preserve its body.
 if(current.category==='GAME'&&/^(?:⛏️?\s*)?(?:광질중|채굴중|낚시중|낚시 진행중)/.test(body))return body;
 return heading+'\n━━━━━━━━━━━━━━\n'+body;
}
module.exports={BRAND,THEMES,category,scope,activeFor,decorate};
