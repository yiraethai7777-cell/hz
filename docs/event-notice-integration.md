# APEX 이벤트 실제 공지 등록 연동

## 현재 상태

`#이벤공지등록 [내용]` / `#이벤공지상태` 명령어가 추가되었습니다.

**중요:** 현재 KakaoForge에는 실제 오픈채팅 공지(포스트) 등록 API가 구현되어 있지 않습니다. 따라서 명령어가 존재해도 실제 등록 기능은 활성화되지 않습니다. 일반 채팅 전송을 공지 등록 성공이라고 알리지 않습니다.

기존 `#이벤공지작성 내용`은 PostgreSQL에 내용을 저장하고, `#이벤공지`는 해당 내용을 일반 메시지로 보냅니다. 이 메시지를 카카오톡에서 길게 눌러 직접 공지로 등록할 수 있습니다.

## 실제 연동을 위해 필요한 인터페이스

외부에서 동작 검증된 공지 등록 프로토콜/포스트 API가 확보되면 다음 인터페이스를 구현합니다.

```js
client.roomNoticeAdapter = {
  async register({roomId, text}) {
    // 실제 서버 공지 포스트 생성 및 상단 공지 등록 수행.
    // 완료가 확인된 경우에만 {registered: true} 반환.
    throw new Error('실제 공지 등록 API 미구현');
  }
};
```

메시지 전송 후 공지 등록을 지원하는 백엔드가 검증된다면 `shared/event-notice.js`의 `createMessageNoticeAdapter`를 사용합니다.

```js
const {createMessageNoticeAdapter} = require('./shared/event-notice');

client.roomNoticeAdapter = createMessageNoticeAdapter({
  sendText: (roomId,text) => client.chat.sendText(roomId,text),
  // 검증된 공지 API를 확보한 경우에만 연결합니다.
  setNotice: async ({roomId,logId}) => {
    // 서버에서 실제 등록 완료를 확인한 경우에만
    // {registered: true, status: 0, postId: '...'} 반환.
    throw new Error('아직 실제 공지 등록 API가 없습니다.');
  }
});
```

KakaoForge의 `CarriageClient.write()` 성공 응답에서 메시지 ID는 `res.body.logId`입니다. 예시 코드의 `res.result.logId`는 이 빌드의 반환 구조와 맞지 않습니다. ID는 정밀도 손실이 없도록 문자열로 유지합니다.

어떤 LOCO 명령어를 사용해야 하는지는 아직 검증되지 않았습니다. `NOTIREAD`는 읽음 처리이며 공지 등록 메서드가 아닙니다. 임의 패킷명·본문을 만들어 보내지 않습니다.

## 접근 권한 및 점검

- 카카오톡 방장 또는 부방장만 명령어 실행 가능
- 연동 미구현 시 공지 게시를 시도하지 않고 안내
- 실제 등록 성공으로 확인된 결과에만 성공 메시지 전송
- 방별 동시 중복 등록 방지
- 테스트: `node --test test/event-notice.test.js` (실제 서버 통신 테스트는 아님)

사용 예시:

```text
#이벤공지작성 이벤트 참여 안내입니다.
#이벤공지상태
#이벤공지등록
#이벤공지등록 당일 이벤트 특별 공지
```
