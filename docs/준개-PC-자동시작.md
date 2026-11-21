# PowerShell 준개 자동 시작

## 기능

지정한 오픈채팅방에서 기존 `shared/junggae-rule.js` 준개 신청 규칙을 만족하는 메시지가 감지되면, **그 메시지가 올라온 바로 그 방**에 `junggae-start.txt` 내용을 자동 전송합니다.

- 지정하지 않은 방에서는 반응하지 않습니다.
- 동일 메시지 이벤트 중복 수신은 2분간 무시합니다.
- PC에서만 실행되며 Railway의 봇/DB 파일은 수정하지 않습니다.
- 두 명 이상의 실제 멘션과 멘션 외 내용이 필요합니다. 실제 멘션 없는 일반 텍스트, `템맡`, 관리 명령어, 부방장 작성 메시지는 기존 규칙상 무시합니다.
- `junggae-start.txt`를 수정하면 원하는 준개 시작 안내문을 사용할 수 있습니다. 실행 전에 읽으므로 수정 후 재시작해야 합니다.

## PowerShell 실행

프로젝트 루트에 `dist/` (KakaoForge 빌드 결과)와 전용 카카오 계정 인증 파일 `auth.json`이 준비되어 있어야 합니다.

```powershell
cd C:\NEXI-PC
node .\junggae-auto-start.js --room 18496234145974738
```

복수의 **선택된** 준개방을 감지하려면 `--rooms ID1,ID2` 또는 `--room ID1 --room ID2`를 사용합니다.

```powershell
node .\junggae-auto-start.js --rooms 18496234145974738,18357439193628181
```

실제 메시지를 보내지 않고 감지만 검사할 때:

```powershell
node .\junggae-auto-start.js --room 18496234145974738 --dry-run
```

별도의 인증 파일을 사용하려면 `--auth .\auth-junggae.json`, 별도의 시작 멘트 파일을 사용하려면 `--message-file .\custom-opening.txt` 옵션을 추가합니다.

중지하려면 PowerShell에서 `Ctrl+C`를 누릅니다. 인증 파일/비밀번호를 GitHub에 커밋하지 마세요.

**주의:** Railway에서 사용 중인 카카오 계정으로 PC 프로그램을 동시에 로그인하면 세션 충돌이 발생할 수 있습니다. 별도 카카오 계정 인증 파일로 운영하는 것을 권장합니다.

## 점검

```powershell
node --test test/junggae-auto-start.test.js
```

테스트는 메모리상의 모의 카카오톡 이벤트만 사용하고 실제 메시지를 보내지 않습니다.
