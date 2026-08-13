---
name: delegate-run
description: Codex와 agy의 위임 통로·명령어·플래그와 완료 판정 방법을 정의한다. 워커에 작업을 넘기거나 워커 결과를 판정할 때 사용한다.
disable-model-invocation: true
---

# 위임 실행

## 현행 통로 (v14)

- **Codex**: `/codex:review` · `/codex:adversarial-review` · `/codex:rescue` · `/codex:status` · `/codex:result` · `/codex:cancel`
- **agy**: agy-delegate relay → `result.json`. relay 플래그와 `result.json` 필드는 [.claude/skills/agy-delegate/references/dispatch-and-poll.md](../agy-delegate/references/dispatch-and-poll.md), 브리프 작성법은 [.claude/skills/agy-delegate/references/writing-the-brief.md](../agy-delegate/references/writing-the-brief.md) 참조.

판정·안전 규칙 (CLAUDE.md §2):

- **tmux send-keys 위임 금지.** 완료 판정은 `/codex:status` 또는 `result.json`만 사용한다. pane 텍스트 추정 금지.
- 워커는 커밋하지 않는다. 리뷰와 커밋은 Claude 담당.
- 워커 자기보고를 신뢰하지 않는다. `status=failed/timeout`에서 자동 재시도 금지.
- gitignore 대상 파일은 git이 보고하지 않는다. `touchedFiles`·`git diff` 대신 사전 스냅샷 diff로 검증한다.
- agy `--dangerously-skip-permissions`는 건마다 대표 승인. `settings.json permissions.allow` 우회 시도 금지.

agy 10분 룰 (CLAUDE.md §2-A):

- agy에는 **10분 내에 끝나는 작업만** 보낸다. 큰 작업은 10분 단위로 쪼개 여러 브리프로 나눈다. 조각끼리 파일이 겹치지 않으면 병렬로 동시에 보낸다.
- 타임아웃은 `--print-timeout 12m --timeout 13m`로 고정한다. 12분을 넘기면 쪼개기 실패다. 재시도하지 말고 브리프를 다시 나눈다.
- 앞 조각의 결과가 뒤 조각의 전제가 되면 순차로 보낸다. 애매하면 순차.

QA 통로 (CLAUDE.md §2-B): 읽기형 QA는 `--read-only`, 실행형 QA는 격리 워크트리에서 일반 모드.

---

## 위임 브리프 필수 포함 항목

구현 위임은 agy가 받는다(CLAUDE.md §1). 아래 항목이 하나라도 빠지면 위임하지 않는다.

1. 대상 파일 목록과 정확한 경로
2. 요구사항 및 완료 조건
3. **범위 밖 파일 수정 금지** — 큐 지시서의 `## 범위`를 그대로 전달
4. `docs/conventions.md`(현재 코드베이스 구조·타입 위치·API 응답 포맷·네이밍 실태) 확인 지시
5. **프로젝트 코드 규약 5종 재확인** (전문은 AGENTS.md §6~§10. 지시문에 다시 적는 것은 중복이 아니라 안전장치다.)
   - `src/` 디렉터리 생성 금지
   - AI SDK는 `@google/genai`만 사용
   - `responseMimeType` 사용 금지 (JSON은 프롬프트 스키마 강제 + `extractJSON`)
   - AI 키에 `NEXT_PUBLIC_` 접두사 금지
   - Supabase 테이블은 anon/authenticated에 GRANT ALL
6. **셀프검증 게이트 통과 후 반환** (agy: GEMINI.md §4-B / Codex 예외 구현: AGENTS.md §5)
7. 결과 보고 형식 (agy: GEMINI.md §4-C / Codex: AGENTS.md §12-A)

**작업 규모별 참고 시간** — agy 브리프를 10분 단위로 쪼갤 때의 감을 잡는 데 쓴다. 30분·60분짜리는 그대로 보내지 말고 반드시 분할한다.

| 작업 규모 | 예상 소요 |
|---|---|
| 소규모 수정·단순 버그 | 5~10분 |
| 단일 기능 구현 | 15분 |
| 여러 파일 연동·DB 변경·테스트 포함 | 30분 |
| 대규모 기능 통합·리팩터링 | 최대 60분 |

---

## 워커 완료·실패 감지

**배경**: `tmux send-keys`는 fire-and-forget이라 워커(codex/agy)의 완료·실패·행(hang)·사망을 구분할 수 없다. pane 화면을 읽고 "완료된 것 같다"고 추측하는 방식은 여러 차례 실측 실패했다(모니터 알림 미수신, 실제로는 끝난 세션을 진행 중으로 오판).

