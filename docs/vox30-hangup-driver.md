# VOX 3.0 종료 요청 드라이버 (개발 단계)

코드: `shared/vox30-hangup-driver.js`

기존 `!보룸시작` 생성 경로를 변경하지 않습니다.
서버의 VOX3 종료 요청 메서드와 BSON 필드가 검증되지 않았으므로 **기본 비활성**이며 어떤 종료 패킷도 생성하지 않습니다.

## 사용 조건

1. 별도 Android 테스트 계정에서 실제 `VoxCall30Impl.hangUp()` 실행 시 전송된 VOX3 요청 번호와 응답 번호를 확인합니다.
2. 개인정보와 인증 토큰을 제외하고 실제 종료 BSON의 **필드 이름/타입/필수 조건**을 검증합니다.
3. 확인한 앱 버전과 일치하는 `contract` 및 검증된 `buildBody` 함수를 코드 리뷰 후 공급합니다.
4. `createHangupDriver`의 결과를 기존 `installDirectVoice(client,{hangupTransport})`에 주입합니다. 환경변수만으로 미확인 메서드를 활성화할 수 없습니다.
5. 통화별 종료 이벤트 `vr_bye`로 실제 종료를 별도 확인하고, 종료 전 다른 방의 세션은 유지해야 합니다.

`contract` 필드: `reviewed:true`, `recordedHangUp:true`, `appVer`, `requestMethod`, `replyMethod`.
`buildBody({roomId,callId,csId,actorUserId})`는 검증된 BSON 문서만 반환해야 합니다.
`request()`의 성공은 **종료 요청 서버 수락**만 의미하며 보이스룸 종료 확정이 아닙니다.

현재 시험 코드의 `12001`과 `12002`는 **테스트 전용 가상 메서드**이며 운영 코드에 사용해서는 안 됩니다.

검사: `node --test test/vox30-hangup-driver.test.js`.
