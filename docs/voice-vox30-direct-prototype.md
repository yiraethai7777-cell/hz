# VOX 3.0 보이스룸 생성 실험 — SEED-CBC / WebRTC 구현

사용자가 제공한 비공식 VOX 코드에 근거한 **비운영 실험**입니다. 카카오톡 실서버 동작은 검증되지 않았습니다. 기존 Noa 자동 개설과 Railway 로그인은 건드리지 않습니다.

## 구현 완료 및 검증

| 파일 | 역할 |
|---|---|
| `shared/vox30-protocol.js` | 12B 헤더, BSON, PKCS7, SEED-CBC, TLS 검증, VOX 메서드 디스패치 |
| `shared/vox30-adapter.js` | 명령어 컨트롤러 어댑터 계약, 인증/멤버십/WebRTC 주입, 중복 세션 방지 |
| `experiments/vox30/seed.js` | `kisa-seed@1.1.0`을 이용한 바이너리 SEED-CBC 구현 및 PKCS7 계약 조정 |
| `experiments/vox30/webrtc.js` | `werift@0.26.0` WebRTC audio Offer/Answer, ICE 후보 수집, 연결 객체 유지 |
| `experiments/vox30/lab.js` | 암호화 + WebRTC + VOX 통신부 조립, 자동 실행하지 않음 |
| `test/vox30-protocol.test.js` | TLS 수신 분할·VOX 진입/생성/거부 테스트 |
| `test/vox30-lab.test.js` | RFC 4269 SEED 벡터·BSON 바이너리·WebRTC 실제 오디오 SDP 테스트 |

### 중요한 프로토콜 수정

전달받은 설명에 따르면 **11028은 보이스룸 생성 명령**이고, **11003/11007은 생성/거절 이벤트**입니다. 별도의 11028 응답이 오지 않아도 중단되지 않게 `11028`을 전송한 뒤 `11003/11007`만 기다리도록 수정했습니다. 메서드 값과 패킷 규격의 실서버 호환성은 여전히 미확인입니다.

### 실행 방법 (로컬 시험 전용)

```sh
npm ci --ignore-scripts
npm install --prefix experiments/vox30 --ignore-scripts --no-audit --no-fund
node --test test/voice-room-direct-protocol.test.js test/vox30-protocol.test.js test/vox30-lab.test.js
```

실험용 의존성은 저장소 루트의 `package.json`에 추가하지 않습니다. SEED-CBC 구현에도 `--openssl-legacy-provider`나 TLS 인증서 검증 끄기가 필요하지 않습니다.

## 남아 있는 구현·검증 사항

1. **지원되는 인증 방법:** `oauthToken`, `duuid`를 해당 VOX 프로토콜에서 정당하게 발급받는 방법은 구현되지 않았습니다. Railway `auth.json`을 재사용한다고 추정하지 않습니다.
2. **채팅방 참여 확인:** 독립된 실행 계정이 OM 채팅방 구성원인지 검증할 수 있는 클라이언트 공급자는 아직 없습니다.
3. **실제 WebRTC 음성 전송:** 오디오 SDP Offer/Answer와 ICE 수집은 구현했지만 현재는 **수신 전용 오디오 트랜시버**입니다. 실제 음성 송신이나 진행자 세션 유지, ICE/DTLS 연결 성공은 검증되지 않았습니다.
4. **11015 PING:** 사용자가 받은 코드 주석에만 있으며, 요청 본문 구조·전송 주기 등은 확인되지 않았습니다. 임의의 서버 PING을 전송하지 않습니다.
5. **VOX 실서버 검증:** `30000/11028/11003/11007` 메서드, 서버 주소, IV, BSON 스키마는 사용자 제공 예시이며 실제 성공 여부는 미확인입니다.
6. **실제 서버 개설 확인과 종료:** 서버에서 보이스룸 활성 여부를 독립적으로 확인할 방법 및 `#보룸종료` 서버 측 종료 프로토콜은 없습니다. 어댑터의 `dispose()`는 **로컬 연결만 해제**합니다.
7. **동시 다중 채팅방:** 단일 인증 계정의 다중 진행자 세션 지원 여부를 검증하지 않았습니다.

### 연동 시 고려

`experiments/vox30/lab.js`의 `createLabAdapter`는 `credentialsForRoom`과 `verifyMembership` 함수를 **외부에서 명시적으로 제공**해야 합니다. 해당 함수가 없으면 VOX 요청을 시작하지 않습니다. 현재 Railway 운영 서비스는 실험 모듈을 전혀 로드하지 않으므로 계속 Noa 경로로 동작합니다.

**보안:** 세션 토큰·기기 식별자·실제 SDP(주소/ICE 인증 포함)를 코드, GitHub, 로그, 채팅에 기록하지 마세요. 개발 중 SSL 인증을 비활성화하지 마세요.
