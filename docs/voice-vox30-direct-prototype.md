# VOX 3.0 직접 보이스룸 생성 실험 (2026-11-11)

이 코드는 사용자가 전달받은 출처 미확인 VOX 구현 예시를 바탕으로 **비운영 실험용**으로 작성되었습니다. 실제 카카오톡 서버 호환성은 확인되지 않았습니다.

## 구현한 것

- `shared/vox30-protocol.js`
  - 12바이트 헤더(랜덤 4B, 상태 2B, method 2B, 암호문 길이 4B)
  - BSON 직렬화/역직렬화(`bson` 패키지의 Int32/Long)
  - `MD5(header[0..8])`에서 128비트 SEED-CBC 키 도출; 16B IV
  - 엄격한 PKCS7 패딩 검사, 프레임 크기 제한, TCP 분할 수신 버퍼
  - 인증서 검증을 켠 TLS 연결 및 요청/이벤트 응답 대기 타임아웃
  - `30000` 진입 서버 조회, `11028` 생성 요청, `11003` 생성 이벤트 또는 `11007` 거부 이벤트 처리
  - 호출 서버 접속정보 반환, 원격 WebRTC SDP 전달
- `shared/vox30-adapter.js`
  - 명령어 컨트롤러에서 사용할 수 있는 `create`/`status` 메서드 구현
  - 별도로 인증된 계정의 방 참여 검증, 계정 자격정보 공급, **실제** WebRTC peer의 Offer/Answer를 필수 요구
  - 단일 음성 세션 잠금, 로컬 세션 해제; **서버 보이스룸 전체 종료 기능 아님**
- `test/vox30-protocol.test.js`: 실제 서버 요청 없이 인코딩·TLS·요청 순서/거부 테스트

## 실제 개설을 위해 미해결인 항목

1. VOX 패킷 규격 및 서버 주소의 실서버 호환성. `30000/11028/11003/11007`은 **제공받은 예시에서 온 값**이며 검증된 카카오 공식 API가 아닙니다.
2. `oauthToken`, `duuid`, 정확한 카카오톡 버전·모델·OS 정보 및 정상 인증 세션을 얻는 **지원되는 방식**. 기존 Railway `auth.json`의 세션을 이 프로토콜 자격정보로 간주하지 않습니다.
3. 실제 ICE/DTLS 연결이 되는 WebRTC peer 제공. `sdp` 문자열만 전달해도 VOX를 유지할 수 있다는 보장은 없습니다.
4. SEED-CBC의 검증된 구현. 기본 Node 24 OpenSSL 3에서는 SEED가 Legacy Provider로 분리돼 일반 실행 시 `crypto.getCiphers()`에 없을 수 있습니다. 프로세스 전역 보안 설정을 변경하지 않습니다. 실험용 별도 실행 환경에서 검증된 SEED 구현체를 `createCodec({seed})`로 주입할 수 있습니다.
5. 서버에서 실제 방 개설·종료 상태를 읽는 API. 로컬 `11003` 이벤트를 수신하더라도 `verified:true`로 **과장하지 않습니다**.
6. 보이스룸 `#보룸종료` 서버 종료 프로토콜은 제공받지 못했습니다. 여러 방 동시 진행자 유지도 미검증입니다.

## 연결 예시 (직접 전송 준비 이전 개발용 구조)

```js
const { createCodec } = require('./shared/vox30-protocol');
const { createVox30Adapter } = require('./shared/vox30-adapter');

// 검증된 SEED-CBC 객체: { encrypt(Buffer,key,iv), decrypt(Buffer,key,iv) }
// 검증된 WebRTC 구현: createOffer(), applyAnswer(remoteSdp), close()
// 인증된 계정과 채팅방 멤버십 조회를 제공하는 함수 필요
const codec = createCodec({ seed: checkedSeedImplementation });
const adapter = createVox30Adapter({
  actorUserId: accountUserId,
  cfg: { userId: accountUserId, carrierId, model, sdkVersion, buildId },
  entryHost, entryPort,
  codec,
  credentialsForRoom: async ({chatId}) => authenticatedCredentialsFor(chatId),
  verifyMembership: async ({chatId}) => authenticatedMemberCheck(chatId),
  rtcFactory: async ({chatId}) => createPeerForRoom(chatId),
});
// 필요한 의존성이 실서버 환경에서 검증된 이후에만 설정:
// client.voiceRoomAdapter = adapter;
```

계정 인증이 필요한 `oauthToken`/기기 UUID/SDP는 절대 GitHub나 로그에 올리지 마세요. 추측한 토큰 또는 SSL 검증 우회로 실서버를 시험하지 마세요.

## 운영 영향

기존 Noa 생성 경로, Railway 환경변수 및 `auth.json`을 **전혀 변경하지 않았으며**, 이 실험 모듈은 실행 시 자동 로드되지 않습니다. 실제 운영용 명령어는 기존 Noa 경로를 계속 사용합니다.
