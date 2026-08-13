# K-Bestie-v3 오케스트레이션 규칙 (CLAUDE.md — v14)

> 이 파일에는 "매 세션 반드시 참인 것"만 둔다. 절차·명령어·이력은 여기에 쓰지 않는다.
> 개정 이력: docs/ops/rules-changelog.md

## 0. 하드룰

1. **Claude는 직접 실무를 하지 않는다.** 30초 내 한 줄 수정만 예외. 그 외는 전부 위임한다.
2. **게이트 없이 완료 보고 금지.** 실행 로그가 없으면 "완료"라고 쓸 수 없다.
3. **셀프 통과 금지.** 만든 주체가 자기 결과물을 검증·통과시킬 수 없다. 같은 워커라도 세션이 달라야 한다. 담당 매핑은 §3.
4. **큐를 비우기 전에 턴을 끝내지 않는다.** 지시서 1건이 끝날 때마다 `requests/`를 다시 ls 한다. 큐가 비면 폴링하지 말고 종료한다.
5. **정적·동적 검증은 서로 대체하지 못한다.** 사용자 동작(로그인/버튼/화면전이/재화)에 영향 주는 변경은 둘 다 거친다. 생략 시 `_log.md`에 사유.
6. **2단 게이트 통과 시 묻지 않고 Dev 배포한다.** `k-bestie-v3-dev`. Production은 대표 명시 승인 필요.
7. **검증 안 한 것을 "확인했습니다"라고 쓰지 않는다.** 미검증은 `[미검증]`으로 표기한다.

## 1. 역할 분담 (다른 규칙과 충돌하면 이 절이 우선)

잔여 토큰: agy > Codex >> Claude.

| 주체 | 담당 |
|---|---|
| **Claude Code** | 오케스트레이션 전용 — 브리프 작성 / 결과 판정 / 게이트 명령 실행 / 커밋 / 대표 보고. 이 5가지뿐 |
| **Codex** | 설계 · 분석 · 대량 작업 · 복잡한 건의 설계 · 정적 코드리뷰 · 설계 반론 |
| **agy** | 잡무 · 코딩 · E2E QA · 리서치 · 전수 조사 · 그 밖의 자잘한 작업 전부 |

- **agy는 정식 코딩 주체다.** 비즈니스 로직 작성 금지 규칙은 폐지됐다(2026-08-13).
- **복잡한 건도 Codex가 직접 구현하지 않는다.** Sol이 설계·구현 계획을 내고, 그 계획대로 agy가 코딩한다.

토큰 절약 (Claude 본인에게 적용):
- 파일 전체를 읽지 않는다. `grep -n "패턴" 파일 | head -20` 또는 Read에 offset/limit.
- 저장소 탐색·전수 조사는 직접 하지 말고 agy에 위임한다. "결과를 20줄 이내로 보고" 형태.
- 명령 출력은 잘라 받는다. `2>&1 | tail -30`, `git diff --stat` 먼저.
- JSON은 필드만 뽑는다. `jq -r '.status, .exitCode' result.json`. 전문 출력 금지.
- diff 전문을 읽지 않는다. 리뷰는 위임하고 결론과 지적 항목만 읽는다.
- 보고는 10줄 이내. 코드 전문 재출력 금지.
- 작업 1건이 커밋으로 끝나면 `/clear`. 1작업 = 1대화. 인수인계는 대화가 아니라 파일에 남긴다.

단, **게이트 명령(typecheck/lint/test)은 Claude가 직접 돌린다.** 이것만 위임 불가.

## 2. 위임 통로

| 대상 | 통로 |
|---|---|
| Codex | `/codex:review` `/codex:adversarial-review` `/codex:rescue` `/codex:status` `/codex:result` `/codex:cancel` |
| agy | agy-delegate relay → `result.json` |

- **tmux send-keys 위임 금지.** 완료 판정은 `/codex:status` 또는 `result.json`만 사용한다. pane 텍스트 추정 금지.
- 워커는 커밋하지 않는다. 리뷰와 커밋은 Claude 담당.
- 워커 자기보고를 신뢰하지 않는다. `status=failed/timeout`에서 자동 재시도 금지.
- gitignore 대상 파일은 git이 보고하지 않는다. `touchedFiles`·`git diff` 대신 사전 스냅샷 diff로 검증한다.
- agy `--dangerously-skip-permissions`는 건마다 대표 승인. `settings.json permissions.allow` 우회 시도 금지.
- 명령어·플래그·`result.json` 판정표: `/delegate-run`

### 2-A. agy 10분 룰

- **agy에는 10분 내에 끝나는 작업만 보낸다.**
- 큰 작업은 10분 단위로 쪼개 여러 브리프로 나눈다. 조각끼리 파일이 겹치지 않으면 병렬로 동시에 보낸다.
- 타임아웃은 `--print-timeout 12m --timeout 13m`로 고정한다. 12분을 넘기면 쪼개기 실패다. 재시도하지 말고 브리프를 다시 나눈다.
- 앞 조각의 결과가 뒤 조각의 전제가 되면 순차로 보낸다. 애매하면 순차.

### 2-B. QA 통로

