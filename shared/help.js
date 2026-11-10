'use strict';
const FOLD='\u200b'.repeat(1200);
// Internal/destructive commands must never appear in user-facing command menus.
const HIDDEN_HELP_COMMANDS=new Set(['!일괄강퇴']);
function hidePrivateHelpCommands(body){
 const visible=[];
 let hideDetail=false;
 for(const line of String(body).split('\n')){
  const value=line.trim();
  if([...HIDDEN_HELP_COMMANDS].some(cmd=>value===cmd||value.startsWith(cmd+' ')||value.startsWith(cmd+'('))){hideDetail=true;continue;}
  if(hideDetail&&(value===''||value.startsWith('└─')))continue;
  hideDetail=false;
  visible.push(line);
 }
 return visible.join('\n');
}

const LINKS='🌐 웹사이트: https://hz-production-d530.up.railway.app/\n👤 개발자 오픈프로필: https://open.kakao.com/o/sOmp64Si\n';
const group=(title,lines)=>title+'\n'+lines.map(s=>'  └─ '+s).join('\n');
const bodies={
 게임:[
  "👤 시작 · 코인",
  "",
  "!게임가입",
  "└─ 처음 한 번 가입하고 10만 코인을 받습니다.",
  "",
  "!정보",
  "└─ 내 프로필과 코인·레벨·게임 기록을 확인합니다.",
  "",
  "!코인순위",
  "└─ 해당 방의 코인 순위를 보여줍니다.",
  "",
  "!코인내역",
  "└─ 코인 거래 내역을 확인합니다.",
  "",
  "!코인아이디",
  "└─ 자신의 코인 사용자 ID를 확인합니다.",
  "",
  "!코인송금 (@멘션) (금액 또는 all)",
  "└─ 지정한 상대에게 코인을 보냅니다. all은 보유 코인 전액입니다.",
  "",
  "!코인지급 (@멘션) (금액)",
  "└─ 관리자가 상대에게 코인을 지급합니다.",
  "",

    "⛏ 광물 채굴",
    "",
    "!광산",
    "└─ 광물 종류·확률·판매가를 확인합니다.",
    "",
    "!채굴",
    "└─ 20초마다 광물을 채굴합니다. (하루 한도 없음)",
    "",
    "!광물인벤",
    "└─ 내 광물과 전체 판매가를 확인합니다.",
    "",
    "!곡괭이",
    "└─ 현재 곡괭이를 확인합니다.",
    "",
    "!곡괭이구매 (이름)",
    "└─ 상점에서 곡괭이를 구매합니다. 더 좋으면 자동 장착됩니다.",
    "",
    "!곡괭이장착 (이름)",
    "└─ 보유한 곡괭이를 장착합니다.",
    "",
    "!채굴지 (장소)",
    "└─ 현재 장소와 이동 가능한 광산을 확인하거나 이동합니다.",
    "",
    "!광물판매 전체",
    "└─ 전부 판매합니다. !광물판매 철광석 2 처럼 일부 판매도 가능합니다.",
    "",
  "🎣 낚시 · 장비",
  "",
  "!낚시",
  "└─ 낚시를 진행합니다.",
  "",
  "!낚시정보",
  "└─ 낚시 기록을 확인합니다.",
  "",
  "!어망",
  "└─ 물고기를 한 번에 10마리 낚습니다. (한국시간 기준 하루 5회)",
  "",
  "!인벤",
  "└─ 보유 중인 아이템을 확인합니다.",
  "",
  "!물고기도감",
  "└─ 물고기 종류를 확인합니다.",
  "",
  "!물고기판매 (이름) (수량)",
  "└─ 지정한 물고기를 수량만큼 판매합니다.",
  "",
  "!물고기전송 (@멘션) (물고기 종류) (개수)",
  "└─ 해당 종류를 지정한 수량만큼 상대의 인벤으로 전송합니다.",
  "!물고기전송 (@멘션) all",
  "└─ 보유한 모든 물고기를 상대에게 전송합니다.",
  "!물고기판매 (all)",
  "└─ 보유한 물고기를 모두 판매합니다.",
  "",
  "!상점",
  "└─ 곡괭이·낚싯대·씨앗·소모품을 확인합니다. !상점 곡괭이",
  "",
  "!낚시대ㄱㅁ (이름)",
  "└─ 지정한 낚시대를 구매합니다.",
  "",
  "!낚시장착 (이름)",
  "└─ 지정한 낚시대를 장착합니다.",
  "",
  "!강화 (횟수)",
  "└─ 낚시대를 강화합니다. (최대 100회)",
  "",
  "!보호권ㄱㅁ (개수)",
  "└─ 강화 보호권을 구매합니다.",
  "",
  "!보호권",
  "└─ 강화 보호권을 확인합니다.",
  "",
  "!ㄱㅁ행운",
  "└─ 행운 기능을 구매합니다.",
  "",
  "!ㄱㅁ자동",
  "└─ 자동 낚시 기능을 구매합니다.",
  "",
  "🐾 펫",
  "",
  "!펫뽑기 (10 / 50 / 100 / 500)",
  "└─ 선택한 횟수만큼 펫을 뽑습니다.",
  "",
  "!펫인벤",
  "└─ 보유한 펫을 확인합니다.",
  "",
  "!펫도감",
  "└─ 펫 종류를 확인합니다.",
  "",
  "!펫기능 (이름)",
  "└─ 선택한 펫의 기능을 확인합니다.",
  "",
  "!펫장착 (이름 또는 최고)",
  "└─ 원하는 펫 또는 가장 높은 등급의 펫을 장착합니다.",
  "",
  "!펫강화 (횟수: 1~20)",
  "└─ 장착한 펫을 강화합니다.",
  "",
  "🌾 농장",
  "",
  "!농장",
  "└─ 내 농장을 확인합니다.",
  "",
  "!농장정보",
  "└─ 농장의 성장 상태와 씨앗 정보를 확인합니다.",
  "",
  "!농장확장",
  "└─ 코인으로 농장을 확장합니다. (최대 8×8)",
  "",
  "!씨앗ㄱㅁ (이름) (수량)",
  "└─ 씨앗을 구매합니다.",
  "",
  "!심기 (번호 또는 all) (작물이름)",
  "└─ 선택한 밭 또는 모든 빈 밭에 씨앗을 심습니다.",
  "",
  "!수확 (번호)",
  "└─ 선택한 밭의 작물을 수확합니다.",
  "",
  "!전체수확",
  "└─ 수확 가능한 작물을 모두 수확합니다.",
  "",
  "🧩 퀴즈",
  "",
  "!퀴즈",
  "└─ 퀴즈를 시작합니다. 일반 채팅으로도 정답을 입력할 수 있습니다.",
  "",
  "!정답 (답)",
  "└─ 명령어로 정답을 제출합니다.",
  "",
  "!퀴즈정보",
  "└─ 퀴즈 정보를 확인합니다.",
  "",
  "!퀴즈순위",
  "└─ 정답 순위를 확인합니다.",
  "",
  "⚙️ 게임 설정 · 봇 계정 전용",
  "",
  "!게임on",
  "└─ 해당 방의 게임 기능을 켭니다.",
  "",
  "!게임off",
  "└─ 해당 방의 게임 기능을 끕니다.",
  "",
  "!퀴즈작동",
  "└─ 퀴즈 기능을 켭니다.",
  "",
  "!퀴즈중지",
  "└─ 퀴즈 기능을 끕니다.",
  "",
  "!낚시작동",
  "└─ 낚시 기능을 켭니다.",
  "",
  "!낚시중지",
  "└─ 낚시 기능을 끕니다.",
  "",
  "!게임상태",
  "└─ 게임·퀴즈·낚시 작동 상태를 확인합니다.",
  "",
  "!게임정보",
  "└─ 게임의 기본 정보를 확인합니다.",
  "",
  "🔐 최고 관리자",
  "",
  "!치트 (금액) (@멘션)",
  "└─ 최고 관리자가 코인을 지급합니다.",
  "",
  "!회수 (금액 또는 all) (@멘션)",
  "└─ 최고 관리자가 코인을 회수합니다.",
  "",
  "!코인초기화",
  "└─ 현재 방의 모든 코인 잔액을 0으로 초기화 요청 (최고관리자/봇)",
  "",
  "!코인초기화 확인",
  "└─ 60초 안에 같은 방에서 초기화 확정 (!코인초기화 취소 가능)",
  "",
  "!게임초기화",
  "└─ 해당 방의 모든 게임 DB(코인·낚시·펫·농장·포켓몬·퀴즈)를 초기화합니다.",
  "",
  "!게임초기화 확인",
  "└─ 60초 안에 초기화 확정 (!게임초기화 취소 가능)",
  "",
  "!초기화",
  "└─ 전체 게임 초기화를 요청합니다.",
  "",
  "!초기화확인",
  "└─ 요청한 게임 초기화를 확정합니다.",
  "",
  "🌐 공개 랭킹",
  "",
  "!랭킹공개 (공개용별명)",
  "└─ 웹 랭킹에 사용할 별명을 설정하고 공개합니다.",
  "",
  "!랭킹비공개",
  "└─ 웹 랭킹에서 자신의 정보를 비공개로 변경합니다."
 ].join('\n'),
 관리:[
  "[아래 명령어는 모든 사람이 사용 가능합니다]",
  "",
  "📅 출석 명령어",
  "",
  "!출석 / ㅊㅅ",
  "└─ 이미지는 보내지 않고 출석 순위·시간·보상 정보를 채팅으로 안내합니다. (하루 한 번 보상)",
  "",
  "!출석순위",
  "└─ 오늘 출석한 모든 사람을 순서대로 채팅으로 보여줍니다.",
  "",
  "📊 채팅 명령어",
  "",
  "!채팅순위",
  "└─ 이미지 없이 채팅으로 TOP 10 순위·이름·횟수를 보여줍니다.",
  "",
  "!채팅순위전체",
  "└─ 채팅한 모든 사람의 순위와 횟수를 보여줍니다.",
  "",
  "!채팅정보",
  "└─ 자신의 채팅 순위와 횟수를 보여줍니다.",
  "",
  "━━━━━━━━━━━━━━",
  "[아래 명령어는 방장과 부방장 또는 관리자만 사용 가능합니다]",
  "",
  "🆔 ID 확인",
  "",
  "!id / !id (멘션, 아이디, 답장)",
  "└─ 본인 또는 대상의 사용자 ID를 확인합니다. (방장·부방장·봇 계정)",
  "",
  "🛡️ 경고 명령어",
  "",
  "!읽기감지 (메시지에 답장)",
  "└─ 봇이 실제로 받은 읽음 이벤트 기준으로 확인된 사람만 표시합니다. 완전한 명단은 아닙니다.",
  "",
  "!멘션 (@멘션) (횟수)",
  "└─ 지정한 횟수만큼 멘션합니다. 봇 계정은 쿨타임 없음. 다른 관리자는 60초 쿨타임.",
  "",
  "!차단 (멘션, 아이디, 답장) [사유]",
  "└─ 봇 계정·최고관리자 전용. 카카오톡 매니저 명령어만 무시합니다. (카카오톡 실제 차단 아님)",
  "",
  "!차단해제 (멘션, 아이디, 답장)",
  "└─ 봇 계정·최고관리자 전용. 명령어 차단을 해제합니다.",
  "",
  "!차단목록",
  "└─ 봇 계정·최고관리자 전용. 이 방의 차단 목록을 확인합니다.",
  "",
  "!경고 (멘션, 아이디, 답장) (개수) (사유)",
  "└─ 대상에게 경고를 부여합니다.",
  "",
  "!경고내역 (멘션, 아이디, 답장)",
  "└─ 대상의 경고 내역을 확인합니다.",
  "",
  "!경고삭제 (멘션, 아이디, 답장) (번호)",
  "└─ 대상의 지정 경고 번호를 삭제합니다.",
  "",
  "!경고초기화 (멘션, 아이디, 답장)",
  "└─ 대상의 모든 경고를 삭제합니다.",
  "",
  "👮 제재 명령어",
  "",
  "!kick / !k (멘션, 아이디, 답장)",
  "└─ 대상을 채팅방에서 내보냅니다.",
  "",
  "!내풀 (멘션, 아이디, 답장)",
  "└─ 대상을 내보낸 뒤 해제합니다.",
  "",
  "!벤해제 (아이디, 답장)",
  "└─ 대상의 내보내기를 해제합니다.",
  "",
  "!벤기록 (멘션, 아이디, 답장)",
  "└─ 대상의 내보내기 기록을 확인합니다.",
  "",
  "!관리로그",
  "└─ !kick, !k, !내풀 사용 내역 및 방장·부방장 강퇴 내역을 보여줍니다.",
  "",
  "퇴장 알림에 답장으로 k 또는 p",
  "└─ 나간 사람의 강퇴 확인을 요청합니다. 60초 안에 y로 동의하거나 n으로 취소합니다. (방장·부방장·지정 관리자)",
  "",
  "👋 입퇴장 명령어",
  "",
  "!입퇴장로그 (멘션, 아이디, 답장)",
  "└─ 대상의 입장·퇴장 내역을 보여줍니다.",
  "",
  "!입장변경 (내용)",
  "└─ 입장 시 인사말을 변경합니다.",
  "",
  "!퇴장변경 (내용)",
  "└─ 퇴장 시 인사말을 변경합니다.",
  "",
  "👤 프로필 명령어",
  "",
  "!프로필로그 (멘션, 아이디, 답장)",
  "└─ 대상의 오픈프로필 링크 내역을 보여줍니다.",
  "",
  "📢 공지 관리",
  "",
  "!공지등록 (내용)",
  "└─ 채팅방에 실제 공지를 즉시 등록합니다. (등록 연동 필요)",
  "",
  "",
  "!공지예약 (HH:MM) (내용)",
  "└─ 지정한 한국시간에 실제 채팅방 공지를 1회 등록합니다. (등록 연동 필요)",
  "",
  "!현공지삭제",
  "└─ 봇이 등록한 현재 채팅방 공지를 삭제합니다. (삭제 API 지원 필요)",
  "",
  "!공지목록",
  "└─ 예약한 공지 목록을 번호로 표시합니다.",
  "",
  "!공지삭제 (번호)",
  "└─ 해당 번호의 예약 공지를 삭제합니다.",
  "",
  "━━━━━━━━━━━━━━",
  "[아래 명령어는 권한에 따라 사용할 수 있습니다]",
  "",
  "🔨 관리 명령어",
  "",
  "!봇켜기",
  "└─ 봇 계정·해당 방 최고관리자만 가능합니다. 이 방에서 카카오톡 매니저 봇을 다시 켭니다.",
  "",
  "!봇끄기",
  "└─ 봇 계정·해당 방 최고관리자만 가능합니다. 다른 방에는 영향이 없습니다.",
  "",
  "!도배시작 (내용)",
  "└─ 봇 계정 전용 · 내용 최대 200자, 100ms 간격으로 최대 100회 전송",
  "",
  "!도배중지",
  "└─ 실행 중인 반복 전송을 즉시 중단합니다. (봇 계정 전용)",
  "",
  "!관리on",
  "└─ 해당 방의 관리 기능을 켭니다.",
  "",
  "!관리off",
  "└─ 해당 방의 관리 기능을 끕니다.",
  "",
  "!관리자추가 (멘션, 아이디)",
  "└─ 대상에게 이 방의 봇 관리자 명령어 사용 권한을 부여합니다. (다른 방·카카오 방장 권한 제외)",
  "",
  "!관리자삭제 (멘션, 아이디)",
  "└─ 해당 방의 지정 관리자를 삭제합니다.",
  "",
  "👑 최고관리자 지정",
  "└─ 최고관리자 추가·삭제는 카카오톡 매니저 총관리자 웹에서만 가능합니다.",
  "",
  "!도배감지on",
  "└─ 5초 안에 동일한 채팅·이모티콘 4회 → 경고 1개, 10회 → 내보내기",
  "",
  "!삭제감지on",
  "└─ 메시지 삭제 알림을 켭니다.",
  "",
  "!삭제감지off",
  "└─ 메시지 삭제 알림을 끕니다.",
  "",
  "!프로필감지on",
  "└─ 이 방의 닉네임·프로필 변경 알림을 켭니다.",
  "",
  "!프로필감지off",
  "└─ 이 방의 닉네임·프로필 변경 알림을 끕니다. (기록은 유지)",
  "",
  "🔔 멘션 감지",
  "",
  "!멘션감지on",
  "└─멘션 기록 및 알람을 켭니다.",
  "",
  "!멘션감지off",
  "└─ 멘션 기록 및 알람을 끕니다",
 ].join('\n'),
};
const MANAGER_CONTACT='💬 카카오톡 매니저 문의방\nhttps://open.kakao.com/o/gK32HUUi';
const MANAGER_SIGNOFF='\n\n━━━━━━━━━━━━━━\n✦ 카카오톡 매니저 · 게임 & 관리 도우미';
const MANAGEMENT_MENU='📜 카카오톡 매니저 | 명령어 안내\n작동 중인 기능 · 관리'+FOLD+'\n🛡️ 카카오톡 관리 매니저\n━━━━━━━━━━━━━━\n'+MANAGER_CONTACT+'\n━━━━━━━━━━━━━━\n'+hidePrivateHelpCommands(bodies.관리)+MANAGER_SIGNOFF;
const GAME_MENU='📜 카카오톡 매니저 | 명령어 안내\n작동 중인 기능 · 게임'+FOLD+'\n🎮 카카오톡 게임 매니저\n━━━━━━━━━━━━━━\n'+MANAGER_CONTACT+'\n━━━━━━━━━━━━━━\n'+bodies.게임+MANAGER_SIGNOFF;
function formatCommandHelpBase(flags,requested='') {
 const groupName=requested==='기본'?'':requested;
 if(groupName==='관리')return flags.manage?MANAGEMENT_MENU:'⏹️ 이 방의 관리 기능은 중지되어 있습니다. !관리on';
 if(groupName==='게임')return flags.game?GAME_MENU:'⏹️ 이 방의 게임 기능은 중지되어 있습니다. !게임on';
 return '📜 카카오톡 매니저 | 명령어 안내\n🎮 게임: !게임명령어\n🛡️ 관리: !관리명령어';
}
function formatCommandHelp(flags,requested='',prefix='!'){
 const result=formatCommandHelpBase(flags,requested);
 return prefix==='!'?result:result.replace(/!([a-zA-Z0-9가-힣ㄱ-ㅎ]+)/g,(_,command)=>prefix+command);
}
const commandLists=Object.fromEntries(['기본','게임','관리'].map(group=>[group,formatCommandHelp({game:true,manage:true},group)]));

