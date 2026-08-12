# 작업 지시: tmux 세션 종료 원인 분석용 로깅 설치

## 이 작업의 목적
tmux 서버가 반복적으로 죽는 원인을 **아직 특정하지 못했다.** 이번 작업은 문제를
고치는 게 아니라, 원인을 판정할 수 있는 **증거를 수집**하는 것이 목적이다.
따라서 원인을 단정하는 코드나 대책을 임의로 추가하지 말 것.

### 지금까지 배제된 원인 (재조사 불필요)
- OOM / 메모리 부족 → `journalctl -k | grep -i oom` 결과 없음
- WSL 배포판 종료 → uptime 14시간 이상 유지 확인됨
- systemd-logind 조기 로그아웃 → 로그상 power off 시점에만 세션 종료됨

### 현재 유력 가설 (미검증)
에이전트(주로 Codex)가 작업 완료 후 보고 없이 pane에서 exit/Ctrl-D를 실행 →
pane 종료 → 세션 소멸 → tmux의 `exit-empty` 기본값(on)에 의해 **서버가 정상 종료**.
정상 종료이므로 시스템 로그에 흔적이 남지 않아 지금까지 원인 추적이 불가능했음.

이 가설을 검증하려면 "세션이 언제, 왜, 어느 pane에서 끝났는지"가 기록돼야 한다.
그것이 이번 작업이다.

## 작업 1. jq 설치 확인
```bash
command -v jq || sudo apt install -y jq
```

## 작업 2. 훅 로거 스크립트 생성
```bash
mkdir -p ~/.claude/hooks ~/.local/state
cat > ~/.claude/hooks/session-log.sh <<'EOF'
#!/usr/bin/env bash
# 세션 종료 이벤트 기록 — 원인 분석용. 실패해도 세션을 방해하지 않는다.
IN=$(cat)
LOG="$HOME/.local/state/tmux-watchdog.log"
EV=$(echo "$IN"  | jq -r '.hook_event_name // "unknown"' 2>/dev/null)
RS=$(echo "$IN"  | jq -r '.reason // "n/a"'             2>/dev/null)
SID=$(echo "$IN" | jq -r '.session_id // "n/a"'         2>/dev/null)
TS=$(tmux display-message -p '#{session_name}' 2>/dev/null || echo "no-tmux")
printf '%s HOOK event=%s reason=%s claude_session=%s tmux_session=%s pane=%s\n' \
  "$(date -Is)" "$EV" "$RS" "$SID" "$TS" "${TMUX_PANE:-none}" >> "$LOG"
exit 0
EOF
chmod +x ~/.claude/hooks/session-log.sh
```

## 작업 3. ~/.claude/settings.json 에 훅 등록
**기존 파일이 있으면 반드시 백업 후 병합할 것. 통째로 덮어쓰지 말 것.**
```bash
[ -f ~/.claude/settings.json ] && \
  cp ~/.claude/settings.json ~/.claude/settings.json.bak.$(date +%Y%m%d%H%M%S)
```
병합할 내용:
```json
{
  "hooks": {
    "SessionEnd": [
      { "hooks": [{ "type": "command", "command": "~/.claude/hooks/session-log.sh" }] }
    ],
    "SubagentStop": [
      { "hooks": [{ "type": "command", "command": "~/.claude/hooks/session-log.sh" }] }
    ]
  }
}
```
주의: SessionEnd 훅은 실행 예산이 짧다. 스크립트에 무거운 작업을 추가하지 말 것.

## 작업 4. tmux 측 최소 보호 (서버 유지)
원인 분석 기간 동안 서버가 죽어버리면 데이터 수집이 끊긴다. 아래만 적용한다.
```bash
[ -f ~/.tmux.conf ] && cp ~/.tmux.conf ~/.tmux.conf.bak.$(date +%Y%m%d%H%M%S)
grep -q "exit-empty" ~/.tmux.conf 2>/dev/null || cat >> ~/.tmux.conf <<'EOF'

# --- 원인 분석 기간 중 서버 유지 (임시) ---
set -g exit-empty off
set -g remain-on-exit on
EOF
```
실행 중인 서버에 즉시 반영 (**kill-server 절대 사용 금지 — 진행 중 작업이 날아간다**):
```bash
tmux set -g exit-empty off
tmux set -g remain-on-exit on
```

`remain-on-exit on`을 켜는 이유: pane 프로세스가 종료돼도 pane이 dead 상태로 남아,
**마지막 출력과 종료 코드를 사후에 확인**할 수 있다. 원인 분석의 핵심 단서다.
화면에 죽은 pane이 쌓이는 것은 의도된 동작이므로 임의로 끄지 말 것.

## 작업 5. 검증
```bash
echo '{"hook_event_name":"SessionEnd","reason":"manual_test","session_id":"test123"}' \
  | ~/.claude/hooks/session-log.sh
tail -3 ~/.local/state/tmux-watchdog.log
tmux show-options -g | grep -E "^(exit-empty|remain-on-exit)"
```
- 로그에 `HOOK event=SessionEnd reason=manual_test` 한 줄이 찍혀야 한다
- 옵션이 `exit-empty off` / `remain-on-exit on` 으로 나와야 한다
- Claude Code에서 `/hooks` 실행해 등록 상태를 확인할 것

## 작업 6. 문서화
`docs/ops/tmux-death-investigation.md` 생성:
- 배제된 원인 3건과 각각의 근거
- 현재 가설과 검증 방법
- 로그 위치: `~/.local/state/tmux-watchdog.log`
- 판정 기준:
  · Codex 세션 종료 직후 tmux 서버 소멸이 반복 → 가설 확정
  · 훅 기록 없이 서버만 소멸 → 가설 기각, 재조사 필요
- **수집 기간: 최소 3일. 그 전에는 결론을 내지 않는다.**

## 금지 사항
- 원인이 확정되지 않았으므로 대책성 코드(자동 재시작, 세션 강제 유지 등) 추가 금지
- `Stop` 훅으로 종료를 차단하는 기능은 이번에 구현하지 말 것.
  무한 루프로 세션이 종료되지 않을 위험이 있다. 필요성만 [후속 제안]으로 보고.
- 기존 settings.json / .tmux.conf 덮어쓰기 금지 (반드시 백업 후 병합)
- `tmux kill-server` 사용 금지

## 커밋
```
[설정] tmux 종료 원인 분석용 로깅 도입 — Claude Code Hooks + 서버 유지 옵션
```

## 보고 요구사항
- 작업 5의 출력 전문
- 백업 파일 경로 2건 (settings.json, .tmux.conf)
- `/hooks` 등록 확인 결과
- 실패 단계가 있으면 명령과 에러 메시지 원문 그대로
- 원인에 대한 추측은 보고서에 쓰지 말 것. 3일 후 로그로 판단한다.
