# 작업 지시: tmux 워커 완료/실패 감지 체계 구축

## 문제 정의
현재 오케스트레이터(Claude Code)는 `tmux send-keys`로 워커(codex, agy)에게
작업을 지시하는데, send-keys는 fire-and-forget이라 **항상 성공을 반환한다.**
따라서 워커의 완료·실패·행(hang)·사망을 구분할 수 없다. 반환 채널이 없는 것이
근본 원인이다. 이번 작업은 반환 채널을 만드는 것이다.

## 설계 원칙
1. 워커는 종료 시 **반드시** 결과 파일을 남긴다 (trap으로 비정상 종료도 포함)
2. 오케스트레이터는 pane 화면을 읽어 추측하지 않는다. 결과 파일만 신뢰한다
3. 진행 중과 행을 구분하기 위해 **에이전트 세션 파일 mtime**을 본다
   (Claude Code: ~/.claude/projects/, Codex: ~/.codex/sessions/)
4. 타임아웃은 반드시 둔다. 무한 대기 금지

## 작업 1. 워커 래퍼 스크립트
```bash
mkdir -p ~/bin ~/.local/state/agent-runs
cat > ~/bin/agent-run.sh <<'EOF'
#!/usr/bin/env bash
# 사용법: agent-run.sh <task_id> <실행할 명령...>
# 어떤 경로로 종료되든 결과 파일을 남긴다.
TASK="$1"; shift
DIR="$HOME/.local/state/agent-runs"
RESULT="$DIR/$TASK.result"
LOGF="$DIR/$TASK.log"
mkdir -p "$DIR"

finish() {
  code=$?
  printf 'task=%s exit=%s end=%s pane=%s\n' \
    "$TASK" "$code" "$(date -Is)" "${TMUX_PANE:-none}" > "$RESULT"
  # tmux 대기 채널에 완료 신호 전송 (블로킹 해제용)
  tmux wait-for -S "done-$TASK" 2>/dev/null
  exit $code
}
trap finish EXIT INT TERM HUP

printf 'task=%s start=%s\n' "$TASK" "$(date -Is)" > "$DIR/$TASK.start"
rm -f "$RESULT"
"$@" 2>&1 | tee "$LOGF"
exit "${PIPESTATUS[0]}"
EOF
chmod +x ~/bin/agent-run.sh
```

## 작업 2. 상태 조회 스크립트 (오케스트레이터 전용)
```bash
cat > ~/bin/agent-status.sh <<'EOF'
#!/usr/bin/env bash
# 사용법: agent-status.sh <task_id> [pane_target]
# 출력: DONE|FAILED|RUNNING|STALLED|DEAD  (한 단어)
TASK="$1"; PANE="${2:-}"
DIR="$HOME/.local/state/agent-runs"
STALL_SEC=600   # 10분간 아무 활동 없으면 STALLED

# 1) 결과 파일이 있으면 종료된 것 — exit code로 판정
if [ -f "$DIR/$TASK.result" ]; then
  code=$(grep -o 'exit=[0-9]*' "$DIR/$TASK.result" | cut -d= -f2)
  [ "$code" = "0" ] && echo "DONE" || echo "FAILED exit=$code"
  exit 0
fi

# 2) pane이 죽었는지 확인 (결과 파일 없이 사라진 경우)
if [ -n "$PANE" ]; then
  dead=$(tmux display-message -p -t "$PANE" '#{pane_dead}' 2>/dev/null)
  [ -z "$dead" ] && { echo "DEAD pane_missing"; exit 0; }
  [ "$dead" = "1" ] && { echo "DEAD pane_exited"; exit 0; }
fi

# 3) 살아있음 — 진짜 일하는 중인지 행인지 구분
#    화면 출력이 아니라 에이전트 세션 파일 mtime을 본다 (오탐 방지의 핵심)
newest=0
for d in "$HOME/.claude/projects" "$HOME/.codex/sessions" "$DIR"; do
  [ -d "$d" ] || continue
  m=$(find "$d" -type f -newermt "-${STALL_SEC} seconds" 2>/dev/null | head -1)
  [ -n "$m" ] && newest=1
done
[ "$newest" = "1" ] && echo "RUNNING" || echo "STALLED over=${STALL_SEC}s"
EOF
chmod +x ~/bin/agent-status.sh
```