const HELP_COMMANDS=new Set(['!명령어','!help','!관리명령어','!게임명령어']);
// Match the effective flags used by the actual game and management handlers.
// A gl_manage_rooms override takes precedence over the legacy hz_rooms JSON flag.
async function getRoomHelpFlags(roomId,db=require('./db').getPool()){
 const result=await db.query(
  "SELECT COALESCE((SELECT (data->>'game')::boolean FROM hz_rooms WHERE room_id=$1),FALSE) AS game,"+
  " COALESCE((SELECT enabled FROM gl_manage_rooms WHERE room_id=$1),"+
  " (SELECT (data->>'manage')::boolean FROM hz_rooms WHERE room_id=$1),FALSE) AS manage",
  [String(roomId)]
 );
 return {game:result.rows[0]?.game===true,manage:result.rows[0]?.manage===true};
}
// Returns individual chat bubbles; never concatenate the comprehensive menus.
function commandMenuMessages(flags,requested='',prefix='!'){
 const active={game:flags?.game===true,manage:flags?.manage===true};
 let messages;
 if(requested==='게임')messages=[formatCommandHelpBase(active,'게임')];
 else if(requested==='관리')messages=[formatCommandHelpBase(active,'관리')];
 else if(active.game&&active.manage)messages=[GAME_MENU,MANAGEMENT_MENU];
 else if(active.game)messages=[GAME_MENU];
 else if(active.manage)messages=[MANAGEMENT_MENU];
 else messages=['⏹️ 이 방에서는 게임과 관리 기능이 모두 꺼져 있습니다.'];
 const normalizedPrefix=String(prefix||'!');
 return normalizedPrefix==='!'?messages:messages.map(body=>body.replace(/!([a-zA-Z0-9가-힣ㄱ-ㅎ]+)/g,(_,command)=>normalizedPrefix+command));
}
async function sendRoomCommandHelp({text,roomId,send,db,prefix}){
 const command=String(text??'').trim();
 if(!HELP_COMMANDS.has(command))return false;
 const flags=await getRoomHelpFlags(roomId,db);
 const requested=command==='!게임명령어'?'게임':command==='!관리명령어'?'관리':'';
 const actualPrefix=prefix??(await require('./command-prefixes').get(roomId))[0];
 for(const message of commandMenuMessages(flags,requested,actualPrefix))await send(message);
 return true;
}

