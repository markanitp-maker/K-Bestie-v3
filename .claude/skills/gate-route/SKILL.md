---
name: gate-route
description: 2단 게이트 흐름과 [단순]/[복잡] 판단 기준, 정적·동적 검증 체크리스트를 제공한다. 구현이 끝나 게이트를 태우기 직전에 사용한다.
---

# 게이트 라우팅 및 검증 규칙

## 표준 작업 흐름 (2단 게이트)

**기본 원칙: 매 수정마다 게이트를 부르지 않는다.** 관련 기능 묶음(또는 큐 지시서 1건) 단위로 작업을 완료하고 **자체 테스트까지 마친 뒤**, 그 묶음 전체를 게이트에 올린다. 같은 묶음 안의 타입 오류·import 누락·UI 미세 조정·단순 버그는 개별 게이트 없이 모아서 처리한다.

**예외 — 아래 5종은 묶어두지 않고 발생 즉시 게이트 대상으로 올린다:** 아키텍처 변경 / 보안 관련 변경 / DB 스키마 변경 / 데이터 손실 가능성 변경 / 다른 모듈에 영향이 큰 변경.

```
① 계획 확정 (Opus 5 · xhigh)
   → 큐 지시서 또는 docs/plans/plan-<기능>.md 로 구현 범위 확정
   → 파일 경로 / 함수 시그니처 / 에러 처리 / 완료 조건 / 금지 파일 명시
   → "적절히", "필요하면" 같은 애매 표현 금지

② 개발 주체 결정 (Opus 5 · medium)
   ├─ 기본             → agy 코딩 위임 (10분 단위로 분할)
   └─ 복잡·아키텍처 민감 → Codex Sol이 설계·구현 계획 수립
                          → 그 계획대로 agy가 코딩

③ 자체 테스트 (기능 묶음 완료 후)
   → agy 구현분은 GEMINI.md §4-B 셀프검증 통과 후 반환
   → Codex 예외 구현분은 AGENTS.md §5 셀프검증 7항목 통과 후 반환

④ 게이트 ① — 정적 코드리뷰 (필수) ※ 담당 매핑은 CLAUDE.md §3 표를 따른다
   ├─ agy 문서·시드·스크립트·기계적 리팩터링 → fresh agy 세션 (--read-only)
   ├─ agy 비즈니스 로직·재화·인증·DB·보안   → Codex Terra
   ├─ agy 아키텍처·다중 모듈·데이터 손실 위험 → Codex Sol
   └─ Codex 구현분                          → Codex 별도 세션 (§3 표)
   → 산출물: [단순]/[복잡] 문제 목록 + [QA 인계] 시나리오
   ※ 등급 판단이 애매하면 한 단계 위로 올린다.

⑤ 게이트 ① 결과 분기
   ├─ [통과] → 게이트 ②로
   ├─ [단순 문제] → 개발 주체(agy)에게 되돌려 재수정 → 다시 ④
   └─ [복잡 문제] → Codex Sol이 재설계안을 내고 → agy가 그대로 수정 → 다시 ④

⑥ 게이트 ② — 동적 E2E QA (§4-D, 사용자 동작 영향 변경 시 필수)
   → agy QA 세션(Gemini 3.6 Flash High)이 Playwright로
     [QA 인계] 시나리오를 headless 실행, 스크린샷/로그 증거 저장
   ├─ [통과] → 완료
   ├─ [단순 실패] → 개발 주체(agy) 재수정 후 ④부터 재실행
   └─ [복잡 실패] → Codex Sol 재설계 → agy 수정 후 ④부터 재실행
   ※ 순수 내부 로직·문서·비-UI 변경은 QA 생략 가능(하드룰 5). 생략 시 _log.md에 사유 기록.

⑦ 재검증-수정 루프는 게이트당 최대 2회. 그래도 안 되면 CLAUDE.md §9로 대표 보고.
   게이트 반려가 3회 연속이면 구현이 아니라 계획이 틀린 것으로 보고 계획부터 다시 짠다.

⑧ 모든 기능 묶음 병합 후 → 전체 통합 게이트(필수)
   ├─ 통합 정적 리뷰: Codex Sol · high
   │   ※ 묶음에 Codex Sol 구현분이 포함돼 있으면 Sol이 자기 코드를 판정하지
   │      못하므로 Codex Terra + fresh agy(--read-only) 둘 다에 올린다(CLAUDE.md §3).
   └─ 통합 E2E QA: agy QA 세션이 핵심 사용자 플로우 회귀 실행

⑨ (하드룰 6, 필수) → Dev Vercel 배포. 격리 워크트리 + `vercel --prod`로
   k-bestie-v3-dev에 배포하고 alias/URL을 _log.md에 기록. 대표님께 배포
   여부를 묻지 않고 곧바로 진행한다.

⑩ 완료 → 큐 항목이면 `/queue-run` 처리 절차 3번(_done 이동 + _log 기록) 수행 후 1번으로 복귀
```

