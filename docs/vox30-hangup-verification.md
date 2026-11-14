# VOX 정상 종료 검증

현재 VOX3 hangUp 종료 패킷의 메서드 번호, BSON 필드와 서버 응답 규격이 검증되지 않았습니다.
과거 VOIP 자료(https://gist.github.com/storycraft/ffdd727dbd45d9ae047a3ee93a83839f)의 10004(0x2714)는 구버전 후보일 뿐이며 현재 VOX3에서 검증되지 않았습니다.
카카오 공식 서비스 설명(https://www.kakaocorp.com/page/service/service/voiceroom)에 따르면 유일한 진행자 퇴장 시 보이스룸이 종료됩니다.

## 기존 운영 서버와 분리된 진단
1. 실제 Railway 봇과 다른 테스트 계정 및 Android 기기에서만 진단하세요.
2. experiments/voice-room/frida-vox-hangup-metadata.js 를 실행하고 앱에서 직접 정상 종료하세요.
3. 관찰한 JSON 로그를 hangup-observations.ndjson으로 저장하세요. 토큰, BSON, ID, SDP 등은 저장하지 마세요.
4. 다음 명령을 로컬에서 실행하세요.

```bash
node scripts/vox30-hangup-evidence.js < hangup-observations.ndjson
node --test test/vox30-hangup-evidence.test.js
```

도구가 출력하는 메서드 번호만으로는 실제 서버 종료 성공을 검증할 수 없습니다.
실제 종료 요청의 필드 이름과 자료형, 서버 승인, 동일 통화의 vr_bye 이벤트가 확인되기 전에는 운영용 종료 드라이버를 활성화하지 마세요.
