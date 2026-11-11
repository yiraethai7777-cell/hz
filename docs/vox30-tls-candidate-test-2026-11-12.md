# VOX 3.0 접속 후보의 TLS 검증 기록 (2026-11-12)

## 조사 배경

- 기존 Railway 봇 KakaoForge 로그인: 정상
- 기존 오픈채팅방 캐시: 존재
- OAuth 후보: `shared/vox30-existing-auth.js`를 통해 **메모리에서만** 접근 가능
- 사용자 요청: Android/LDPlayer/Noa 미사용, Railway에서 직접 보이스룸 개설

KakaoTalk의 **LOCO 채팅 로그인 성공**이 별도 **VOX 음성 서버의 인증 성공**을 의미하지 않습니다.

## 공개 자료에서 확인한 것

오래된 KakaoTalk VOIP reverse engineering 문서는 VOX 패킷의 12B 헤더,
MD5(헤더 앞 8B), SEED-CBC와 고정 IV 및 discovery 메서드 `0x7530=30000`을 기록합니다.
또한 라이브톡 생성 메서드를 `0x272c=10028`로 표시합니다.
이것은 2020년 자료이며 현재 VOX 3.0의 `11028`과 일치하지 않습니다.
**어느 값이 현행 프로토콜인지 확인되기 전에는 조용히 치환하거나 생성 패킷을 보내지 않습니다.**

자료: https://gist.github.com/storycraft/ffdd727dbd45d9ae047a3ee93a83839f

카카오 공식 보이스룸 안내는 실제 사용자가 카카오톡 앱의 + 메뉴에서
보이스룸을 만드는 방법을 안내하며, 외부 VOX 서버 인증용 API 규격을 제공하지 않습니다.

안내: https://kakaocorp.onkakao.net/page/service/service/voiceroom

## 실제 시험 (GitHub Actions에서 검증, Railway 아님)

샘플 주소 `211.242.12.121`은 사용자 제공 예시에서 추출했으며,
**카카오 공식 VOX 엔드포인트로 검증되지 않았습니다.**

- 엄격한 TLS 검증: `rejectUnauthorized:true`, 최소 TLS 1.2
- 사용자 정보 없음: OAuth / 기기 UUID / 사용자 ID / 채팅방 ID / BSON / VOX 요청 전송하지 않음
- `211.242.12.121:9282`, SNI 미지정 → `certificate_name_mismatch`
- 서버가 전달한 인증서 DNS 목록 → `kakao.com`, `*.kakao.com`
- `211.242.12.121:9282`, SNI `kakao.com` → **`tls_verified`, TLS 1.3**
- 이 결과로 확인한 것은 **해당 IP에서 Kakao 인증서로 TLS 통신 가능**하다는 점뿐입니다.
  VOX 제어 서버·서버가 지원하는 메서드·OAuth 허용 범위는 미확인입니다.

`scripts/vox30-tls-probe.js`는 이 구별을 강제하여
`voxServerAuthenticated:false`, `voiceRoomCreated:false`만 반환합니다.

## 실제 보이스룸 생성 시험 이전에 필요한 확인

1. 현재 카카오톡 VOX 3.0의 **공식 또는 재현 가능한 실제 호출 서버 진입점**. 정상 KakaoTalk 앱이 연결하는 VOX 서버 주소/포트와 인증서 이름 매칭
2. 해당 VOX 서버가 기대하는 TLS 버전/SNI, 프로토콜 `30000` 응답 스키마/암호화
3. 현재 앱과 일치하는 `appVer` 및 `devInfo`의 출처. 사용자 기기 정보를 임의로 생성하지 않음
4. VOX 서버의 OAuth 승인 규격. LOCO 세션의 OAuth를 VOX에서 허용하는지 별도 검증
5. 인증 후 메서드 확인 (`11028` 대 역사적 `0x272c`); server-event 응답과 결과 검증
6. 실제 WebRTC DTLS/ICE 연결·세션 유지(주기/PING) 및 종료 규격

## 안전 원칙

- 확정되지 않은 서버에 실계정 OAuth를 전송하거나 `rejectUnauthorized:false` 사용하지 않음
- 봇의 `auth.json`, 인증 URL, WebRTC SDP, 쿠키 등을 코드/CI 로그에 기록하지 않음
- 현재 `#보룸시작`은 VOX 미연결을 정상적으로 안내하며, 이 실험 코드를 자동 실행하지 않음
- Noa/가상 Android 경로는 사용하지 않음
