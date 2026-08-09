# tmux 서버 반복 종료 원인 조사 (2026-08-09 착수)

> 이 문서는 원인을 확정하지 않는다. 근거 없이 원인을 단정하지 말 것 — 최소 수집 기간
> 3일이 지난 뒤 로그를 근거로만 판정한다.

## 배경

이 작업 세션(2026-08-09) 동안 tmux 서버가 반복적으로 죽었다(`no server running on
/tmp/tmux-1000/default`). 매번 명시적으로 `tmux kill-server`를 호출한 적이 없는데도
발생했으며, 진행 중이던 codex-impl/codex-rv 세션의 실제 작업 자체는 로그 파일
(`/tmp/codex-impl-*.log`, `/tmp/codex-rv-*.log`)에 남은 `turn.completed` 이벤트로
미루어 볼 때 tmux가 죽기 직전에 이미 정상 완료된 경우가 대부분이었다 — 즉 "작업 실패로
서버가 죽는다"보다는 "작업이 끝난 뒤 서버가 죽는다"에 가까운 패턴이 관찰됐다.

## 배제된 원인 (재조사 불필요)

| 원인 후보 | 배제 근거 |
|---|---|
| OOM / 메모리 부족 | `journalctl -k \| grep -i oom` 결과 없음 |
| WSL 배포판 자체 종료 | `uptime` 14시간 이상 유지 확인됨 |
| systemd-logind 조기 로그아웃 | 로그상 실제 power off 시점에만 세션 종료됨 |

## 현재 유력 가설 (미검증)

에이전트(주로 Codex)가 작업 완료 후 별도 보고 없이 pane에서 exit/Ctrl-D를 실행하거나
셸이 종료됨 → pane 종료 → 세션 소멸 → tmux의 `exit-empty` 기본값(on)에 의해 마지막
세션이 사라지는 순간 **서버가 정상 종료**된다는 가설이다. 정상 종료 경로이므로
시스템 로그(`journalctl`, `dmesg`)에 흔적이 남지 않아 지금까지 원인 추적이
불가능했다.

## 검증 방법

1. **Claude Code Hooks 로깅**: `SessionEnd`, `SubagentStop` 이벤트가 발생할 때마다
   `~/.claude/hooks/session-log.sh`가 실행되어 `~/.local/state/tmux-watchdog.log`에
   시각·이벤트·reason·pane 정보를 기록한다.
2. **tmux 서버 유지 옵션**: 원인 분석 기간 동안 서버가 죽어버리면 데이터 수집이
   끊기므로, 다음을 임시로 켰다(`~/.tmux.conf`, 전역):
   - `exit-empty off` — 마지막 세션이 없어져도 서버 자체는 종료되지 않음
   - `remain-on-exit on` — pane 안 프로세스가 죽어도 pane이 dead 상태로 남아
     마지막 출력과 종료 코드를 사후에 확인할 수 있음(원인 분석의 핵심 단서)

## 로그 위치

- 훅 이벤트 로그: `~/.local/state/tmux-watchdog.log`
- 참고용 codex 세션 자체 로그(작업 완료 여부 교차 확인용): `/tmp/codex-impl-*.log`,
  `/tmp/codex-rv-*.log` (각 세션의 `tee` 출력, `turn.completed`/`__TASK_DONE__` 마커
  포함)

## 판정 기준

- **Codex(또는 다른 에이전트) 세션 종료 직후 tmux 서버 소멸이 반복** → 가설 확정.
  이 경우 후속 대책(예: pane 종료를 감지해도 세션을 유지하는 wrapper, 또는 Codex
  실행 스크립트 자체의 종료 방식 조정)을 별도 지시서로 제안한다.
- **훅 기록 없이 서버만 소멸** → 가설 기각, 재조사 필요. 이 경우 `remain-on-exit
  on` 덕분에 죽은 pane이 화면에 남아있을 것이므로 그 pane의 마지막 출력·종료
  코드를 근거로 다음 가설을 세운다.

## 수집 기간

**최소 3일 (2026-08-09 ~ 2026-08-12 이후).** 그 전에는 결론을 내지 않는다.

## 금지 사항 (현재 단계)

- 원인이 확정되지 않았으므로 자동 재시작·세션 강제 유지 등 대책성 코드를 추가하지
  않는다.
- `Stop` 훅으로 세션 종료 자체를 차단하는 기능은 구현하지 않는다(무한 루프로 세션이
  종료되지 않을 위험). 필요성이 확인되면 별도 지시서로 제안한다.
- 원인 분석용으로 켠 `exit-empty off` / `remain-on-exit on`은 **임시 설정**이다.
  원인이 확정되고 항구적 대책이 결정되면 이 문서를 갱신하고 필요 시 되돌린다.

## 되돌리기 (원인 확정 후)

```bash
# ~/.tmux.conf 에서 "원인 분석 기간 중 서버 유지 (임시)" 블록 제거 후
tmux set -g exit-empty on
tmux set -g remain-on-exit off
```

`~/.claude/hooks/session-log.sh` 및 settings.json의 SessionEnd/SubagentStop 훅
등록은 조사 종료 후 계속 남겨둘지 여부를 그때 판단한다(로깅 자체는 부작용이 없다).
