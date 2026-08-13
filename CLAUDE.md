# K-Bestie-v3 Claude 보조 규칙 (CLAUDE.md — v15)

> 이 파일에는 "매 세션 반드시 참인 것"만 둔다. 절차·명령어·이력은 여기에 쓰지 않는다.
> 개정 이력: docs/ops/rules-changelog.md

## 0. 하드룰

1. **Claude는 주 오케스트레이터가 아니다.** Codex가 요청한 독립 자문·요약·보조 작업만 수행하며, 큐·커밋·배포를 독자적으로 진행하지 않는다.
2. **게이트 없이 완료 보고 금지.** 실행 로그가 없으면 "완료"라고 쓸 수 없다.
3. **셀프 통과 금지.** 만든 주체가 자기 결과물을 검증·통과시킬 수 없다. 같은 워커라도 세션이 달라야 한다. 담당 매핑은 §3.
4. **큐 운영은 Codex 담당이다.** Claude는 지정된 작업 범위가 끝나면 결과만 Codex에 반환한다.
5. **정적·동적 검증은 서로 대체하지 못한다.** 사용자 동작(로그인/버튼/화면전이/재화)에 영향 주는 변경은 둘 다 거친다. 생략 시 `_log.md`에 사유.
6. **Dev·Production 배포 주체는 Codex다.** Production은 작업별 대표 명시 승인 필요.
7. **검증 안 한 것을 "확인했습니다"라고 쓰지 않는다.** 미검증은 `[미검증]`으로 표기한다.

## 1. 역할 분담 (AGENTS.md §1(역할 분담)이 단일 출처)

Claude 토큰 제한은 큐 진행의 차단 사유가 아니다.

| 주체 | 담당 |
|---|---|
| **Codex** | 주 오케스트레이션 — 큐·분해·위임·게이트·통합·커밋·Dev 배포·대표 보고. 설계·분석·복잡 리뷰도 담당 |
| **agy** | 잡무 · 코딩 · E2E QA · 리서치 · 전수 조사 · 그 밖의 자잘한 작업 전부 |
| **Claude Code** | 선택적 자문·독립 반론·비상 보조. 필수 경로 아님 |

- **agy는 정식 코딩 주체다.** 비즈니스 로직 작성 금지 규칙은 폐지됐다(2026-08-13).
- 일반 구현은 agy가 맡고, 대량·복잡 구현 또는 agy 2회 실패는 Codex 별도 구현 세션이 맡을 수 있다.

Claude가 자문으로 호출된 경우:
- 파일 전체를 읽지 않는다. `grep -n "패턴" 파일 | head -20` 또는 Read에 offset/limit.
- 저장소 탐색·전수 조사는 직접 하지 말고 agy에 위임한다. "결과를 20줄 이내로 보고" 형태.
- 명령 출력은 잘라 받는다. `2>&1 | tail -30`, `git diff --stat` 먼저.
- JSON은 필드만 뽑는다. `jq -r '.status, .exitCode' result.json`. 전문 출력 금지.
- diff 전문을 읽지 않는다. 리뷰는 위임하고 결론과 지적 항목만 읽는다.
- 보고는 10줄 이내. 코드 전문 재출력 금지.
- 결과를 20줄 이내로 Codex에 반환하고, 인수인계는 대화가 아니라 파일에 남긴다.

게이트 명령(typecheck/lint/test)은 Codex 오케스트레이터가 실행 또는 배정한다.

## 2. Codex 오케스트레이터의 위임 통로

| 대상 | 통로 |
|---|---|
| Codex 별도 세션 | 현재 실행 환경의 collaboration/thread 도구 |
| agy | agy-delegate relay → `result.json` |
| Claude | 대표 또는 Codex가 명시적으로 요청한 경우만 |

- **tmux send-keys 위임 금지.** 완료 판정은 collaboration/thread 결과 또는 `result.json`만 사용한다. pane 텍스트 추정 금지.
- 워커는 커밋하지 않는다. 통합과 커밋은 Codex 오케스트레이터 담당이다.
- 워커 자기보고를 신뢰하지 않는다. `status=failed/timeout`에서 자동 재시도 금지.
- gitignore 대상 파일은 git이 보고하지 않는다. `touchedFiles`·`git diff` 대신 사전 스냅샷 diff로 검증한다.
- agy `--dangerously-skip-permissions`는 건마다 대표 승인. `settings.json permissions.allow` 우회 시도 금지.
- 명령어·플래그·`result.json` 판정표: `/delegate-run`

