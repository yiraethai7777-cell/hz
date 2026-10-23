# 보이스룸 명령어와 통신 연동 설명

## 현재 지원 상태

- #보룸상태 / #보이스룸상태 : 연동 여부와 봇 권한 확인
- #보룸켜기 [제목] / #보이스룸켜기 [제목] : 실제 개설 어댑터를 호출하는 명령어

2026-10-24 기준 저장소의 KakaoForge는 실제 보이스룸 생성 API를 구현하지 않았습니다.
미연동 상태에서는 생성 요청을 전송하지 않고 안내 메시지를 보냅니다.

## 프로토콜 확인

- 일반 LOCO 패킷의 명령어 필드는 11바이트여서 CREATE_VOICEROOM은 검증된 LOCO 명령어가 아닙니다.
- storycraft의 오래된 VOIP 제어 자료에는 0x272c (create live talk)가 언급되나, 현재 보이스룸의 프로토콜 또는 본문과 같은지는 미확인입니다.
- 검증되지 않은 LOCO/VOIP 요청을 봇에 직접 보내지 않습니다.

출처:
https://openkakao.vercel.app/docs/protocol/overview
https://gist.github.com/storycraft/ffdd727dbd45d9ae047a3ee93a83839f
https://www.kakaocorp.com/page/service/service/voiceroom

## 실제 생성 어댑터 규격

외부에서 실제 동작이 검증된 프로토콜이 확보되면 KakaoForge client 인스턴스에 아래 형태로 연결합니다.

    client.voiceRoomAdapter = {
      async create({roomId, title, openLinkId}) {
        // 검증된 실제 서버 생성 API가 필요한 자리
        throw Error('보이스룸 서버 생성 API 미구현');
      },
      async status({roomId}) {
        // 서버에서 활동 중인 방을 검증한 경우에만 active:true, verified:true
        return {active:false, verified:false};
      }
    };

성공 메시지는 create()가 {created:true,verified:true,status:0}을 반환하거나
status()가 같은 채팅방의 {active:true,verified:true,roomId}을 반환할 때만 보냅니다.
서버에서 실제 개설되지 않았다면 verified:true를 반환하지 마세요.

## 권한 및 안정성

- 실행자: 오픈채팅 방장(1) / 부방장(4)만 허용
- 봇 계정: 같은 방에서 방장(1) / 부방장(4) 권한을 확인한 경우에만 호출
- 미확인 봇 권한은 실패로 처리; 인원 목록 요청을 능동 실행하지 않음
- 방별 동시 개설 요청 중복 차단
- 제목 40자 이내

## 검증

실행: node --test test/voice-room.test.js
모의 테스트는 실제 카카오톡 VoiceRoom 서버에 대한 검증이 아닙니다.

보이스룸을 수동 생성하려면 카카오톡 오픈채팅방 왼쪽 아래 + 메뉴에서 보이스룸을 선택하세요.
