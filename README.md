# DUKE Bot v0.1.1

Basic commands: `-도움말`, `-핑`, `-봇정보`, `-봇상태`. Existing KakaoForge SDK retained in src/; new engine in duke/. `npm ci && npm run build && npm start`. Authentication uses existing KAKAO_AUTH_PATH / KAKAO_AUTH_B64, never commit credentials. Counters use DUKE_DATA_DIR (default /app/data/duke-v1). No legacy DB access. Original manager, game, voice-room and web code preserved on backup/kakao-manager-20261126. Optional DUKE_TEST_ROOMS comma-separated room IDs. No management/game/voice modules active yet.
