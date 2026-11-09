# NEXI VOX Android Frida 후킹 관찰 실험

2026-11-09 기준: **모의 Frida 환경에서만 검증**. 실제 카카오톡 보룸 생성·참가·진행자 권한 획득에 성공했다는 의미가 아닙니다.

## 목표와 작동 방식

- Android 앱의 Java 함수 중 makeVoiceroom, joinVoiceroom, leaveVoiceroom, getCurrentVoiceroomInfo, queryVoiceRoomMemberList, vRCInviteAsModerator, vRCAcceptModeratorInvitation 호출을 후킹해 **함수 이름과 호출·반환 여부만** 기록합니다.
- 메시지 내용, 보룸 ID, 사용자 ID, 통화 ID, IP, 인증정보, 함수 인자값, 결과 객체, 음성 데이터는 수집하지 않습니다.
- 원래 함수에 원래 인자를 전달하고 원래 결과를 반환합니다. 후킹 스크립트 자체는 **보룸 참가·생성·진행자 초대 수락을 자동 실행하지 않습니다.**
- 기존 NEXI Railway 코드와 auth.json에는 손대지 않습니다. Android 앱이 있는 별도 테스트 환경에서만 실행합니다.

## 실행 (소유한 Android 테스트 기기 또는 에뮬레이터, 테스트 계정)

1. 공식 Frida Android 설치 안내에 따라 컴퓨터에 frida-tools를 설치하고 테스트 Android에서 호환 frida-server를 구동합니다: https://frida.re/docs/android/
2. 기기 연결이 되면 카카오톡을 실행합니다. 다음 명령으로 이미 실행 중인 카카오톡 앱에만 관찰 스크립트를 주입합니다.

~~~bash
frida-ps -Ua
frida -U -n com.kakao.talk -l experiments/voice-room/frida-vox-observe.js
~~~

앱의 실제 프로세스 이름이 다르면 frida-ps 목록의 이름으로 바꿉니다.

3. 콘솔에서 NEXI_FRIDA_VOX_PROBE / ready 및 installedMethodGroups를 확인합니다. 0이면 함수 이름 변경, 네이티브 구현 또는 클래스 로더 차이일 수 있습니다.
4. 테스트방에서 **직접** 보룸을 만들고 참가합니다. 실제 진행자가 테스트 계정을 진행자로 초대하고 앱에서 수락해 봅니다.
5. 콘솔의 enter / return 이벤트 이름을 비교합니다. return은 단지 Java 함수가 반환했다는 뜻이며, 카카오톡 서버가 참가나 진행자 권한을 승인했다는 뜻은 아닙니다.
6. 테스트 종료 후 Frida 연결을 종료합니다.

## 검증 완료 후 다음 개발

- 현행 Android 버전의 메서드·오버로드·콜백을 정확히 확인합니다.
- 별도 Android 후킹 에이전트가 실사용자 확인 및 권한 검사를 거쳐 보룸 참가를 수행하도록 개발합니다. NEXI에는 기존 shared/voice-room-noa-bridge.js가 준비되어 있지만 **별도 Noa 기기·인증 정보 없이 실제 호출을 할 수 없습니다.**
- 진행자 초대 수락을 자동화하려면 초대 수신 상태와 vRCAcceptModeratorInvitation()의 실제 계약을 검증한 뒤, 서버 참가자 역할이 moderator가 되었는지 별도 확인해야 합니다.
- **동일 계정 Android 추가 로그인은 Railway 기존 세션과 충돌할 수 있습니다.** 본 실험은 테스트 계정으로만 진행합니다.

## 오프라인 확인

~~~bash
node --check experiments/voice-room/frida-vox-observe.js
node --test test/voice-room-frida-observe.test.js
~~~

참고: 공식 Frida JS API https://frida.re/docs/javascript-api/ , Android Noa 소스 https://github.com/entworacy/noa/blob/main/kakao-agent/java/dev/noa/kakao/VoxController.java

## Android 후킹으로 실제 개설 요청하기 (다중 방)

이 부분은 **관찰용 Frida 스크립트가 아니라 실행 코드**입니다.

Noa의 Android 후킹 API `POST /api/vox/voice-rooms`는 카카오톡 앱 내부 `makeVoiceroom()`을 호출합니다. 준비된 Noa/Android를 NEXI의 HTTPS 브리지에 연결한 뒤 다음 CLI를 실행하면 방 ID마다 개설 요청을 **순차적으로 전송합니다**. 별도 검증용 플래그나 보룸 ON/OFF 스위치는 없습니다.

필요한 실행 환경: 별도 Android 또는 Redroid에서 Noa가 실행 중이어야 합니다. 해당 Android에는 **Railway NEXI와 같은 카카오톡 사용자 ID**의 계정이 로그인돼 있어야 하며, `RECORD_AUDIO` 권한과 VOX 후킹 준비가 필요합니다. 추가 로그인으로 인해 기존 Railway 세션이 끊길 가능성이 있으므로 먼저 테스트 계정으로 확인하세요.

Windows PowerShell 환경변수 예시 (실제 값은 GitHub에 올리지 마세요):

~~~powershell
$env:NEXI_VOICE_NOA_URL="https://본인-noa-게이트웨이"
$env:NEXI_VOICE_NOA_TOKEN="실제-비공개-인증-토큰"
$env:NEXI_BOT_USER_ID="NEXI-카카오-숫자-ID"
$env:NEXI_VOICE_TITLE="NEXI 보이스룸"
node experiments/voice-room/noa-multi-start.js 1234567890123456 2345678901234567
~~~

- 방 ID는 1~12개의 정확한 양수 64비트 문자열을 전달합니다. 요청은 1.2초 간격으로 순차적으로 전송됩니다.
- NEXI 사용자 ID와 Android Noa 로그인 사용자 ID가 다르면 **서버 개설 요청을 전송하지 않습니다**.
- 한 방에서 개설 요청이 실패해도 다음 방 요청을 계속합니다. 임의 자동 재시도·퇴장·로그인 변경은 하지 않습니다.
- `request_accepted`는 Android 후킹 함수 요청이 Noa에서 접수된 상태입니다. 실제 서버 개설, 보룸 유지, 진행자 권한, 여러 방의 **동시 활성화 성공**을 의미하지 않습니다.
- 하나의 Android 카카오톡 계정은 보통 하나의 로컬 VOX 세션 상태를 갖습니다. 후킹 호출만으로 여러 보룸이 동시에 유지된다고 보장할 수 없습니다.
- 기존 카카오톡 명령어 `#보룸시작 제목`은 Noa 설정이 연결되어 있으면 같은 생성 엔드포인트를 사용합니다. 이번 실험 브랜치에서는 생성 전에 봇 계정 일치 검사를 하도록 연결했습니다.
- Railway 운영 서비스의 `main` 브랜치와 `auth.json`은 변경하지 않습니다. PR 병합 및 라이브 배포 전까지는 실험 코드입니다.

관련 구현: `experiments/voice-room/noa-multi-start.js`, `shared/voice-room-noa-bridge.js`, `test/voice-room-noa-multi-start.test.js`.

검사:
~~~bash
node --check experiments/voice-room/noa-multi-start.js
node --test test/voice-room-noa-multi-start.test.js test/voice-room-noa-bridge.test.js
~~~
