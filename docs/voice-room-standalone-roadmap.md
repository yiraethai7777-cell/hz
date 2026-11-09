# NEXI | Railway 단독 보이스룸 참가 개발 계획

마지막 갱신: 2026-11-09. 범위: **기존 KakaoForge Railway 로그인 유지 + 오픈채팅 보룸 참가 + 진행자 승격 + 세션 유지**.
**현재 이 목표는 미완료이며 실제 참가 테스트에 성공하지 못했습니다.** 이 문서는 검증 가능한 개발 기준을 정의합니다.

## 완료된 구성 요소

| 단계 | 실제 구현 | 확인 기준 | 상태 |
|---|---|---|---|
| A. 보이스룸 초대 탐지 | `shared/voice-room-join-info.js` | type 52 vr_invite의 callId, csIP, csIP6, csPort 수신, 종료/만료 정리 | 통과 (모의 이벤트) |
| B. VOX 패킷 프레임·SEED 암복호화 | `shared/voice-room-vox-wire.js` | 길이 제한, 12B 헤더, LE method, MD5 키, SEED-CBC, BSON 길이 검사, 스트림 분할/병합 | 통과 (오프라인 벡터) |
| C. 인증된 VOX LOGIN | 없음 | 현재 카카오톡 버전에서 확인한 LOGIN BSON 스키마와 VOX 인증 응답 | **미확보** |
| D. 실제 참가 확정 | 없음 | 로그인 응답 + 실제 보룸 참가자 명단 확인 | **미확보** |
| E. WebRTC 리스너·진행자 | 없음 | 리스너 수신 후 실제 진행자 승격·권한 전환 확인 | **미확보** |
| F. 유지·퇴장 | 없음 | 30초 PING 및 실제 오디오 세션 생존, 48시간 한계 검증 | **미확보** |

## 검토한 공개 자료 및 신뢰도

1. [itznullbyte / KakaoTalk VoiceRoom Analysis (2025-10-07, Android 25.8.3)](https://github.com/itznullbyte/itznullbyte.github.io/blob/d0fe05d60315ca450cc84595f9ce2593d3266611/src/content/posts/vox_room/index.md)
   - VOX 30 네이티브 JoinVoiceRoomCall → TLS 제어 연결 → SEED-CBC BSON 프레임 → LOGIN 11002 → WebRTC 리스너 → CLIENT_OFFER 12023 → 스피커 → PING 11015 / 30초라는 흐름을 기술합니다.
   - **csPort와 별개로 제어 통신 포트 5228**을 사용한다고 명시합니다. NEXI 초대에서 얻은 `csPort`를 VOX TLS 포트로 단정하면 안 됩니다.
   - LOGIN 본문에 들어갈 정확한 키/값, 현재 서버 인증 요구사항 및 응답 예시는 공개되어 있지 않습니다.
   - 2025년 분석이므로 현재 2026년 Android 26.x 또는 Windows 26.x와 완전 일치하는지 검증 전입니다.
2. [storycraft / KakaoTalk voip control protocol (2020년경)](https://gist.github.com/storycraft/ffdd727dbd45d9ae047a3ee93a83839f)
   - 12바이트 헤더 (4바이트 nonce + 2바이트 0 + 2바이트 명령 + 4바이트 데이터 길이), 키 MD5(헤더 첫 8바이트), SEED-CBC 고정 IV를 기술합니다.
   - **구형 출처입니다.** 2025년 문서의 '6바이트 nonce' 설명과 일부 차이가 있어 실제 current frame과 비교 검증이 필요합니다.
   - `shared/voice-room-vox-wire.js`는 이 규격을 **오프라인 실험용**으로만 구현했습니다. 카카오 서버에는 어떤 패킷도 보내지 않습니다.
3. [Noa Android VOX](https://github.com/entworacy/noa/blob/9a20fdc47d55d99832b2f55cdf5a17aca32a83d5/kakao-agent/java/dev/noa/kakao/VoxController.java)
   - 자체 VOX 로그인 구현이 아니라 Android KakaoTalk 내부 `getVoiceroomManager().joinVoiceroom(...)`을 호출합니다. Railway 서버 단독 구현을 해결하지 않습니다.
4. [카카오 공식 보이스룸 설명](https://www.kakaocorp.com/page/service/service/voiceroom)
   - 보이스룸은 진행자가 하나뿐일 때 그 진행자가 나가거나 생성 후 48시간이 지나면 종료합니다. 무한 연장은 공식 지원 기능이 아닙니다.

## 후속 구현을 위한 구체적 검증 단계

- **C1**: 동일한 카카오톡 버전에서 본인 계정의 VOX LOGIN 요청 및 응답의 *필드 이름·자료형·성공 조건*을 확보하고 개인 세션 토큰을 제거한 재현용 fixture를 작성합니다. 공개 문서에 없는 필드는 추측하지 않습니다.
- **C2**: SSL/TLS 검증을 유지하고, 이미 신뢰 확인된 제어 서버로만 연결합니다. LOCO 계정의 QR/인증 파일을 복제·출력·재로그인하지 않습니다. 현재 `csIP`는 채팅 첨부의 값이므로 SSRF를 막기 위해 직접 임의 연결하지 않습니다.
- **D1**: LOGIN 실제 응답을 파싱해 서버 승인과 로컬 시도/실패를 구분합니다. 서버가 승인해도 사용자 리스트 확인까지 완료라고 하지 않습니다.
- **E1**: 로그인 뒤 listen-only WebRTC 초기 협상에 필요한 SDP/ICE 인증 데이터를 확보하여, 리스너로 참가한 사실을 검증합니다.
- **E2**: 실제 앱에서 진행자 위임 절차를 확인합니다. 진행자 지정이 사용자 권한에 의해 거부되면 자동 승격했다고 주장하지 않습니다.
- **F1**: 연결 종료 감지, 유효한 세션에서의 PING 간격, 복구 정책을 테스트합니다. 리스타트/중복 로그인으로 Railway 채팅 기능이 끊어지면 롤백합니다.

## 배포 원칙

- 기존 `#보룸참가` 명령어 **상시 인식** 규칙은 유지합니다. 기능을 비활성화하지 않습니다.
- 이번 연구 모듈은 NEXI 런타임에서 자동 로딩하거나 외부 서버로 접속하지 않습니다.
- `NODE_OPTIONS=--openssl-legacy-provider`를 기존 Railway 봇에 적용하지 않습니다. 테스트 시에만 `node --openssl-legacy-provider`를 독립 프로세스로 실행합니다. SEED-CBC는 OpenSSL 3 legacy provider에 있습니다.
- 실제 VOX 참가 성공 및 진행자 역할이 검증되지 않았으므로 **보룸 참가 기능 완성이라고 표기하지 않습니다**.
- 서비스 약관 및 계정 이용 제한 위험이 있으므로 카카오톡의 비공식 프로토콜 실험은 본인 소유 계정과 통제된 테스트 방에서만 실시합니다.

## 실행 가능한 테스트

```bash
node --openssl-legacy-provider --test test/voice-room-vox-wire.test.js
```

이 테스트는 프레임 인코딩과 암복호화만 검사하고 실제 카카오톡 보이스룸 참가를 수행하지 않습니다.