async function handleExtraMessage(client,...args){
 const msg=args.length===1?args[0]:args[1],chat=args.length===1?(client.chat||client):args[0];
 if(msg?.room?.id==null)return false;
 const text=String(msg.message?.text??msg.text??'').trim();
 if(text==='!문의방'){
  await chat.sendText(msg.room.id,MANAGER_CONTACT);
  return true;
 }
 if(HELP_COMMANDS.has(text)){
  return sendRoomCommandHelp({text,roomId:msg.room.id,send:body=>chat.sendText(msg.room.id,body)});
 }
 if(!/^#명령어(?:\s+.*)?$/.test(text))return false;
 if(text.slice('#명령어'.length).trim()==='게임'){
  await chat.sendText(msg.room.id,'🎮 게임 명령어는 !게임명령어를 입력해 주세요.');
  return true;
 }
 if(text.slice('#명령어'.length).trim()==='관리'){
  await chat.sendText(msg.room.id,'🛡️ 관리 명령어는 !관리명령어를 입력해 주세요.');
  return true;
 }
 await chat.sendText(msg.room.id,'📜 명령어 안내\n🎮 게임: !게임명령어\n🛡️ 관리: !관리명령어');
 return true;
}
async function attachExtraCommands(client){client.onMessage((...args)=>handleExtraMessage(client,...args));}
module.exports={handleExtraMessage,attachExtraCommands,formatCommandHelp,commandLists,hidePrivateHelpCommands,getRoomHelpFlags,commandMenuMessages,sendRoomCommandHelp};
