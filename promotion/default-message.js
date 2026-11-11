'use strict';
// Reuse the native KakaoTalk fold spacer used by manage/leave-reply.js.
// Folding is controlled by the KakaoTalk client, not guaranteed by text alone.
const FOLD_SPACER='\u200b'.repeat(1200);
const INTRO="🚨 아직도 채팅방 관리, 직접 하고 계신가요?\n\n🛡️ 경고·강퇴·입퇴장 관리부터\n🎮 낚시·채굴·퀴즈까지 전부 자동으로!\n🌐 모바일·PC 전용 관리자 웹까지\n\n👇 [전체보기]를 눌러 기능과 이용 방법을 확인하세요!";
const DETAILS="🤖 카카오톡 매니저 | KakaoTalk Manager\n━━━━━━━━━━━━━━━━━━\n\n🛡️ 채팅방 관리 기능\n• 입장·퇴장 자동 감지 및 기록\n• 경고 지급·내역 확인·강퇴 관리\n• 삭제 메시지 감지 및 공지 관리\n• 관리자 권한 및 채팅순위 확인\n\n🎮 다양한 게임 기능\n• 🎣 낚시·물고기 수집·판매\n• ⛏️ 채굴·광물 수집\n• 🧠 퀴즈·타자게임\n• 🏆 출석·랭킹·상점\n\n🌐 전용 관리자 웹\n• 채팅방별 독립 관리 페이지\n• 인원별 경고·메모·관리\n• 기능 ON/OFF 및 방별 설정\n• PC·모바일에서 편리하게 관리\n\n📦 맞춤형 이용 요금제\n🛡️ 관리형 — 채팅방 관리 중심\n🎮 게임형 — 게임 기능 중심\n💎 종합형 — 관리와 게임 모두\n✅ 이용 기간 및 남은 시간 확인\n✅ 총관리자 웹에서 기간 연장\n\n━━━━━━━━━━━━━━━━━━\n🚀 복잡한 운영은 줄이고, 재미는 더하세요!\n\n🌐 서비스 안내\nhttps://hz-production-d530.up.railway.app/\n\n💬 이용 문의 및 신청\nhttps://open.kakao.com/o/gK32HUUi\n\n※ 카카오톡 공식 서비스가 아닌 독립 운영 봇입니다.";
const message=INTRO+'\n'+FOLD_SPACER+'\n'+DETAILS;
module.exports={message,FOLD_SPACER};