**단순 vs 복잡 판단 기준:**

- 단순: 타입 에러, 오타, import 누락, null/빈배열 방어 추가, 포맷, 단순 누락분. → 개발 주체(agy) 재수정.
- 복잡: 로직/알고리즘 오류, 아키텍처 문제, 여러 파일 얽힌 설계 결함, 같은 건 2회 실패. → Codex Sol이 재설계안을 내고 agy가 그대로 수정한다.
- **E2E QA 실패**: 화면이 안 뜸/버튼 무반응/재화 이중 차감 등 실제 동작 실패는 대개 [복잡]에 가깝지만, 원인이 단순 오타·null 누락이면 [단순]. 최종 분류는 QA 로그를 근거로 Claude가 판정한다(판정은 Claude 담당, 수정은 아니다).

## 게이트 규칙

### 4-A. 게이트① — 정적 코드리뷰 (읽기 전용)

담당 매핑은 CLAUDE.md §3 표를 따른다. Codex 호출은 `/codex:review`·`/codex:adversarial-review`로, agy 읽기형 리뷰는 relay `--read-only`로 한다(`/delegate-run`).

> **폐기(2026-08-13)** — 아래 tmux 명령은 폐기된 위임 통로다. 이력 보존용으로만 남긴다.

```bash
# [복잡] 리뷰 — Sol · high
TMPDIR_CODEX=$(mktemp -d) && chmod 700 "$TMPDIR_CODEX"
tmux new-session -d -s codex-rv-<target> "codex exec -s read-only --json \
  --model gpt-5.6-sol -c model_reasoning_effort=high \
  '<검증 지시문. AGENTS.md §11 체크리스트로 검토하고 §12-B 형식으로 보고하라. \
    [단순]/[복잡] 태그와 [QA 인계] 시나리오를 반드시 포함하라>' \
  2>&1 | tee $TMPDIR_CODEX/events.jsonl | tee /tmp/codex-rv-<target>.log; echo '__TASK_DONE__'"

# [단순] 리뷰 — Terra · medium (--model / effort만 교체)
#   --model gpt-5.6-terra -c model_reasoning_effort=medium

# 세션 ID 추출 → /tmp/codex-rv-<target>.codex-session-id (§3-A와 동일 로직)
```