- 게이트 진입 조건: 완료 판정이 확정됐을 것. 진행 중이거나 멈춘 상태에서는 게이트①·②를 진행하지 않는다.
- 무활동으로 멈춘 것이 감지되면 자동 재시작 금지 — 대표님께 보고만 한다.
- **판정 결과를 그대로 믿지 않는다.** 강제 종료 경로에서 종료 코드가 정상 종료로 오판되는 사례가 확인됐다(`002-important.md` 검증 결과). 의심되면 로그와 산출물이 실제로 완결됐는지 함께 확인한다.

> **폐기(2026-08-13)** — 아래 `~/bin/agent-run.sh` · `~/bin/agent-status.sh` 래퍼 경로는 tmux 위임 통로와 함께 폐기됐다. 현행 판정은 `/codex:status`와 relay `result.json`이다. 이력 보존용으로만 남긴다.

- 모든 워커 실행은 `~/bin/agent-run.sh <task_id> <명령...>` 을 경유한다(직접 `codex exec .../agy ...`를 그대로 넘기지 않는다). 어떤 경로로 종료되든(정상/실패/강제종료) `~/.local/state/agent-runs/<task_id>.result`에 결과가 남는다.
- 상태 확인은 `~/bin/agent-status.sh <task_id> [pane]`로 한다 — 출력은 `DONE`/`FAILED exit=N`/`RUNNING`/`STALLED over=600s`/`DEAD ...` 중 하나다. **pane 화면 텍스트를 읽어 완료 여부를 추측하지 않는다.**
- 게이트 진입 조건: `agent-status.sh` 결과가 `DONE`일 것. `RUNNING`/`STALLED` 상태에서는 게이트①·②를 진행하지 않는다.
- STALLED(10분 무활동) 감지 시 자동 재시작 금지 — 대표님께 보고만 한다.
- **알려진 한계(002-important.md 검증 결과)**: 강제 종료(kill) 경로에서 `agent-run.sh`의 trap이 종료 코드를 `exit=0`(정상 종료로 오판)으로 기록하는 사례가 확인됐다. 즉 `DONE` 판정이라도 프로세스가 실제로는 강제 종료됐을 가능성을 완전히 배제하지 못한다 — 의심되면 로그 파일(`~/.local/state/agent-runs/<task_id>.log`) 내용이 실제로 완결된 산출물인지 함께 확인한다.

---

## 이력 — 폐기된 tmux 위임 경로

> **폐기(2026-08-13)** — 아래는 v13.2 시점의 tmux 기반 위임 규칙 원문이다. 통로가 전면 교체되면서 폐기됐다. 현재 통로는 이 문서 맨 위 「현행 통로 (v14)」를 따른다. 이력 보존용이다.

`nohup`/`&` 금지. 반드시 tmux 세션. 모든 위임 명령 끝에 `; echo '__TASK_DONE__'`를 붙이고 출력을 `tee`로 로그에 남긴다(§14 전제조건).

### 3-0. 위임 채널 전환 현황 (2026-08-12, `requests/002-multi.md` 대응 — 진행 중)

> 이 절의 "진행 중" 상태는 2026-08-13 전환 완료로 **해소됐다.** agy-delegate relay와 Codex 플러그인이 정식 통로다.

대표님이 tmux send-keys 위임(완료·실패 반환 채널 없음)을 폐기하고 공식 위임 통로(Codex 플러그인 + agy-delegate 스킬)로 전환할 것을 지시했다. 현재 확인된 상태:

