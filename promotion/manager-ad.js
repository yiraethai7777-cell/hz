'use strict';

// The same native KakaoTalk "전체보기" spacer used in member notices.
// The teaser remains visible before the folded details.
const teaser=[
 '🚨 아직도 채팅방을 직접 관리하고 계신가요?',
 '🛡️ 경고·강퇴·입퇴장 관리, 이제 자동으로!',
 '🎮 낚시·채굴·퀴즈로 채팅방에 재미까지!',
 '🌐 전용 관리자 웹으로 언제 어디서든 관리',
 '',
 '👇 전체보기를 눌러 모든 기능을 확인하세요.'
].join('\n');
const details=[
 '🤖 카카오톡 매니저 | KakaoTalk Manager',
 '━━━━━━━━━━━━━━━━━━',
 '',
 '🛡️ 스마트 채팅방 관리',
 '• 입장·퇴장 자동 감지 및 관리 기록',
 '• 경고 지급·내역 확인·강퇴 기능',
 '• 삭제 메시지 및 도배 감지',
 '• 관리 권한·공지·채팅순위 관리',
 '',
 '🎮 다양한 게임 기능',
 '• 🎣 낚시·물고기 수집·판매',
 '• ⛏️ 채굴·광물 수집',
 '• 🧠 퀴즈·타자게임',
 '• 🏆 출석·랭킹·상점',
 '',
 '🌐 채팅방 전용 관리자 웹',
 '• 채팅방별 독립 관리 페이지',
 '• 인원별 경고·메모·강퇴',
 '• 기능 ON/OFF 및 방별 설정',
 '• 모바일·PC에서 편리하게 이용',
 '',
 '📦 원하는 요금제 선택',
 '🛡️ 관리형 — 채팅방 관리 기능',
 '🎮 게임형 — 게임 기능',
 '💎 종합형 — 관리 + 게임 전체',
 '📅 이용 일수 설정·남은 시간 확인·기간 연장',
 '',
 '━━━━━━━━━━━━━━━━━━',
 '🚀 복잡한 관리는 줄이고, 재미는 더하세요!',
 '',
 '🌐 서비스 및 관리자 웹',
 'https://hz-production-d530.up.railway.app/',
 '',
 '💬 이용 문의 및 신청',
 'https://open.kakao.com/o/gK32HUUi',
 '',
 '※ 카카오톡 공식 서비스가 아닌 독립 운영 봇입니다.'
].join('\n');
const FOLD_SPACER='\u200b'.repeat(1200);
const message=teaser+'\n'+FOLD_SPACER+'\n'+details;

// Install this requested announcement into the existing master web's shared
// promotion field exactly once. Preserve existing per-room ON/OFF settings and
// back up any previous shared message before replacing it.
async function install(db){
 await db.query(`CREATE TABLE IF NOT EXISTS gl_manager_promotion_seed (
  version SMALLINT PRIMARY KEY,
  previous_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 )`);
 const result=await db.query(`WITH first_install AS (
  INSERT INTO gl_manager_promotion_seed(version,previous_message)
  SELECT 1,COALESCE((SELECT message FROM gl_bot_promotion_settings WHERE id=1),'')
  ON CONFLICT(version) DO NOTHING RETURNING version
 )
 INSERT INTO gl_bot_promotion_settings(id,message)
 SELECT 1,$1 FROM first_install
 ON CONFLICT(id) DO UPDATE SET message=EXCLUDED.message,updated_at=NOW()
 RETURNING id`,[message]);
 return result.rowCount>0;
}
module.exports={message,teaser,details,FOLD_SPACER,install};
