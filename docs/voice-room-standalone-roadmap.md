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


## 2026-11-09 추가 확인: VOX 전송 계층과 진행자 권한 검증

[카카오톡 Android의 VoiceroomCoreManager 역분석 코드](https://github.com/theman001/KakaoWebTalk/blob/f3e1d5bc0f85c910873e8d95071c4a732cc736b4/app/kakaotalk_apk_jadxExport/app/src/main/java/p3093zR/C75899c.java)에서 다음 네이티브 SDK 호출을 확인했습니다.

- `joinVoiceRoomCall(networkHost, networkPort, chatId, userId, callId, new VoxType.VCallMediaType(1), new VoxType.VServiceType(11), openChatUserType, true)` 형태. 네트워크 호스트와 포트는 Android 내부 선택 함수가 결정하므로 `vr_invite.csPort`를 무조건 TLS 포트로 사용하면 안 됩니다.
- `Vox30Manager.queryVoiceRoomMemberList(host, port, userId, chatId, callId, callback)`는 응답 코드 0일 때 **moderatorUserIdList**, **speakerUserIdList**, **listenerUserIdList**를 반환합니다.
- 기존 진행자의 `vRCInviteAsModerator(targetUserId)` 초대 호출과 초대받은 측의 `vRCAcceptModeratorInvitation()` 수락 호출이 모두 있습니다. 그러나 이는 Android VOX 엔진에 대한 메서드이며, 독립 Railway의 VOX 명령 번호와 BSON 요청 구조는 아닙니다.

**추가된 개발 코드**

- `shared/voice-room-vox-transport.js`: Node.js `tls.connect`를 이용하는 독립 VOX 프레임 전송 계층. 외부 `vr_invite`의 IP를 임의 접속지로 사용하지 않으며, 사전 확인된 IP 허용목록 및 TLS DNS 인증서 검증이 필수입니다. TLS 1.2 미만으로 보안 검증을 끄고 접속하는 방식은 허용하지 않습니다. 현재 서비스 포트 5228은 제3자 2025년 분석의 **참고값**일 뿐 최신 서버에서 검증되지 않았습니다.
- `shared/voice-room-vox-membership.js`: VOX 참가자 명단의 진행자·스피커·청취자 역할을 정확한 Int64 ID로 구분하는 **순수 파서**. 응답 코드가 실패했거나 중복 역할·잘못된 ID를 반환하면 반드시 `unknown`으로 처리합니다. 파서 실행만으로 실제 서버 응답을 신뢰했다는 의미는 아닙니다.
- `test/voice-room-vox-transport.test.js`, `test/voice-room-vox-membership.test.js`: 모의 TLS 소켓·멤버십 응답을 이용해 검증합니다. 기존 Railway 런타임과 사용자 카카오톡 인증정보는 사용하지 않습니다.

**남은 핵심 검증: 현행 VOX LOGIN(11002)의 BSON 필드명·인증 방식·서버 성공 응답과 현재 TLS 인증서의 실제 서버 이름이 공개되어 있지 않습니다.** 승인된 실제 통화 세션을 유지하는 코드도 아직 없습니다. 이 정보가 확인되기 전에는 운영 NEXI에서 임의 로그인 패킷을 전송하지 않고, 아직 미완성인 `#보룸참가`를 실제 성공한 것으로 표시하지 않습니다.

### 개발 진행의 명확한 성공 조건

1. 실제 2026년 VOX 패킷과 로컬 코덱의 바이트 단위 동등성 검증
2. 로그인 요청의 필수 인자와 인증 증명 확보 및 **실제 VOX 승인 응답 확인**
3. 인증된 세션에서 실제 참가자 목록에 봇의 64비트 ID 등장
4. 사용자가 진행자로 초대한 뒤, 봇이 초대를 수락하고 역할 목록에 moderator로 표시되는지 확인
5. 기존 Railway 채팅 연결이 유지되는지, 중복 로그인을 초래하지 않는지 확인

검증이 끝나지 않은 실제 네트워크 접속을 무리하게 자동 실행하는 것은 기존 채팅 봇의 세션을 망가뜨릴 수 있으므로, 전송 모듈은 현재 NEXI 본 프로세스에서 로드하지 않습니다.

## 2026-11-13: 확인된 Android 원본 함수와 Railway 미구현 경계

[VoiceroomCoreManager 디컴파일 코드](https://github.com/theman001/KakaoWebTalk/blob/f3e1d5bc0f85c910873e8d95071c4a732cc736b4/app/kakaotalk_apk_jadxExport/app/src/main/java/p3093zR/C75899c.java) 기준으로 다음 Java-to-native API 호출이 실제 확인되었습니다.

- **참가**: `joinVoiceroom(chatId, callId, vcsHostV4, vcsHostV6, vcsPort,...)`가 Android 내부 `joinVoiceRoomCall(networkHost, netType, chatId, userId, callId, VCallMediaType(1), VServiceType(11), openChatUserType, true)`를 호출 (약 442, 1647행).
- **스피커 초대 수락**: `requestSpeakerInvitationAccept()`가 `IVoxCall.vRCAcceptSpeakerInvitation(currentUserId, true)` 실행 (약 1249, 2402행).
- **진행자 초대 수락**: `requestModeratorInvitationAccept()`가 `IVoxCall.vRCAcceptModeratorInvitation()` 실행 (약 2314행).
- **수락 결과**: `onVRCAcceptSpeakerInvitationResult`, `onVRCAcceptModeratorInvitationResult` 콜백이 응답 코드를 수신 (약 1873–1886행).
- **역할 검증**: `onVRCRecvMemberList`가 moderator/speaker/listener 목록을 보고 (약 1489행).

주의: 위 메서드는 **Android 앱 내부 네이티브 VOX 엔진의 Java API**이며 Railway Node.js에서 호출할 수 있는 네트워크 요청 또는 BSON 직렬화 스키마가 아닙니다. GitHub에 공개된 [VOX 분석 문서](https://github.com/itznullbyte/itznullbyte.github.io/blob/d0fe05d60315ca450cc84595f9ce2593d3266611/src/content/posts/vox_room/index.md)는 JOIN = 11002 LOGIN, 스피커 연결 = 12023 CLIENT_OFFER까지 밝히지만 **두 BSON 본문과 서버 역할 수락 명령을 설명하지 않습니다**.

기존 `shared/vox30-participation.js`는 검증된 드라이버가 들어오기 전까지 송신하지 않습니다. 기능을 실제 작동시키려면 사용자 본인 계정의 정상 참가·스피커 초대 수락·진행자 초대 수락 시 VOX 엔진이 TLS 내부에 넣는 **각 요청의 명령 번호, 민감정보 제거한 BSON 필드명·자료형, 서버 성공 응답 및 역할 명단 변화**가 필요합니다. 그 데이터를 확보하지 않고 생성 명령 `11028` 또는 추측한 패킷을 재사용하지 않습니다.

