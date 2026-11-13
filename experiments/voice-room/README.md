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
- 별도 Android 후킹 에이전트가 실사용자 확인 및 권한 검사를 거쳐 보룸 참가를 수행하도록 개발합니다. NEXI는 별도 Android/Noa 브리지 대신 Railway 단독 VOX 구현을 사용합니다.
- 진행자 초대 수락을 자동화하려면 초대 수신 상태와 vRCAcceptModeratorInvitation()의 실제 계약을 검증한 뒤, 서버 참가자 역할이 moderator가 되었는지 별도 확인해야 합니다.
- **동일 계정 Android 추가 로그인은 Railway 기존 세션과 충돌할 수 있습니다.** 본 실험은 테스트 계정으로만 진행합니다.

## 오프라인 확인

~~~bash
node --check experiments/voice-room/frida-vox-observe.js
node --test test/voice-room-frida-observe.test.js
~~~

참고: 공식 Frida JS API https://frida.re/docs/javascript-api/


## 보룸 종료 패킷 확인용 읽기 전용 후킹 (2026-11-14)

- 파일: \`experiments/voice-room/frida-vox-hangup-metadata.js\`
- 사용 목적: **테스트용 카카오톡 계정**에서 정상적으로 보룸 퇴장했을 때 \`VoxCall30Impl.hangUp()\` 호출과, 지원되는 동적 TLS \`SSL_write\`에 전달된 VOX **메서드 번호**만 관찰
- 출력 정보: \`hangup_called\`, \`outgoing_vox_method\`의 숫자 \`method\`와 길이만. **원본 패킷/BSON/토큰/ID/SDP/주소/음성은 절대 출력하지 않습니다.**
- 설치 방법: 기존 Frida 관찰 실험과 같은 방식으로 별도 시험 계정이 로그인된 LDPlayer에서 실행합니다.

~~~bash
frida-ps -Ua
frida -U -n com.kakao.talk -l experiments/voice-room/frida-vox-hangup-metadata.js
~~~

- 메서드가 설치되면 **앱에서 직접 종료 버튼을 눌러** \`hangup_called\` 뒤 최대 3초 동안의 \`outgoing_vox_method\`를 비교합니다. 이 스크립트는 스스로 종료 요청을 실행하지 않습니다.
- \`tlsHooks:0\` 또는 \`tls_hook_unavailable\`이면 대상 버전은 SSL 함수가 정적 링크/숨김 처리되었을 수 있어, **메서드 번호를 아직 확인할 수 없습니다**. 미확인 패킷을 추측해 전송하지 마세요.
- method ID만으로는 부족합니다. 실제 VOX3.0 서버 종료 패킷의 **BSON 필드 이름·형식·서버 응답**까지 독립적으로 검증해야 합니다.
- 테스트 계정으로만 사용하세요. 현재 Railway와 같은 카카오톡 계정으로 Android 로그인하면 서버 세션이 충돌할 수 있습니다.
- 로컬 검사: \`node --check experiments/voice-room/frida-vox-hangup-metadata.js\`; \`node --test test/vox30-hangup-observe.test.js\`.
