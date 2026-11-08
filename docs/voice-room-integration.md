# NEXI 보이스룸 명령어 및 실제 서버 연동

## 명령어

- `#보룸시작 [제목]` / `#보룸켜기 [제목]` (`#보이스룸시작`, `#보이스룸켜기`): 생성 요청 (최대 40자)
- `#보룸상태` / `#보이스룸상태`: 실제 서버 상태 및 봇 권한 조회
- `#보룸종료` / `#보룸끄기` (`#보이스룸종료`, `#보이스룸끄기`): 실제 서버에서 개설 상태가 확인된 경우에만 종료 요청
- `#보룸명령어` / `#보이스룸명령어`: 기능 안내

기존 `!` 접두사 및 접두사 없는 명령어도 라우터에서 받아들입니다. 사진처럼 `#보룸시작.` 또는 `#보룸시작 .`도 인식하며 이 경우 기본 제목은 '보이스룸'입니다. 방별 접두사 정책과 전체 봇 ON/OFF가 우선합니다.

## 현재 개발 단계 (2026-11-08)

**중요:** 현재 저장소에는 카카오톡의 보이스룸을 실제 생성/종료하는 검증된 프로토콜 구현이 없습니다. `shared/voice-room.js`는 명령어 라우팅, 권한 검증, 상태 확인, 동시 요청 제어를 제공하는 컨트롤러입니다.

- 현재 상태에서 `#보룸켜기`는 실제 생성 요청을 보내지 않고 API 미연동을 안내합니다.
- `#보룸끄기`도 실제 종료 API와 상태 조회 API가 모두 연결되기 전에는 요청하지 않습니다.
- 임의의 LOCO 메서드, BSON 필드 또는 VOIP 암호화 값을 추정해 실제 카카오톡 서버로 송신하지 않습니다.
- Railway에서 별도 기기 없이 실제 보룸을 개설하려면 검증된 서버 측 생성·상태·종료 프로토콜 구현이 필요합니다.

공식 Kakao Developers REST API에는 카카오톡 오픈채팅 보이스룸 생성/종료 API가 없습니다.
구형 VOIP 메모의 `0x272c`(create live talk)는 현재 오픈채팅 보이스룸 기능과 동등한지 확인되지 않았고 일반 LOCO 메서드가 아닙니다.

참고:
- https://developers.kakao.com/docs/ko/rest-api/reference
- https://www.kakaocorp.com/page/service/service/voiceroom
- https://gist.github.com/storycraft/ffdd727dbd45d9ae047a3ee93a83839f
- https://openkakao.vercel.app/docs/protocol/overview

## 검증된 어댑터의 연결 계약

동작 검증이 끝난 서버 프로토콜 구현을 준비한 경우에만 런타임 `client.voiceRoomAdapter`에 연결합니다.

```js
client.voiceRoomAdapter = {
  async create({roomId, title, openLinkId}) {
    // 실제 생성 응답/상태 조회로 검증된 경우에만 반환
    return {created: true, verified: true, status: 0, voiceRoomId: 'SERVER_ID'};
  },
  async status({roomId}) {
    // 조회 결과가 해당 채팅방의 활성 상태임을 서버 응답으로 확인할 것
    return {active: true, verified: true, roomId, voiceRoomId: 'SERVER_ID'};
  },
  async stop({roomId, voiceRoomId}) {
    // 검증된 실제 종료 응답인 경우에만 반환
    return {closed: true, verified: true, status: 0, roomId};
  }
};
```

위 객체는 **메서드의 형식만 설명하는 예시**로, 실제 카카오톡 API를 구현하는 실행 코드는 아닙니다. 서버 검증 없이 `verified: true`를 반환하면 안 됩니다.

안전 조건:
1. 일반 실행자는 해당 오픈채팅방의 방장(1) 또는 부방장(4)이어야 합니다. 동일한 카카오 계정 ID로 확인된 봇 계정은 이 명령어 권한 검사를 통과합니다. 실제 서버 생성·종료 성공은 카카오톡 서버 권한/API 응답에 따릅니다.
2. 생성 요청은 `created: true, verified: true` 또는 서버 조회의 `active: true, verified: true`를 확인한 뒤에만 성공 안내
3. 종료 요청 직전에 해당 방의 활성 상태를 확인하고, 종료 응답 `closed: true, verified: true, roomId` 또는 상태 조회의 `active: false, verified: true, roomId`로 종료 검증
4. 생성·종료 요청은 동일 방에서 동시 실행 차단
5. 상태 불명, 응답 오류, 인증/권한 오류 시 추정 성공 메시지 금지

## 테스트

```bash
node --test test/voice-room.test.js test/voice-router.test.js
```

테스트는 **모의 어댑터 기준의 컨트롤러 동작 확인**이며 실제 카카오톡 보이스룸 서버의 생성 성공을 증명하지 않습니다.