## 작업 3. 워커 실행 방식 변경
앞으로 워커에게 작업을 시킬 때는 **반드시** 래퍼를 경유한다.
```bash
# 잘못된 방식 (현재) — 완료를 알 수 없음
tmux send-keys -t codex-impl "codex exec '...'" Enter

# 올바른 방식
tmux send-keys -t codex-impl "~/bin/agent-run.sh task-073 codex exec '...'" Enter
```

## 작업 4. 오케스트레이터 대기 규칙
작업 지시 후 아래 순서로 확인한다. **pane 화면을 읽고 추측하지 말 것.**
STALL 기준이 10분이므로 대기 루프는 그보다 충분히 길어야 한다(최대 40분).
```bash
# 30초 간격으로 최대 80회(=40분) 확인
for i in $(seq 1 80); do
  s=$(~/bin/agent-status.sh task-073 codex-impl)
  case "$s" in
    DONE)     echo "완료"; break ;;
    FAILED*)  echo "실패: $s"; tail -50 ~/.local/state/agent-runs/task-073.log; break ;;
    DEAD*)    echo "사망: $s"; break ;;
    STALLED*) echo "행 의심: $s — 사용자에게 보고"; break ;;
    RUNNING)  sleep 30 ;;
  esac
done
```

## 작업 5. 검증 (3가지 경우를 모두 테스트할 것)
```bash
tmux new-session -d -s wtest

# (1) 정상 완료
tmux send-keys -t wtest "~/bin/agent-run.sh t-ok sleep 3" Enter
sleep 6; ~/bin/agent-status.sh t-ok wtest        # → DONE 이어야 함

# (2) 실패 종료
tmux send-keys -t wtest "~/bin/agent-run.sh t-fail sh -c 'exit 7'" Enter
sleep 3; ~/bin/agent-status.sh t-fail wtest      # → FAILED exit=7 이어야 함

# (3) 강제 사망 (trap이 동작하는지)
tmux send-keys -t wtest "~/bin/agent-run.sh t-kill sleep 300" Enter
sleep 2; pkill -f "sleep 300"
sleep 2; ~/bin/agent-status.sh t-kill wtest      # → FAILED (0이 아닌 코드)

tmux kill-session -t wtest
```
세 경우가 모두 예상대로 나와야 통과. 하나라도 다르면 보고할 것.
※ STALLED 판정은 10분 무활동이 필요하므로 이 검증에 포함하지 않는다.
   실제 운용 중 관찰로 확인한다.

## 작업 6. 규칙 파일 반영
AGENTS.md와 GEMINI.md에 아래를 추가:
```
- 모든 작업은 `~/bin/agent-run.sh <task_id> <명령>` 을 경유해 실행한다.
  래퍼 없이 실행된 작업은 완료 판정이 불가능하므로 미실행으로 간주한다.
- 작업 종료 시 exit/Ctrl-D 금지. 래퍼가 종료 코드를 기록하고 신호를 보낸다.
```
CLAUDE.md §6 2단 게이트에 추가:
```
- 게이트 A 진입 조건: agent-status.sh 결과가 DONE 일 것.
  RUNNING/STALLED 상태에서 게이트를 진행하지 않는다.
```

## 금지 사항
- pane 화면 텍스트를 읽어 "완료된 것 같다"고 판정하지 말 것
- 타임아웃 없는 무한 대기 루프 작성 금지
- STALLED 감지 시 자동 재시작 금지 (중복 실행 위험, 사용자에게 보고만)
- STALL_SEC 값을 임의로 변경하지 말 것 (운용 데이터 확보 후 조정)

## 커밋
```
[설정] tmux 워커 완료/실패 감지 체계 — agent-run 래퍼 + 상태 판정(STALL 10분)
```

## 보고
- 작업 5의 3가지 테스트 출력 전문
- 실패 항목이 있으면 명령과 에러 원문
