tmux send-keys 위임 방식 폐기와 새 통로 전환이 실전 검증까지 끝났다.
지금까지 확인된 사실만 규칙 파일 3종에 반영하라. 새로 만들거나 추측해서 채우지 마라.

## 검증 완료된 사실
- Codex 공식 플러그인: /codex:setup 통과. /codex:review, /codex:rescue,
  /codex:status, /codex:result, /codex:cancel 사용 가능. status가 진행상태와
  경과시간을 표로 반환하는 것 확인됨.
- agy-delegate 스킬: /mnt/e/VibeCoding/K-Bestie-v3/.claude/skills/agy-delegate
  relay.mjs 정상 동작. result.json으로 status/exitCode 반환.
  권한 자동거부를 status:failed로 정확히 감지하는 것 실측 확인됨.
- agy 바이너리: /home/home/.local/bin/agy, 모델 gemini-3.6-flash-high
- 첫 실전 디스패치 성공: 브리프 범위 준수, 지정 파일만 2줄 수정, 환각 없음.

## CLAUDE.md 에 반영
- 워커 위임은 codex 플러그인 또는 agy-delegate 경유만 허용.
  tmux send-keys 로 codex/agy 에 새 작업 지시 금지.
- 완료 판정은 /codex:status 또는 result.json 만 근거로 삼는다.
  pane 텍스트로 추정 금지.
- 워커는 커밋하지 않는다. 리뷰와 커밋은 오케스트레이터의 몫이다.

## AGENTS.md 에 반영
- Codex 역할: 리뷰어 겸 구조자. 코드리뷰, 설계반론, 버그조사, 막힌 작업 인수.
- 명령어 표 삽입 (위 5개).
- 리뷰는 --background 로 던지고 대기하지 않는다.
  status가 running이면 정상이므로 재실행하지 않는다.
- 배포 전 게이트에 /codex:adversarial-review 를 쓰고 초점을 명시한다.

## GEMINI.md 에 반영
- AGY 역할: 구현자. 기본 모델 gemini-3.6-flash-high.
- 브리프 작성 규칙: 대화 히스토리가 공유되지 않으므로 필요한 맥락 전부 기재.
  브리프 1개 = 작업 1개. 시크릿 금지(ps에 노출됨). 120KB 초과 금지.
  "커밋하지 말라" 명시.
- result.json 판정표: completed / failed / timeout / aborted / agy_unavailable
- touchedFiles 해석: [] 는 트리 clean, null 은 git이 보고 불가.
  status가 completed여도 touchedFiles가 비면 미수행으로 본다.
- **gitignore 대상 파일 예외**: git status에 안 잡히므로 touchedFiles와
  git diff 를 판정 근거로 쓸 수 없다. 이 경우 브리프의 verification_loop에
  git diff 를 쓰지 말고, 사전 스냅샷을 떠서 diff 비교하도록 지시한다.
  (2026-08-12 requests/_dashboard.md 사례에서 실제로 걸린 함정)
- --timeout 을 명시적으로 설정한다. 없으면 무한 대기 위험.
- AGY 자기보고는 근거가 아니다. diff를 직접 읽고 게이트를 직접 돌린다.

## 금지 조항 (3개 파일 공통)
- status=failed/timeout 에서 자동 재시도
- settings.json permissions.allow 로 --print 권한 우회 시도
- result.json 없이 완료 보고

## 마지막
기존 agent-run.sh / agent-status.sh / tmux 워치독 관련 조항이 규칙 파일에 있으면
"폐기(2026-08-12)"로 표시하되 삭제하지 말고 남겨라. 이유를 한 줄 적어라.

커밋 메시지: [규칙] 워커 위임 통로 전환 — codex 플러그인 + agy-delegate 반영
반영 후 각 파일의 변경된 섹션을 보여달라.
