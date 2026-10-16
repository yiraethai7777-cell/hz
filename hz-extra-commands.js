"use strict";
// Independent HZ BOT extension. Does not change hz-bot.js.
const KST = "Asia/Seoul";
const NY = "America/New_York";

function parts(date, tz) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit", minute:"2-digit", hourCycle:"h23", hour12:false
  }).formatToParts(date);
  const v = Object.fromEntries(f.map(p => [p.type,p.value]));
  return {y:+v.year,m:+v.month,d:+v.day,h:+v.hour,min:+v.minute};
}
function zonedUtc(y,m,d,h,min,tz) {
  const desired=Date.UTC(y,m-1,d,h,min);
  let guess=desired;
  for(let i=0;i<4;i++) {
    const p=parts(new Date(guess),tz);
    const seen=Date.UTC(p.y,p.m-1,p.d,p.h,p.min);
    guess+=desired-seen;
  }
  return guess;
}
function fmtK(date) {
  return new Intl.DateTimeFormat("ko-KR",{timeZone:KST,month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",minute:"2-digit",hour12:false,hourCycle:"h23"}).format(date);
}
function duration(ms) {
  const minutes=Math.max(0,Math.ceil(ms/60000));
  const days=Math.floor(minutes/1440), hours=Math.floor(minutes%1440/60), mins=minutes%60;
  return (days?`${days}일 `:"")+(hours?`${hours}시간 `:"")+`${mins}분`;
}
function sessionInfo(tz,openH,openM,closeH,closeM,now) {
  const local=parts(now,tz);
  const day0=Date.UTC(local.y,local.m-1,local.d);
  const sessions=[];
  for(let i=-1;i<10;i++) {
    const day=new Date(day0+i*86400000);
    const weekday=day.getUTCDay();
    if(weekday===0||weekday===6)continue;
    const yy=day.getUTCFullYear(),mm=day.getUTCMonth()+1,dd=day.getUTCDate();
    const start=zonedUtc(yy,mm,dd,openH,openM,tz);
    const end=zonedUtc(yy,mm,dd,closeH,closeM,tz);
    sessions.push({start,end});
  }
  const ms=now.getTime();
  const active=sessions.find(s=>s.start<=ms&&ms<s.end);
  const next=sessions.find(s=>s.start>ms);
  return {active,next};
}
function marketLine(title,tz,openH,openM,closeH,closeM,now) {
  const {active,next}=sessionInfo(tz,openH,openM,closeH,closeM,now);
  let lines=[title];
  if(active) {
    lines.push("🟢 거래 중",`⏱ 개장 후 ${duration(now-active.start)} 경과`,`⏳ 마감까지 ${duration(active.end-now)} 남음`,`🕒 오늘 ${fmtK(new Date(active.start))} ~ ${fmtK(new Date(active.end))}`);
  } else {
    lines.push("🔴 장 마감");
    if(next) lines.push(`⏳ 다음 개장까지 ${duration(next.start-now)}`,`🕒 다음 개장: ${fmtK(new Date(next.start))}`);
  }
  return {active,lines};
}
function stockTimeText(now=new Date()) {
  const korea=marketLine("🇰🇷 한국 · KOSPI/KOSDAQ",KST,9,0,15,30,now);
  const usa=marketLine("🇺🇸 미국 · NYSE/NASDAQ",NY,9,30,16,0,now);
  const open=[korea.active?"한국":null,usa.active?"미국":null].filter(Boolean);
  const out=["📈 HZ BOT | 주식시간",`📅 기준: ${fmtK(now)} (한국시간)`,`✅ 현재 열린 장: ${open.length?open.join(", "):"없음"}`,"",...korea.lines,"",...usa.lines,"","📌 정규장 기준 · 주말 제외","⚠️ 공휴일·임시 휴장일은 별도 확인 필요"];
  return out.join("\n");
}
// Only the heading appears before KakaoTalk's "전체보기" fold.
const FOLD = "\u200b".repeat(1200);
const detailedHelp = [
  "🎮 게임 · 코인",
  "!게임가입 — 게임 가입 및 최초 가입 보상 받기",
  "!코인 — 내 가상 코인 잔액 확인",
  "!코인순위 — 이 채팅방의 코인 보유 순위 확인",
  "!코인내역 — 내 코인 지급·송금·사용 기록 확인",
  "!코인송금 @상대 1000 — 실제 멘션한 상대에게 1,000코인 송금",
  "!코인지급 @상대 1000 — 관리자 권한으로 코인 지급",
  "!코인아이디 — 내 사용자 ID 확인",
  "!레벨 — 레벨 및 경험치 확인",
  "!내정보 — 게임 플레이 정보 확인",
  "!게임순위 — 게임 코인 순위 조회",
  "",
  "📈 주식 · 거래",
  "!주식시간 — 한국·미국 장 상태, 개장 후 경과 및 폐장까지 남은 시간",
  "!주식검색 삼성전자 — 지원되는 종목명·코드 검색",
  "!주식현황 삼성전자 — 최근 7거래일 주가 추이 표시",
  "!주식현황 삼성전자 30일 — 최근 30거래일 주가 추이 표시",
  "!주식구매 삼성전자 1 — 가상 코인으로 1주 매수",
  "!주식판매 삼성전자 1 — 보유 주식 1주 매도",
  "!내주식 — 보유 주식·수량·매수원금 확인",
  "!주식거래내역 — 최근 주식 매수·매도 기록 확인",
  "!주식시세 삼성전자 — 종목의 최근 시세 조회 (추가 개발 예정)",
  "!주식목록 한국/미국 — 각 시장 시가총액 TOP 20 (추가 개발 예정)",
  "!주식알림설정 / !주식알림해제 / !주식알림상태 — 장 개폐 알림 (추가 개발 예정)",
  "",
  "🎣 낚시 · 상점 · 강화",
  "!낚시 — 물고기 낚기",
  "!낚시정보 — 낚시 상태·기록 확인",
  "!물고기도감 / !물고기 도감 — 전체 물고기 종류 확인",
  "!인벤 — 보유한 물고기 확인",
  "!물고기판매 (이름) (수량/all) — 선택한 물고기 판매",
  "!물고기판매 all — 모든 물고기 판매",
  "!상점 — 낚시대 상품 및 가격 확인",
  "!낚시대구매 (이름) — 낚시대 구매",
  "!낚시장착 (이름) — 보유 낚시대 장착",
  "!강화 (횟수) — 낚시대 연속 강화 (최대 100회)",
  "!보호권구매 (개수) — 강화 보호권 구매",
  "!보호권 — 보유 보호권 확인",
  "!구매행운 — 낚시 행운 효과 구매",
  "!구매자동 — 10분 자동 낚시 이용",
  "",
  "🐾 펫",
  "!펫뽑기 / !펫뽑기 10/50/100 — 펫 뽑기",
  "!펫인벤 — 보유 펫 확인",
  "!펫도감 — 등장 가능한 펫 목록 확인",
  "!펫기능 (이름) — 지정한 펫의 능력 확인",
  "!펫장착 (이름/최고) — 펫 장착 또는 최고 펫 자동 선택",
  "!펫강화 — 장착된 펫 강화",
  "",
  "🧩 퀴즈 · 출석",
  "!퀴즈 — 퀴즈 시작",
  "!정답 (답) — 퀴즈 정답 제출",
  "!출석 — 오늘 출석하기",
  "!출석확인 @닉네임 — 특정 사용자 출석 여부 확인",
  "!출석순위 — 오늘 출석한 사용자 순위",
  "",
  "💬 채팅 통계",
  "!채팅순위 — 채팅 횟수 상위 10명 확인",
  "!채팅정보 — 내 채팅 횟수·순위·활동 일수 확인",
  "!채팅순위전체 — 모든 사용자 순위 (추가 개발 예정)",
  "!내채팅 — 누적 채팅·시간별 그래프 (추가 개발 예정)",
  "",
  "🛡️ 관리 · 보안",
  "!관리작동 / !관리중지 — 해당 방 관리 기능 켜기·끄기",
  "!게임작동 / !게임중지 — 게임 기능 켜기·끄기",
  "!퀴즈작동 / !퀴즈중지 — 퀴즈 기능 켜기·끄기",
  "!낚시작동 / !낚시중지 — 낚시 기능 켜기·끄기",
  "!경고 @닉네임 (개수) (사유) — 경고 등록",
  "!경고삭제 @닉네임 (번호) — 지정한 경고 삭제",
  "!경고내역 @닉네임 — 누적 경고 내역 확인",
  "!벤 @닉네임 — 권한·지원 범위 내 대상 강퇴 시도",
  "!벤등록 (ID) — 해당 사용자 재입장 자동 제재 등록",
  "!벤등록해제 (ID) — 등록 해제",
  "!벤등록목록 — 등록된 사용자 목록 조회",
  "!입퇴장로그 @닉네임 — 입장·퇴장 기록 확인",
  "!입장변경 (내용) / !퇴장변경 (내용) — 입퇴장 안내문 설정",
  "!내아이디 — 내 카카오톡 사용자 ID 확인",
  "!아이디 @닉네임 — 멘션한 사용자 ID 확인",
  "!프로필로그 @닉네임 — 프로필 변경 기록 확인",
  "!프로필진단 — 프로필 데이터 수신 상태 진단",
  "!삭메기록켜기 / !삭메기록끄기 — 삭제 메시지 임시 기록 설정",
  "!봇작동 — 봇 잠금 해제 (권한 필요)",
  "!홍보설정 (내용) — 자동 홍보 문구 저장",
  "!홍보시작 (분) — 지정한 간격으로 자동 홍보 시작",
  "!홍보중지 / !홍보확인 — 자동 홍보 중단·조회",
  "!도배방지 / !도배방지끄기 / !도배방지확인 — 홍보 도배 방지 설정",
  "",
  "📦 준개 기록",
  "!준개 (아이템) (값) — 개인 준개 기록 저장 (권한 필요)",
  "!준개내역 — 내 준개 기록 확인",
  "!준개내역삭제 (번호) — 지정한 내역 삭제",
  "!전체준개내역 — 전체 준개 기록 확인",
  "!준개작동 / !준개중지 — 준개 기능 켜기·끄기",
  "!준개권한추가 / !준개권한삭제 / !준개권한목록 — 사용 권한 관리",
  "",
  "🔐 최고 관리자",
  "!치트 (코인) @멘션 — 게임 코인 지급",
  "!회수 (코인/all) @멘션 — 게임 코인 회수",
  "!초기화 / !초기화확인 — 게임 데이터 전체 초기화 (주의)",
  "",
  "※ 관리자 명령어는 권한과 해당 방의 기능 설정에 따라 작동합니다.",
  "※ '추가 개발 예정' 명령어는 아직 사용할 수 없습니다."
].join("\n");
const commandLists={
  기본:"📜 헤이즈봇 명령어 안내\n"+FOLD+"\n"+detailedHelp,
  주식:"📈 주식 명령어\n"+FOLD+"\n"+detailedHelp.split("📈 주식 · 거래\n")[1].split("\n\n🎣")[0],
  게임:"🎮 게임 명령어\n"+FOLD+"\n"+detailedHelp.split("🎮 게임 · 코인\n")[1].split("\n\n📈")[0],
  관리:"🛡️ 관리 명령어\n"+FOLD+"\n"+detailedHelp.split("🛡️ 관리 · 보안\n")[1].split("\n\n📦")[0]
};
async function attachExtraCommands(client) {
  client.onMessage(async (...args)=>{
    const msg=args.length===1?args[0]:args[1];
    const chat=args.length===1?(client.chat||client):args[0];
    if(!msg?.room?.id)return;
    const text=String(msg.message?.text??msg.text??"").trim();
    if(text!=="!주식시간"&&!/^!명령어(?:\s+.*)?$/.test(text))return;
    try {
      let result;
      if(text==="!주식시간")result=stockTimeText();
      else {
        const group=text.slice("!명령어".length).trim();
        result=commandLists[group||"기본"]||"사용법: !명령어 [주식|게임|관리]";
      }
      await chat.sendText(msg.room.id,result);
    }catch(e){console.error("[HZ EXTRA]",e);}
  });
  console.log("[HZ EXTRA] 주식시간·간결한 명령어 준비 완료");
}
module.exports={attachExtraCommands,stockTimeText,sessionInfo,commandLists};
