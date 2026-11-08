# NEXI 보이스룸 프로토콜 1차 조사 (2026-11-08)

## 상태
**아직 실제 생성/종료 API를 확보하지 못했습니다.** 이번 단계에서는 공개 자료를 살펴보고 현재 KakaoForge 코드에 필요한 음성 모듈이 있는지 읽기 전용으로 검사합니다. 운영 카카오톡 계정에 임의 패킷을 보내지 않습니다.

## 관찰된 사실

1. 카카오톡의 공개 APK 분석 자료에서 `VoiceroomCreateBottomSheetDialogFragment`의 버튼 처리 경로가 `getVoiceroomManager().makeVoiceroom(context, chatId, title, ...)` 호출로 연결됩니다.
2. 같은 자료에서 `VoiceroomCoreManager`, `IVoxManager`, `Vox30Manager`, `IVoxCall` 및 `joinVoiceRoomCall(..., VServiceType(11), ...)` 관련 코드가 발견됩니다.
3. 보이스룸 코어 구현에는 `call`과 `chatRoomId`의 단일 상태 변수, `isInIdle()` 검사 흐름이 보입니다. **앱의 해당 구현이 한 번에 한 보룸 세션을 관리할 가능성을 시사하지만, 서버 전체의 동시 접속 제한을 입증하지는 않습니다.**
4. PC 앱 공개 분석 메모에는 `Vox3.dll`과 보이스룸 BSON 메시지 처리 관련 심볼이 보고되었습니다. 정확한 엔드포인트·암호화·요청 스키마·응답 시그널링은 공개 자료만으로 확인되지 않았습니다.
5. **구형 LIVE_TALK 채팅 유형 및 일반 LOCO 명령은 현재 오픈채팅 VOX 생성 명령으로 검증되지 않았습니다.**

### 조사 출처 (제3자 자료·미검증 부분 포함)
- 앱 보이스룸 UI→매니저 흐름: https://github.com/theman001/KakaoWebTalk/blob/main/app/kakaotalk_apk_jadxExport/app/src/main/java/p405GS/C9129m.java
- 보이스룸 코어 매니저: https://github.com/theman001/KakaoWebTalk/blob/main/app/kakaotalk_apk_jadxExport/app/src/main/java/p3093zR/C75899c.java
- PC 음성 라이브러리 분석 메모: https://github.com/theman001/KakaoWebTalk/blob/main/report/02_Binary_Logic_DeepDive.md
- LOCO 메시징 개요: https://openkakao.vercel.app/docs/protocol/overview

**주의:** 위 링크의 코드·메모는 공식 문서가 아니며 카카오톡 버전과 실제 서버 동작이 일치하는지 확인되지 않았습니다. 분석 자료의 코드를 NEXI에 복제하지 않습니다.

## 현재 SDK 진단

```bash
node scripts/voice-protocol-audit.js
node --test test/voice-protocol-audit.test.js
```

이 도구는 `src/client/client.ts`, `src/net/carriage-client.ts`, `src/client/openchat-mixin.ts`, `start.js` 등 **정해진 파일만** 읽어 봅니다.
- LOCO 채팅 request 메서드 존재 여부
- 네이티브 VOX 관련 클래스명 참고 흔적
- `start.js`의 명시적 `voiceRoomAdapter` 연결 여부
- 실전 보룸 생성 가능 여부는 **항상 '미검증'**으로 보고합니다.

문자열 탐색 결과는 구현의 존재/부재를 절대적으로 증명하지 않습니다. 실행 중인 서비스·인증 세션·네트워크와 연결되지 않습니다.

## 실제 생성 기능에 필요한 기술적 관문

1. **검증된 생성 시그널링:** 실제 카카오톡 앱에서 보룸 생성 시 사용하는 프로토콜 종류(VOX 전용인지, HTTP 연동인지, LOCO 포함 여부)를 본인 소유의 테스트 환경에서 확인합니다.
2. **요청·응답 계약:** 요청 대상, 필수 필드의 자료형, 서비스가 반환하는 방별 생성 성공·실패·상태 조회 수단을 검증합니다. 토큰·세션키·개인 메시지·다른 사용자 정보는 수집하거나 공개하지 않습니다.
3. **세션 생명주기:** 생성, 호스트 유지, 종료, 재접속 상태를 구분하고 승인된 서버 응답으로만 성공 판정합니다.
4. **동시 보룸:** 한 앱 세션으로 다중 유지가 가능한지 검증하고, 불가능하면 방마다 독립된 계정/세션을 갖는 설계를 적용합니다. 동일 계정의 다중 로그인이나 제한 우회 성공을 전제하지 않습니다.
5. **NEXI 연결:** 검증된 구현이 마련된 뒤 `client.voiceRoomAdapter = {create, status, stop}` 계약에 연결합니다. 현재 운영 코드는 변경하지 않습니다.

## 배포 원칙

지금 단계는 **프로토콜 조사만 완료**한 상태입니다. 검증된 서버 생성 기능을 확보하지 않은 코드를 운영 Railway에 배포하거나 가짜 성공 응답을 만들지 않습니다.
