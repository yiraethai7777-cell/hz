'use strict';
const FOLD='\u200b'.repeat(1200);
const LINKS='🌐 웹사이트: https://hz-production-d530.up.railway.app/\n👤 개발자 오픈프로필: https://open.kakao.com/o/sOmp64Si\n';
const group=(title,lines)=>title+'\n'+lines.map(s=>'  └─ '+s).join('\n');
const bodies={
 게임:[
  group('👤 시작 · 코인',[
   '#게임가입 — 처음 한 번 가입 · 10만 코인',
   '#정보 — 내 프로필·코인·레벨·게임 기록',
   '#코인순위 / #게임순위 — 방별 코인 순위',
   '#코인내역 / #코인아이디 — 거래 기록·내 ID',
   '#코인송금 @상대 금액 — 상대에게 보내기',
   '#코인지급 @상대 금액 — 관리자 코인 지급']),
  group('🎣 낚시 · 장비',[
   '#낚시 / #낚시정보 — 낚기·기록 확인',
   '#어망 — 한 번에 10마리 · 하루 5회 (한국시간)',
   '#인벤 / #물고기도감 — 보관함·물고기 종류',
   '#물고기판매 이름 수량 / #물고기판매 all',
   '#상점 / #낚시대구매 이름 / #낚시장착 이름',
   '#강화 횟수 — 낚시대 강화 · 최대 100회',
   '#보호권구매 개수 / #보호권',
   '#구매행운 / #구매자동 — 행운·자동 낚시']),
  group('🐾 펫',[
   '#펫뽑기 [10/50/100] — 펫 뽑기',
   '#펫인벤 / #펫도감 / #펫기능 이름',
   '#펫장착 이름 또는 최고 / #펫강화']),
  group('🌾 농장',[
   '#농장 / #농장정보 — 내 농장·성장·씨앗 확인',
   '#농장확장 — 코인으로 한 단계 확장 · 최대 8×8',
   '#씨앗구매 이름 수량 / #심기 번호 작물이름',
   '#수확 번호 / #전체수확 — 성숙 작물 수확·코인 지급',
   '#상점 — 낚시대·씨앗 통합 상점']),
  group('🧩 퀴즈',[
   '#퀴즈 — 시작 · 답만 입력하면 정답 인식',
   '#정답 답 — 명령어로도 정답 제출 가능',
   '#퀴즈정보 / #퀴즈순위 — 안내·정답 순위']),
  group('⚙️ 게임 설정 · 봇 계정 전용',[
   '#게임작동 / #게임중지',
   '#퀴즈작동 / #퀴즈중지',
   '#낚시작동 / #낚시중지',
   '#게임상태 / #게임정보 — 현재 상태·안내']),
  group('🔐 최고 관리자',[
   '#치트 금액 @상대 / #회수 금액 또는 all @상대',
   '#초기화 / #초기화확인 — 전체 게임 초기화']),
  group('🌐 공개 랭킹',[
   '#랭킹공개 공개용별명 / #랭킹비공개'])
 ].join('\n\n'),
 관리:[
  "[아래 명령어는 모든 사람이 사용 가능합니다]",
  "📅 출석 명령어",
  "!출석",
  "└─ 오늘의 출석을 합니다. (하루에 한 번)",
  "!출석순위",
  "└─ 오늘 출석한 모든 사람을 출석 순서대로 보여줍니다.",
  "📊 채팅 명령어",
  "!채팅순위",
  "└─ TOP 10 채팅 순위와 횟수를 보여줍니다.",
  "!채팅순위전체",
  "└─ 채팅한 모든 사람의 순위와 횟수를 보여줍니다.",
  "!채팅정보",
  "└─ 자신의 채팅 순위와 횟수를 보여줍니다.",
  "━━━━━━━━━━━━━━",
  "[아래 명령어는 방장과 부방장 또는 관리자만 사용 가능합니다]",
  "🛡️ 경고 명령어",
  "!경고 (멘션, 아이디, 답장) (개수) (사유)",
  "└─ 대상에게 경고를 부여합니다.",
  "!경고내역 (멘션, 아이디, 답장)",
  "└─ 대상의 경고 내역을 확인합니다.",
  "!경고삭제 (멘션, 아이디, 답장) (번호)",
  "└─ 대상의 지정 경고 번호를 삭제합니다.",
  "!경고초기화 (멘션, 아이디, 답장)",
  "└─ 대상의 모든 경고를 삭제합니다.",
  "👮 제재 명령어",
  "!kick / !k (멘션, 아이디, 답장)",
  "└─ 대상을 채팅방에서 내보냅니다.",
  "!내풀 (멘션, 아이디, 답장)",
  "└─ 대상을 내보낸 뒤 해제합니다.",
  "!벤해제 (아이디, 답장)",
  "└─ 대상의 내보내기를 해제합니다.",
  "!벤기록 (멘션, 아이디, 답장)",
  "└─ 대상의 내보내기 기록을 확인합니다.",
  "!관리로그",
  "└─ !kick, !k, !내풀 사용 내역 및 방장·부방장 강퇴 내역을 보여줍니다.",
  "퇴장 알림에 답장 형식으로 k",
  "└─ 나간 사람을 벤할 때 사용합니다. (방장·부방장)",
  "",
  "👋 입퇴장 명령어",
  "!입퇴장로그 (멘션, 아이디, 답장)",
  "└─ 대상의 입장·퇴장 내역을 보여줍니다.",
  "!입장변경 (내용)",
  "└─ 입장 시 인사말을 변경합니다.",
  "!퇴장변경 (내용)",
  "└─ 퇴장 시 인사말을 변경합니다.",
  "",
  "👤 프로필 명령어",
  "!프로필로그 (멘션, 아이디, 답장)",
  "└─ 대상의 오픈프로필 링크 내역을 보여줍니다.",
  "━━━━━━━━━━━━━━",
  "[아래 명령어는 봇 관리자만 사용 가능합니다]",
  "🔨 관리 명령어",
  "!관리on",
  "└─ 해당 방의 관리 기능을 켭니다.",
  "!관리off",
  "└─ 해당 방의 관리 기능을 끕니다.",
  "!관리자추가 (멘션, 아이디)",
  "└─ 해당 방의 지정 관리자를 추가합니다.",
  "!관리자삭제 (멘션, 아이디)",
  "└─ 해당 방의 지정 관리자를 삭제합니다.",
  "!도배감지on",
  "└─ 5초 안에 동일한 채팅·이모티콘 4회 → 경고 1개, 10회 → 내보내기",
  "!삭제감지on",
  "└─ 메시지 삭제 알림을 켭니다.",
  "!삭제감지off",
  "└─ 메시지 삭제 알림을 끕니다."
 ].join('\n'),
};
const MANAGEMENT_MENU='📜 명령어 안내\n작동 중인 기능 · 관리'+FOLD+'\n🛡️ 관리 명령어\n━━━━━━━━━━━━━━\n'+bodies.관리;
function formatCommandHelp(flags,requested='') {
 const groupName=requested==='기본'?'':requested;
 if(groupName==='관리')return flags.manage?MANAGEMENT_MENU:'⏹️ 이 방의 관리 기능은 중지되어 있습니다. !관리on';
 if(groupName&&!Object.hasOwn(bodies,groupName))return LINKS+'사용법: #명령어 [게임|관리]';
 const enabled=(groupName?[groupName]:['게임','관리']).filter(n=>n==='관리'?flags.manage:flags.game);
 if(!enabled.length)return LINKS+(groupName?`이 방의 ${groupName} 기능은 중지되어 있습니다.`:'현재 작동 중인 기능이 없습니다.\n봇 계정에서 #게임작동 또는 #관리작동을 입력해 주세요.');
 return LINKS+'📜 NEXUS 명령어 안내\n'+FOLD+'\n'+
  '작동 중인 기능 · '+enabled.join(' + ')+'\n#명령어 게임 / #명령어 관리로 따로 보기\n'+
  '대상 = ID·실제 멘션·답장·댓글 (명령별 지원)\n권한이 필요한 명령은 방장·부방장 또는 지정 관리자만 사용\n\n'+
  enabled.map(n=>(n==='관리'?'🛡️':'🎮')+' '+n+' 명령어\n━━━━━━━━━━━━━━\n'+bodies[n]).join('\n\n━━━━━━━━━━━━━━\n\n');
}
const commandLists=Object.fromEntries(['기본','게임','관리'].map(group=>[group,formatCommandHelp({game:true,manage:true},group)]));
async function handleExtraMessage(client,...args){
 const msg=args.length===1?args[0]:args[1],chat=args.length===1?(client.chat||client):args[0];
 if(msg?.room?.id==null)return false;
 const text=String(msg.message?.text??msg.text??'').trim();
 if(!/^#명령어(?:\s+.*)?$/.test(text))return false;
 const {getPool}=require('./db');
 const state=await getPool().query(`SELECT
  COALESCE((SELECT (data->>'game')::boolean FROM hz_rooms WHERE room_id=$1),FALSE) AS game,
  COALESCE((SELECT enabled FROM gl_manage_rooms WHERE room_id=$1),
   (SELECT (data->>'manage')::boolean FROM hz_rooms WHERE room_id=$1),FALSE) AS manage`,[String(msg.room.id)]);
 await chat.sendText(msg.room.id,formatCommandHelp(state.rows[0]||{},text.slice('#명령어'.length).trim()));
 return true;
}
async function attachExtraCommands(client){client.onMessage((...args)=>handleExtraMessage(client,...args));}
module.exports={handleExtraMessage,attachExtraCommands,formatCommandHelp,commandLists};