- **Codex 플러그인** — 이 세션에서 설치·활성화 확인됨(`codex:setup`, `codex:rescue`, `codex:status` 등 Skill/Agent 목록에 실제로 존재). 리뷰·구조 작업(§3-A/§4-A의 codex-rv 역할)에 병행 사용 가능.
- **agy-delegate 스킬** — 대표님 터미널에서 설치 로그(`./.claude/skills/agy-delegate`)를 확인했으나, **이 Claude Code 세션의 파일시스템 어디에도 실제로 존재하지 않는다**(`~/.claude/skills/`, `~/.agents/skills/`, 저장소 내 전수 검색 전부 미발견 — 별도 셸/환경에서 설치된 것으로 추정). 이 스킬이 이 세션에서 실제로 로드·호출 가능함이 확인되기 전까지 **AGY 위임은 기존 tmux `agy --dangerously-skip-permissions -p` 경로(§3-B, §4-D)를 그대로 유지한다.** 확인되는 즉시 이 섹션과 §3-B/§4-D/§11/§14를 agy-delegate 경로로 전면 교체한다.
- **잠정 원칙**: 신규 Codex 리뷰·조사성 위임은 가능하면 `/codex:*` 명령을 우선 검토한다. Codex 구현 위임과 AGY 위임(구현·QA)은 agy-delegate 가용성이 실측 확인될 때까지 §3-A~§3-B의 기존 tmux 경로를 계속 사용한다 — 진행 중인 재화 로직(073/089) 게이트 사이클을 검증 안 된 새 통로로 갑자기 갈아타지 않는다.
- 규칙 파일 전면 개편(§1-B 역할표 재정의 포함)은 agy-delegate 실사용 검증 후 별도로 진행한다.

### 3-A. Codex 구현 위임 (폐기 — Codex는 1차 구현 주체가 아니다)

> v14에서 Codex 담당은 설계·분석·대량 작업·복잡한 건의 설계·정적 코드리뷰·설계 반론이다. 복잡한 건도 Codex가 직접 구현하지 않는다 — Sol이 설계·구현 계획을 내고, 그 계획대로 agy가 코딩한다(CLAUDE.md §1).

```bash
# 기본 — Terra · medium
TMPDIR_CODEX=$(mktemp -d) && chmod 700 "$TMPDIR_CODEX"
tmux new-session -d -s codex-impl-<task> "codex exec --full-auto --json \
  --model gpt-5.6-terra -c model_reasoning_effort=medium \
  '<구현 지시문>' \
  2>&1 | tee $TMPDIR_CODEX/events.jsonl | tee /tmp/codex-impl-<task>.log; echo '__TASK_DONE__'"

# 복잡·아키텍처 민감 — Sol · high (--model / effort만 교체, 나머지 동일)
#   --model gpt-5.6-sol -c model_reasoning_effort=high

# 세션 ID 추출 → /tmp/codex-impl-<task>.codex-session-id (§14-C resume용)
until [ -s "/tmp/codex-impl-<task>.codex-session-id" ]; do
  if command -v jq &>/dev/null; then
    jq -r 'select(.thread_id) | .thread_id' "$TMPDIR_CODEX/events.jsonl" 2>/dev/null | head -n 1 > "/tmp/codex-impl-<task>.codex-session-id"
  else
    grep -oE '"thread_id":"[^"]+"' "$TMPDIR_CODEX/events.jsonl" 2>/dev/null | head -n 1 | cut -d'"' -f4 > "/tmp/codex-impl-<task>.codex-session-id"
  fi
  sleep 1
done
```

### 3-B. agy 위임 (폐기 — agy는 QA·리서치·잡무 전용이 아니다)

> **agy 비즈니스 로직 작성 금지 조항은 폐지됐다(2026-08-13).** agy는 정식 코딩 주체이며, 용도를 `qa`/`research`/`chore`로 제한하지 않는다(CLAUDE.md §1). 타임아웃은 규모별 초 단위 값이 아니라 `--print-timeout 12m --timeout 13m` 고정이다(§2-A).

```bash
tmux new-session -d -s agy-<용도>-<target> "timeout <규모별 값> agy --dangerously-skip-permissions \
  --add-dir /mnt/e/VibeCoding/K-Bestie-v3 \
  --model='Gemini 3.6 Flash (High)' \
  -p '<지시문>' 2>&1 | tee /tmp/agy-<용도>-<target>.log; echo '__TASK_DONE__'"
```

- 용도는 `qa`(E2E QA, §4-D) / `research`(외부 리서치) / `chore`(문서·시드·스크립트)만 허용한다.
- timeout: 잡무·리서치 300~900초, E2E QA 600~1800초(시나리오 수 비례).
- **비즈니스 로직 구현을 agy에 위임하지 않는다(하드룰 1).** 잡무 지시문에도 "`app/`·`components/`·`hooks/`·`lib/`·`services/`·`supabase/functions/`의 비즈니스 로직을 신규 작성하지 마라. 필요하다고 판단되면 작성하지 말고 보고하라"를 반드시 포함한다.
- **`--model` 문자열은 첫 실행 시 `agy --help` 또는 settings.json 표기와 일치하는지 확인한다.** 모델명 오타는 조용히 기본 모델로 폴백될 수 있다.
