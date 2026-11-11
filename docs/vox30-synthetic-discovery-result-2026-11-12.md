# VOX 30000 실서버 탐색 프로토콜 테스트 — 2026-11-12

## 실행 범위

- GitHub Actions의 별도 실험 환경에서 수행. Railway 운영 봇은 변경하거나 호출하지 않음.
- 기존 카카오톡 인증 토큰, deviceUuid, 실제 사용자·방 ID, SDP 사용하지 않음.
- 가상의 Int64 ID 9223372036854775806을 userId/chatId로 사용.
- method 30000을 한 번 전송한 뒤, 응답된 통화 서버 주소에 TLS ClientHello만 추가로 전송.
- method 11028 / 10028 생성 요청, 실제 OAuth 인증, 보이스룸 생성/참가, 미디어 세션은 실행하지 않음.

## 공개 자료

2020년 KakaoTalk VOIP 분석에는 12바이트 헤더, MD5(first 8 bytes), SEED-CBC,
BSON, method 0x7530(30000) call server prepare가 기록되어 있음.

https://gist.github.com/storycraft/ffdd727dbd45d9ae047a3ee93a83839f

해당 자료의 live talk 생성 메서드 0x272c(10028)는 사용자가 제공한 VOX 3.0 샘플의 11028과 다름.
현행 버전에서 어느 생성 메서드가 옳은지는 아직 확인되지 않음.

## 검증 결과

대상: 사용자 제공 후보 211.242.12.121:9282, TLS SNI kakao.com
(이 후보가 카카오 공식 VOX 진입 서버라는 별도 증명은 아직 없음)

| 확인 항목 | 검사 결과 |
| --- | --- |
| SEED-CBC/BSON method 30000 요청 | 1회 전송 |
| method 30000 형식의 복호화된 응답 | 수신 성공 |
| callable 필드 | 존재, 값 1 |
| csSslAddr 객체 | 존재 |
| csSslAddr.ip와 csSslAddr.port | 존재 |
| 반환된 통화 서버 주소 | 유효한 공인 IPv4·포트 |
| 반환된 통화 서버로 TLS 인증서 검사 | 성공 (SNI kakao.com) |
| 실제 카카오톡 VOX 계정 인증 | 미실행 |
| 실제 보이스룸 개설 | 미실행 |

합성 ID에서도 callable=1이므로, 이 값은 실제 계정의 채팅방 멤버십이나
보이스룸 개설 허가를 의미하지 않음.

CI 출력에는 서버가 반환한 IP/포트, 응답 원문, OAuth 등 보안 정보를 기록하지 않음.

## 재현 방법

- 루트 의존성: npm ci --ignore-scripts
- 분리된 실험 의존성: npm install --prefix experiments/vox30 --ignore-scripts --no-audit --no-fund
- 오프라인 테스트: node --test test/vox30-synthetic-discovery.test.js
- 1회 네트워크 실험: node experiments/vox30/synthetic-discovery.js --execute-once
- execute-once 옵션이 없으면 네트워크 전송을 차단

## 남은 작업

1. Railway 실제 봇 계정의 신원을 소유자 확인 하에 검증하는 프로토콜 시험 경로
2. 실제 버전과 일치하는 모델, SDK, buildId, carrierId, appVer 필드 출처 검증
3. 기존 OAuth가 VOX 서버에서 승인되는지 검증, 비밀 토큰 로그 금지
4. 11028과 10028의 차이 및 현행 생성/거절 이벤트 규격 검증
5. WebRTC ICE/DTLS 연결 유지, VOX PING, 종료 프로토콜 검증
6. 모든 조건 확인 후에만 Railway #보룸시작 실제 생성 경로 연결

안전 조건: 합성 callable=1을 인증 성공으로 표시하지 않으며, 미검증 호스트에
실계정 토큰을 보내지 않고, private/loopback IP로 리다이렉트된 TLS 접속을 거부.