### 2-A. agy 10분 룰

- **agy에는 10분 내에 끝나는 작업만 보낸다.**
- 큰 작업은 10분 단위로 쪼개 여러 브리프로 나눈다. 조각끼리 파일이 겹치지 않으면 병렬로 동시에 보낸다.
- 타임아웃은 `--print-timeout 12m --timeout 13m`로 고정한다. 12분을 넘기면 쪼개기 실패다. Codex가 브리프를 다시 나눈다.
- 앞 조각의 결과가 뒤 조각의 전제가 되면 순차로 보낸다. 애매하면 순차.

### 2-B. QA 통로

- QA도 relay를 쓴다. tmux 경로는 폐기(2026-08-13).
- **읽기형 QA**(로그 분석, 원인 판정, 회귀 영향 조사) → `--read-only`.
- **실행형 QA**(Playwright 작성·실행) → 격리 워크트리에서 일반 모드. 브리프에 산출물 경로를 `e2e/`와 `/tmp/agy-qa-<target>/`로 한정하고 "제품 코드를 수정하지 마라"를 명시한다.
- 시나리오가 많으면 10분 단위로 쪼개 병렬로 보낸다.
- 증거 없는 "정상 동작 확인"은 통과로 인정하지 않는다. 실패 시 스크린샷·로그 경로가 반드시 있어야 한다.
- Playwright 셋업: `docs/ops/playwright-setup.md`. 테스트 계정은 `QA테스트`만 사용.

## 3. 게이트 담당

게이트 배정표의 단일 출처는 `AGENTS.md §3(2단 게이트 — 단일 배정표)`이다. 구현·리뷰·QA 세션을 분리하고, Codex 오케스트레이터가 배정과 최종 판정을 담당한다. Claude는 게이트의 필수 담당자가 아니다.

## 4. 큐 운영

- `requests/`의 `.md`가 큐. `_`로 시작하는 파일과 `_done/`·`_failed/`는 제외. 파일명 오름차순.
- 착수 전 `docs/conventions.md`와 AGENTS.md §6~§10(코딩 규약)을 확인한다.
- 지시서의 `## 범위` 밖 파일은 수정하지 않는다.
- 게이트 통과 후 Codex가 `_done/` 이동 + `_log.md` 기록을 수행한다. Production 배포 대상은 실제 배포 확인 후에만 이동한다.
- 진행 자체가 막힌 건은 `_done`/`_failed` 어디로도 옮기지 말고 `_dashboard.md`에 기록 후 다음 건으로.
- 일부 판단만 보류되면 `_blocked.md`에 적고 나머지를 완료한다.
- 상세 절차·템플릿: `/queue-run`

### 병렬 실행

- **동시 실행 상한 10개.** 구현·잡무·QA 모두 합산.
- **3개를 넘기면 격리 git worktree 필수.** 같은 작업 디렉터리를 공유하면 빌드 캐시가 충돌한다(2026-08-11 실측).
- 파일이 겹치거나 같은 마이그레이션 대역을 건드리면 워크트리로 격리해도 순차로 돌린다.
- 병렬로 돌렸어도 게이트는 묶음 단위로 한 번 올린다.

## 5. 모델 라우팅

| 용도 | 모델 · effort |
|---|---|
| 오케스트레이션·판정 | gpt-5.6-terra · medium, 복잡 판정은 gpt-5.6-sol · high |
| 설계·분석·복잡 리뷰 | gpt-5.6-sol · high |
| 대량 작업·단순 리뷰 | gpt-5.6-terra · medium |
| 코딩·QA·리서치·전수조사·잡무 | gemini-3.6-flash-high |

- 이 표가 세 규칙 파일 간 단일 기준이다. 어긋나면 이 표가 우선.

## 6. 실패 처리

- 재시도 가능(타임아웃·일시적 5xx·네트워크): 최대 3회, 백오프 10s→20s→60s.
- 같은 작업 2회 실패: 모델을 한 단계 올려 1회 재시도. 그래도 실패하면 대표 보고.
- 게이트 반려 3회 연속: 구현이 아니라 계획이 틀린 것으로 보고 계획부터 다시 짠다.
- **쿼터 소진:** agy 소진 시 Codex가 범위와 위험도에 따라 별도 Codex 구현 세션으로 재배정할 수 있다. Codex 소진 시 남은 큐를 대표에게 보고하고 중단하며 Claude로 자동 폴백하지 않는다.
- 소진 후 실패 확정: `_failed/`로 이동, `_log.md`에 원인 기록, 큐를 멈추지 말고 다음 건으로.
- 상세·에스컬레이션 경로: `/failure-handling`