- **리뷰 등급 판단**: 아키텍처·보안·DB 스키마·데이터 손실 가능성·다중 모듈 영향 중 하나라도 걸리면 `[복잡]`(Sol). 그 외 단일 기능·UI·타입 수준이면 `[단순]`(Terra). 애매하면 Sol을 쓴다.
- **셀프 통과 금지 확인**: 만든 주체가 자기 결과물을 검증·통과시킬 수 없다. 같은 워커라도 세션이 달라야 한다. Codex Sol이 예외적으로 직접 구현한 건은 Codex Terra와 fresh agy(`--read-only`) **둘 다**에 올린다(CLAUDE.md §3).
- **Codex 미가용(쿼터 소진)이면 Claude가 대신 리뷰하지 않는다.** 큐를 멈추고 CLAUDE.md §9로 보고한 뒤 대기한다(`/failure-handling` §12-E).
- 결과를 [통과] / [단순 문제 목록] / [복잡 문제 목록] + [QA 인계] 시나리오로 분류해 위 ⑤에서 분기한다.
- **주의(2026-07-22 실측):** 이 codex CLI 버전에서 `-p`는 프롬프트가 아니라 `--profile`이다. 프롬프트는 위치 인자로 전달하고, 읽기전용 강제는 `-s read-only`를 쓴다. `--read-only`나 `-p '<프롬프트>'` 형태는 인자 에러로 즉시 실패한다.
- **`--model`·`-c model_reasoning_effort` 표기는 최초 1회 `codex exec --help`로 확인한 뒤 사용한다.** 위 `-p` 사고와 동일 유형의 실패를 방지한다. 확인 결과가 다르면 이 문서를 즉시 수정하고 커밋한다(CLAUDE.md §11).

### 4-B. 게이트① — claude-review (폐기)

> **폐기(2026-08-13)** — Claude는 오케스트레이션 전용이며 직접 리뷰하지 않는다(CLAUDE.md §0 하드룰 1, §1). Codex Sol 구현분의 게이트①은 Codex Terra + fresh agy(`--read-only`)가 맡는다(§3 표). 아래는 이력 보존용이다.

```bash
tmux new-session -d -s claude-review-<target> "claude -p \
  '<검증 지시문 + §5 체크리스트>. 읽기 전용으로 검토만 하고 파일을 수정하지 마라. \
   결과를 [통과] 또는 [단순]/[복잡] 태그를 붙인 문제 목록으로 출력하고, [QA 인계] 시나리오를 덧붙여라.' \
  --permission-mode plan --model opus 2>&1 | tee /tmp/claude-review-<target>.log; echo '__TASK_DONE__'"

# [단순] 리뷰 폴백 — Sonnet 5 · low (§4-C, Codex 쿼터 소진 시)
#   --model opus  →  --model sonnet 으로 교체
#   세션명은 claude-review-simple-<target> 으로 구분해 로그가 섞이지 않게 한다.
```

- `--permission-mode plan`으로 읽기 전용을 강제한다.
- 이 로그가 없으면 메인 Claude 개발분·Codex Sol 개발분은 완료 처리할 수 없다(하드룰 2·3). *(폐기 — 현행은 §3 표의 담당이 남긴 리뷰 결과가 그 역할을 한다.)*
- **advisor는 게이트가 아니다.** `/advisor`는 게이트①을 대체하지 못하며, 구현·설계 중 판단 지점의 자문용으로만 쓴다. advisor 호출은 advisor 모델 요율로 별도 과금되므로 기본 비활성으로 두고, 아키텍처 전환·난제 디버깅 구간에서만 켜고 끝나면 `/advisor off`.

### 4-C. 워커 가용성

- Codex는 설계·분석·대량 작업·정적 코드리뷰 주체다. 1차 코딩 주체는 agy다(CLAUDE.md §1).
- **쿼터 소진 시 Claude가 대신 하지 않는다.** Codex든 agy든 한도에 걸리면 큐를 멈추고 CLAUDE.md §9로 보고한 뒤 대기한다. 쿼터는 시간이 지나면 회복되므로 기다리는 것이 손해가 아니다(`/failure-handling` §12-E).
- 호출 실패 시 `_log.md`에 "<워커> 미가용 — 대기"로 1줄 기록한다. 대체 주체로 갈아타지 않는다.
- 폴백 경로(구현·리뷰를 Claude가 떠맡는 경로)는 v14에서 삭제됐다.

### 4-D. 게이트② — 동적 E2E QA (agy Playwright)

실행형 QA는 relay 일반 모드 + 격리 워크트리로 보낸다. 산출물 경로는 `e2e/`와 `/tmp/agy-qa-<target>/`로 한정하고 "제품 코드를 수정하지 마라"를 브리프에 명시한다(CLAUDE.md §2-B). 시나리오가 많으면 10분 단위로 쪼개 병렬로 보낸다.

