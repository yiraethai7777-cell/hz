'use strict';
const FOLD='\u200b'.repeat(1200);
const group=(title,lines)=>title+'\n'+lines.map(s=>'  └─ '+s).join('\n');
const bodies={
 게임:[
  group('👤 시작 · 코인',[
   '!게임가입 — 처음 한 번 가입 · 10만 코인',
   '!정보 — 내 프로필·코인·레벨·게임 기록',
   '!코인순위 / !게임순위 — 방별 코인 순위',
   '!코인내역 / !코인아이디 — 거래 기록·내 ID',
   '!코인송금 @상대 금액 — 상대에게 보내기',
   '!코인지급 @상대 금액 — 관리자 코인 지급']),
  group('🎣 낚시 · 장비',[
   '!낚시 / !낚시정보 — 낚기·기록 확인',
   '!어망 — 한 번에 10마리 · 하루 5회 (한국시간)',
   '!인벤 / !물고기도감 — 보관함·물고기 종류',
   '!물고기판매 이름 수량 / !물고기판매 all',
   '!상점 / !낚시대구매 이름 / !낚시장착 이름',
   '!강화 횟수 — 낚시대 강화 · 최대 100회',
   '!보호권구매 개수 / !보호권',
   '!구매행운 / !구매자동 — 행운·자동 낚시']),
  group('🐾 펫',[
   '!펫뽑기 [10/50/100] — 펫 뽑기',
   '!펫인벤 / !펫도감 / !펫기능 이름',
   '!펫장착 이름 또는 최고 / !펫강화']),
  group('🧩 퀴즈',[
   '!퀴즈 — 시작 · 답만 입력하면 정답 인식',
   '!정답 답 — 명령어로도 정답 제출 가능',
   '!퀴즈정보 / !퀴즈순위 — 안내·정답 순위']),
  group('⚙️ 게임 설정 · 봇 계정 전용',[
   '!게임작동 / !게임중지',
   '!퀴즈작동 / !퀴즈중지',
   '!낚시작동 / !낚시중지',
   '!게임상태 / !게임정보 — 현재 상태·안내']),
  group('🔐 최고 관리자',[
   '!치트 금액 @상대 / !회수 금액 또는 all @상대',
   '!초기화 / !초기화확인 — 전체 게임 초기화']),
  group('🌐 공개 랭킹',[
   '!랭킹공개 공개용별명 / !랭킹비공개'])
 ].join('\n\n'),
 관리:[
  group('📅 출석 · 채팅',[
   '!출석 / !출석순위 / !출석확인 대상',
   '!채팅순위 / !채팅순위전체 — 더보기로 확인',
   '!채팅정보 — 내 채팅 통계',
   '!내아이디 / !아이디 대상 — 사용자 ID']),
  group('🛡️ 경고 · 제재',[
   '!경고 대상 개수 사유 / !경고내역 대상',
   '!경고삭제 대상 번호 / !경고초기화 대상',
   '!경고순위 — 방별 경고 순위',
   '!벤 ID 또는 @멘션 — 내보내기 (답장·댓글 가능)',
   '!내풀 대상 — 내보낸 뒤 즉시 해제',
   '!벤해제 대상 — 내보내기 해제',
   '!벤기록 [대상] / !관리로그 — 처리 기록',
   '퇴장 알림에 댓글 a — 방장·부방장만 벤']),
  group('👋 입퇴장 · 프로필',[
   '!입퇴장로그 대상 — 입장·퇴장 기록',
   '!입장변경 내용 / !퇴장변경 내용',
   '!프로필로그 대상 — 기록된 모든 옾링',
   '!프로필진단 — 오픈프로필 수신 상태',
   '입장·퇴장·프로필 변경 안내는 더보기로 표시']),
  group('⚙️ 관리 설정',[
   '!관리작동 / !관리중지 — 봇 계정 전용',
   '!관리상태 / !봇작동 — 상태·잠금 해제',
   '!관리자추가 ID / !관리자삭제 ID / !관리자목록',
   '!도배감지켜기 / !도배감지끄기 — 동일 글·임티 4회 경고 1개, 10회 벤',
   '!삭제감지켜기 / !삭제감지끄기',
   '삭제 알림에는 삭제한 사람만 표시'])
 ].join('\n\n')
};
function formatCommandHelp(flags,requested='') {
 const groupName=requested==='기본'?'':requested;
 if(groupName&&!Object.hasOwn(bodies,groupName))return '사용법: !명령어 [게임|관리]';
 const enabled=(groupName?[groupName]:['게임','관리']).filter(n=>n==='관리'?flags.manage:flags.game);
 if(!enabled.length)return groupName?`이 방의 ${groupName} 기능은 중지되어 있습니다.`:'현재 작동 중인 기능이 없습니다.\n봇 계정에서 !게임작동 또는 !관리작동을 입력해 주세요.';
 return '📜 GL 명령어 안내\n'+FOLD+'\n'+
  '작동 중인 기능 · '+enabled.join(' + ')+'\n!명령어 게임 / !명령어 관리로 따로 보기\n'+
  '대상 = ID·실제 멘션·답장·댓글 (명령별 지원)\n권한이 필요한 명령은 방장·부방장 또는 지정 관리자만 사용\n\n'+
  enabled.map(n=>(n==='관리'?'🛡️':'🎮')+' '+n+' 명령어\n━━━━━━━━━━━━━━\n'+bodies[n]).join('\n\n━━━━━━━━━━━━━━\n\n');
}
const commandLists=Object.fromEntries(['기본','게임','관리'].map(group=>[group,formatCommandHelp({game:true,manage:true},group)]));
async function handleExtraMessage(client,...args){
 const msg=args.length===1?args[0]:args[1],chat=args.length===1?(client.chat||client):args[0];
 if(msg?.room?.id==null)return false;
 const text=String(msg.message?.text??msg.text??'').trim();
 if(!/^!명령어(?:\s+.*)?$/.test(text))return false;
 const {getPool}=require('./db');
 const state=await getPool().query(`SELECT
  COALESCE((SELECT (data->>'game')::boolean FROM hz_rooms WHERE room_id=$1),FALSE) AS game,
  COALESCE((SELECT enabled FROM gl_manage_rooms WHERE room_id=$1),
   (SELECT (data->>'manage')::boolean FROM hz_rooms WHERE room_id=$1),FALSE) AS manage`,[String(msg.room.id)]);
 await chat.sendText(msg.room.id,formatCommandHelp(state.rows[0]||{},text.slice('!명령어'.length).trim()));
 return true;
}
async function attachExtraCommands(client){client.onMessage((...args)=>handleExtraMessage(client,...args));}
module.exports={handleExtraMessage,attachExtraCommands,formatCommandHelp,commandLists};
