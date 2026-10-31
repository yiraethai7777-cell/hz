# 발로란트 전적 자동 등록 (Riot 계정 인증)

## 기능

- 사용자가 `!발로전적 닉네임#태그 ap` 또는 `!발로전적확인 닉네임#태그 ap`를 입력합니다.
- 미등록 계정이면 소유자의 공개 동의를 위한 Riot 로그인 링크를 자동 생성합니다.
- 로그인한 실제 Riot 계정의 `gameName#tagLine`이 요청된 Riot ID와 일치할 때만 PostgreSQL `hz_valorant_verified`에 등록합니다.
- 이후에는 `VALORANT_APPROVED_PLAYERS`에 추가할 필요 없이 다른 이용자도 해당 계정의 전적을 봇에서 검색할 수 있습니다.
- 동의하지 않았거나 공개가 제한된 계정은 API를 호출하지 않습니다.

## 필수 Railway 설정

기존 `HENRIKDEV_API_KEY`, `DATABASE_URL`에 더해 아래 세 값이 필요합니다.

| 환경변수 | 설명 |
| --- | --- |
| `RIOT_RSO_CLIENT_ID` | Riot에서 승인받은 RSO Client ID |
| `RIOT_RSO_CLIENT_SECRET` | Riot에서 승인받은 RSO Client Secret |
| `RIOT_RSO_REDIRECT_URI` | Riot에 등록된 HTTPS 콜백 URI. 반드시 `/api/valorant/callback`로 종료해야 합니다. 예: `https://hz-production-d530.up.railway.app/api/valorant/callback` |

Riot RSO는 Production Level API Key를 승인받은 개발자에게만 제공됩니다. HenrikDev API 키만으로는 Riot RSO 로그인 기능을 활성화할 수 없습니다.

## 운영상 주의

- 계정 이름을 입력했다는 사실 자체가 계정 소유자의 동의는 아닙니다.
- 승인된 RSO 인증 없이 PostgreSQL을 직접 수정해 계정을 승인 상태로 만드는 일은 지원하지 않습니다.
- Riot의 전적 제공 및 HenrikDev API의 개별 접근 권한은 별개입니다. RSO 인증 완료 뒤에도 HenrikDev에서 반환을 거부하면 전적을 표시할 수 없습니다.
- 위 코드에는 인증 및 등록 흐름을 추가했지만, 실제 연동은 RSO 승인과 환경변수 등록 뒤에만 확인할 수 있습니다.