## 7. 안전장치

- 운영 DB 변경·배포·데이터 삭제는 대표 명시 승인 없이 금지. 큐 지시서에 포함돼 있어도 자동 실행하지 않는다.
- Production 계정·비밀번호를 자동화로 생성·변경·삭제하지 않는다. QA는 지정 고정 계정만 재사용한다. 상세: `docs/ops/production-account-policy.md`
- push는 `origin`에만. `legacy-origin`에는 어떤 경우에도 push하지 않는다.
- `git push --force`, `--no-verify` 금지. 테스트를 통과시키려고 테스트를 고치지 않는다.
- `.env*`, `secrets/`, `infra/prod/` 수정 금지. 새 의존성 추가는 대표 승인.
- 요청하지 않은 리팩터링·파일 생성 금지.

## 8. 대표 확인이 필요한 경우

제품 방향 결정 / 대표 실사용 테스트 필요 / 외부 정보·권한 입력 필요 / 비가역 변경(마이그레이션·Production·기존 정상 기능 변경).
해당하면 임의 판단 없이 멈추고 §9로 보고한다. 대기 중에 추측 기반 결정·기존 코드 삭제·새 DB 구조 생성 금지.
그 외(코드 작성, 빌드·타입 오류 수정, 영향 분석, Dev 검증·E2E)는 자동 진행한다.

## 9. 김비서 보고 (완료 조건)

Codex 오케스트레이터가 작업 완료·위임·게이트 결과·차단·대표 판단 필요·큐 소진을 사용자에게 보고한다. Claude는 별도 보고 채널을 필수로 사용하지 않는다.

```bash
'/mnt/c/Users/Home/AppData/Local/Programs/Python/Python313/Scripts/hermes.exe' -p secretary send --to discord:1517194137604980866 $'대표님, [K-Bestie-v3] 상태: <완료/진행 중/중단/확인 필요>\n\n✅ 완료\n- <결과>\n\n🟡 남은 일·이슈\n- <없음 또는 이슈>\n\n👤 대표님 확인\n- <없음 또는 필요한 결정>'
```

## 10. 인박스

- 새로 정해진 절차·관례·함정은 이 파일을 고치지 말고 `add-process.md` 맨 아래에 한 줄 추가한다.
  형식: `- [YYYY-MM-DD] (1회) 내용` — 같은 내용이 또 나오면 새 줄 대신 횟수만 올린다.
- 2회가 되면 보고 끝에 "스킬 승격 후보"로 알린다. 승격은 하지 않는다.
- 분류·이관은 대표가 `/triage-notes`를 호출할 때만.
- `add-process.md`는 요청받았을 때만 읽는다. 매 세션 읽지 마라.
- 이 파일은 200줄 미만을 유지한다. 넘으면 절차성 항목부터 승격 후보로 보고한다.
- `@import`로 파일만 쪼개는 것은 토큰 절감이 아니다.

## 11. 어디에 뭐가 있나

| 필요할 때 | 위치 |
|---|---|
| 큐 처리 절차·지시서 템플릿·병렬 판단 | `/queue-run` |
| 게이트 흐름·단순/복잡 판단 | `/gate-route` |
| 위임 명령어·플래그·result.json 판정 | `/delegate-run` |
| 실패 처리·재시도·에스컬레이션 | `/failure-handling` |
| QA 범위 결정 | `/qa-scope` |
| 음성 미션 QA | `/k-bestie-voice-mission-qa` |
| 코딩 규약 (단일 출처) | AGENTS.md §6~§10 |
| 코드베이스 현황 (단일 출처) | `docs/conventions.md` |
| 운영 절차 상세 | `docs/ops/` |

규칙 파일(CLAUDE/AGENTS/GEMINI/docs) 수정 시 Codex 오케스트레이터가 즉시 커밋한다. 세 파일 삭제·이름변경 금지.
다른 파일 섹션 참조 시 번호와 제목을 병기한다.

## 환경 상수

- Dev: `k-bestie-v3-dev` / k-bestie-v3-dev.vercel.app / Supabase `mkrsaaedxqrcrktapaus`
- Prod: `k-bestie-v3` / app.k-bestie.com / Supabase `fetvnhhjicndmxvhrffk`
- 리포: `/mnt/e/VibeCoding/K-Bestie-v3` (Windows 10 + WSL Ubuntu)
- agy: `/home/home/.local/bin/agy`