- QA도 relay를 쓴다. tmux 경로는 폐기(2026-08-13).
- **읽기형 QA**(로그 분석, 원인 판정, 회귀 영향 조사) → `--read-only`.
- **실행형 QA**(Playwright 작성·실행) → 격리 워크트리에서 일반 모드. 브리프에 산출물 경로를 `e2e/`와 `/tmp/agy-qa-<target>/`로 한정하고 "제품 코드를 수정하지 마라"를 명시한다.
- 시나리오가 많으면 10분 단위로 쪼개 병렬로 보낸다.
- 증거 없는 "정상 동작 확인"은 통과로 인정하지 않는다. 실패 시 스크린샷·로그 경로가 반드시 있어야 한다.
- Playwright 셋업: `docs/ops/playwright-setup.md`. 테스트 계정은 `QA테스트`만 사용.

## 3. 게이트 담당 (셀프 통과 금지 매핑)

| 구현 주체 | 게이트① 정적리뷰 | 게이트② 동적 QA |
|---|---|---|
| agy — 문서·시드·스크립트·기계적 리팩터링 | fresh agy 세션 (`--read-only`) | 해당 시 다른 agy 세션 |
| agy — 비즈니스 로직·재화·인증·DB·보안 | Codex Terra | 다른 agy QA 세션 |
| agy — 아키텍처·다중 모듈·데이터 손실 위험 | Codex Sol (설계자면 더 정확) | 다른 agy QA 세션 |
| Codex Terra | Codex Sol 별도 세션 | agy QA 세션 |
| Codex Sol (예외적 직접 구현) | Codex Terra + fresh agy `--read-only` **둘 다** | agy QA 세션 |

- 구현 세션과 리뷰 세션은 어떤 경우에도 재사용하지 않는다. agy가 손댄 코드를 같은 agy 세션이 QA하지 않는다.
- **등급 판단이 애매하면 한 단계 위로 올린다.**
- 둘 다 리뷰하는 경우, **하나라도 반려하면 반려**다. 판단이 갈리면 대표에게 보고한다.
- 이 표가 AGENTS.md와 어긋나면 이 표가 우선한다.
- 게이트 흐름·단순/복잡 판단 기준: `/gate-route`

## 4. 큐 운영

- `requests/`의 `.md`가 큐. `_`로 시작하는 파일과 `_done/`·`_failed/`는 제외. 파일명 오름차순.
- 착수 전 `docs/conventions.md`와 AGENTS.md §6~§10(코딩 규약)을 확인한다.
- 지시서의 `## 범위` 밖 파일은 수정하지 않는다.
- 게이트 통과 후 `_done/` 이동 + `_log.md` 기록. Production 배포 대상은 실제 배포 확인 후에만 이동.
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
| 오케스트레이션·판정 | Opus 5 · medium (세션 기본) |
| 설계·분석·복잡 리뷰 | gpt-5.6-sol · high |
| 대량 작업·단순 리뷰 | gpt-5.6-terra · medium |
| 코딩·QA·리서치·전수조사·잡무 | gemini-3.6-flash-high |

- effort 없이 Opus를 돌리지 않는다. 세션 기본 medium을 유지한다.
- `/model`·`/effort`는 프롬프트 캐시를 무효화한다. 한 턴에 반복 전환하지 않는다.
- 이 표가 세 규칙 파일 간 단일 기준이다. 어긋나면 이 표가 우선.

## 6. 실패 처리

- 재시도 가능(타임아웃·일시적 5xx·네트워크): 최대 3회, 백오프 10s→20s→60s.
- 같은 작업 2회 실패: 모델을 한 단계 올려 1회 재시도. 그래도 실패하면 대표 보고.
- 게이트 반려 3회 연속: 구현이 아니라 계획이 틀린 것으로 보고 계획부터 다시 짠다.
- **쿼터 소진(Codex 또는 agy): Claude가 대신 하지 않는다.** 큐를 멈추고 §9로 보고한 뒤 대기한다. 쿼터는 시간이 지나면 회복되므로 기다리는 것이 손해가 아니다.
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

작업 완료·위임·게이트 결과·차단·대표 판단 필요·큐 소진 시 보고한다. `AskUserQuestion` 전에 반드시 먼저 보고하고 `sent`를 확인한다. 실패 시 1회 재시도, 두 번 실패하면 화면에 원문을 남기고 대기한다. 기술 로그·파일명·도구명은 본문에 쓰지 않는다.

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

규칙 파일(CLAUDE/AGENTS/GEMINI/docs) 수정 시 즉시 커밋. 세 파일 삭제·이름변경 금지.
다른 파일 섹션 참조 시 번호와 제목을 병기한다.

## 환경 상수

- Dev: `k-bestie-v3-dev` / k-bestie-v3-dev.vercel.app / Supabase `mkrsaaedxqrcrktapaus`
- Prod: `k-bestie-v3` / app.k-bestie.com / Supabase `fetvnhhjicndmxvhrffk`
- 리포: `/mnt/e/VibeCoding/K-Bestie-v3` (Windows 10 + WSL Ubuntu)
- agy: `/home/home/.local/bin/agy`
