# APEX 실제 카카오톡 공지 등록 (실험 연동)

## 구현과 확인 범위

- `#이벤공지등록`을 실행하면 과거 node-kakao의 공개된 **오픈채팅 게시판 API**를 순서대로 호출합니다.
- **POST** `https://open.kakao.com/moim/chats/{chatId}/posts?link_id={linkId}` — 텍스트 포스트 생성
- **POST** `https://open.kakao.com/moim/posts/{postId}/set_notice?link_id={linkId}` — 상단 공지로 등록
- **GET** `https://open.kakao.com/moim/posts/{postId}?link_id={linkId}` — `notice: true` 검증

출처: [node-kakao v3.1.8 OpenChannelBoardClient](https://github.com/storycraft/node-kakao/blob/v3.1.8/src/api/channel-board-client.ts)

**현재 KakaoTalk(2026)의 이 과거 API 지원 여부는 아직 검증되지 않았습니다.**
코드는 과거 공개 구현을 기반으로 작성되었고 실제 계정 로그인, 권한, URL 변경 등에 따라 HTTP 401/403/404 또는 카카오 오류 코드로 실패할 수 있습니다. 테스트 성공을 실제 서비스 성공으로 혼동하지 마세요.

## 사용법

```text
#이벤공지작성 오늘 이벤트 안내
#이벤공지상태
#이벤공지등록
#이벤공지등록 지금 시작하는 공지 내용
```

- 채팅방 방장/부방장만 명령어를 사용할 수 있습니다.
- 봇 **본인 계정도** 해당 오픈채팅방에서 공지 등록 권한이 필요합니다.
- 성공은 게시판 포스트가 `notice: true`로 다시 조회될 때만 표시됩니다.
- 포스트 생성은 되었지만 이후 단계에서 오류가 발생하면 게시판에 등록되지 않은 포스트가 남을 수 있습니다.
- 반환된 포스트 ID와 연결 오류 메시지를 바탕으로 원인을 구분해 주세요.
- 개인정보 및 로그인 토큰은 디버그 메시지로 출력하지 않습니다.

## 설정과 권한

- 별도 API 키 입력 없이 이미 로그인한 KakaoForge의 `oauthToken`, `deviceUuid`를 사용합니다.
- 서버 기본은 위 **실험 API 호출 가능** 상태입니다. 자동으로 호출하는 것은 아니며, 방장이 `#이벤공지등록`을 보낼 때만 호출합니다.
- 실험 API를 끄려면 Railway 환경 변수 `HZ_EVENT_NOTICE_API=off`를 설정합니다.
- 역사적 API의 `Authorization` 헤더는 `{oauthToken}-{deviceUuid}`입니다.
- 최신 KakaoForge Bubble API처럼 해시 처리된 Device ID 헤더가 필요한 서버라면 `HZ_NOTICE_USE_DEVICE_ID=1`을 별도로 설정해 인증 형식을 전환할 수 있습니다. 무작정 두 형식으로 반복 시도하지 않습니다.
- 프로토콜 요청은 오직 `open.kakao.com`의 명시된 경로에 한정되며 HTTP 응답 크기·시간을 제한합니다.
- 보안상 실제 API 계정에서 먼저 `#이벤공지등록 시험 공지`를 테스트하고, 게시판에 올라갔는지 직접 확인하세요.

## 실패 시 조치

| 오류 | 의미 |
| --- | --- |
| `HTTP 401` / `status: -950` | 인증 형식 또는 로그인 세션 불일치 |
| `HTTP 403` / `status: -4031` | 권한 부족 또는 접근 거부 |
| `HTTP 404` | 구버전 API 경로가 변경되었거나 지원되지 않음 |
| `포스트 ... 생성되었을 수 있습니다` | 포스트 생성 후 상단 등록 단계에서 실패 가능성 |
| `등록 여부를 검증하지 못했습니다` | 서버 응답만으로는 실제 공지 확인 불가 |

현재 등록이 실패한다면 `#이벤공지`로 일반 채팅으로 보낸 뒤 카카오톡에서 메시지를 길게 눌러 수동 공지로 등록할 수 있습니다.

## 테스트

```bash
node --test test/event-notice.test.js test/event-board-api.test.js
```

이는 테스트용 API 응답을 넣은 **모의 테스트**입니다. 실제 카카오톡 실서비스에 대한 검증은 별개입니다.
