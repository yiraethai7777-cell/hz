# HZ BOT + KakaoForge 통합본

이 프로젝트는 KakaoForge 원본 소스와 `hz-bot.js`를 한 프로젝트에 합친 테스트용 통합본입니다.

## 포함
- KakaoForge 원본 `src/`
- HZ 게임/출석/준개/관리 봇 `hz-bot.js`
- 실행 연결 파일 `start.js`
- PostgreSQL 의존성 `pg`

## 실행 전 필요한 것
- Node.js 20+
- PostgreSQL 및 `DATABASE_URL`
- 이미 정상적으로 생성된 KakaoForge 인증 파일 `auth.json`

`auth.json`, `.env`, 토큰/비밀번호는 GitHub에 올리지 마세요.

## 실행
프로젝트에서 의존성을 설치한 뒤 `npm start`를 실행합니다. `start.js`는 기존 `auth.json`을 읽어 KakaoForge 클라이언트를 만들고, 연결 준비가 끝나면 HZ 봇을 붙입니다.

로그인/인증 절차 자체를 새로 구현한 파일은 포함하지 않았습니다. KakaoForge 원본 인증 소스는 원본 그대로 보존되어 있습니다.