> **폐기(2026-08-13)** — 아래 tmux 명령은 폐기된 위임 통로다. 지시문 내용은 브리프 작성 시 그대로 참고한다.

```bash
tmux new-session -d -s agy-qa-<target> "timeout <600~1800> agy --dangerously-skip-permissions \
  --add-dir /mnt/e/VibeCoding/K-Bestie-v3 \
  --model='Gemini 3.6 Flash (High)' \
  -p 'QA 전용 세션이다. GEMINI.md §5를 따른다. 코드를 수정하지 마라(읽기 + 테스트 실행만). \
      [QA 인계] 시나리오: <게이트①이 남긴 시나리오>. \
      Playwright로 이 시나리오의 E2E 테스트를 작성·실행하고(headless), \
      실패 시 스크린샷/로그를 /tmp/agy-qa-<target>/ 에 저장하라. \
      결과를 GEMINI.md §5.5 형식([QA 통과] 또는 [QA 실패: 시나리오/원인/증거경로])으로 보고하라. \
      검증하지 않은 항목을 통과로 표기하지 마라 — 미검증은 [미검증]으로 명시하라.' \
  2>&1 | tee /tmp/agy-qa-<target>.log; echo '__TASK_DONE__'"
```

- **대상**: 사용자 동작(로그인/버튼/화면 전이/재화 차감 등)에 영향을 주는 변경(하드룰 6).
- **입력**: 게이트①에서 남긴 `[QA 인계]` 시나리오.
- **세션 분리 원칙**: agy 구현·잡무 세션과 QA 세션은 별개로 띄운다. agy가 손댄 코드를 같은 agy 세션이 QA하지 않는다(CLAUDE.md §0 하드룰 3).
- **QA 세션은 제품 코드를 수정하지 않는다.** 테스트 코드 작성·실행·증거 저장까지만. 실패가 나오면 개발 주체(agy)에게 되돌린다.
- **증거 필수**: 실패 시 스크린샷/로그를 `/tmp/agy-qa-<target>/`에 남겨 CLAUDE.md §9 보고 근거로 쓴다. 증거 없는 "정상 동작 확인" 보고는 통과로 인정하지 않는다.
- Playwright 미설치 시 `docs/ops/playwright-setup.md`의 절차를 수행한 뒤 진행한다. 테스트 계정은 `QA테스트`만 사용한다(CLAUDE.md §2-B).

## 검증 체크리스트 요약

> 전문은 **AGENTS.md §11**이다. 아래는 게이트① 브리프를 쓸 때 참조하는 요약본이며, 두 문서가 어긋나면 AGENTS.md §11이 우선한다.

- AI SDK는 `@google/genai`만 사용 (구버전 `@google/generative-ai`·REST 직접 호출 금지)
- **병렬 호출은 `Promise.allSettled` 필수 — `Promise.all` 금지**
- `responseMimeType` 사용 금지 / JSON은 스키마 강제 + `extractJSON` 파싱
- AI 키에 `NEXT_PUBLIC_` 접두사 금지
- Supabase 테이블은 anon/authenticated에 GRANT ALL
- **`src/` 디렉터리 생성 금지**
- 요청된 파일만 수정 / DB 스키마와 코드 컬럼 일치(없는 컬럼 조회로 조용히 실패하는 패턴 색출)
- 미완성 구현·엣지케이스(null/빈배열/레이스)·로직 오류 점검, 하드코딩 스텁·TODO 잔존 확인
- `docs/conventions.md`의 실제 구조·타입 위치·API 응답 포맷·네이밍과 일치
- 큐 지시서의 `## 범위` 밖 파일이 수정되지 않았는지 확인
- 정적 리뷰 산출물에 `[QA 인계]` 시나리오 포함 — 사용자 동작 영향 변경이면 게이트②로 넘길 시나리오를 1~3줄로 명시(없으면 "없음").
