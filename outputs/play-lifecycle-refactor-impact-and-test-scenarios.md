# 케이 놀이 공통 생명주기 추출 — 영향 범위 분석 및 테스트 시나리오

작성일: 2026-07-25 / 작성 주체: 메인 Claude Code(직접 개발, claude-review 검증 대상)

## 배경

MBTI 네이티브 통합(`/play/mbti`, 커밋 413d3a7)에서 확정된 playSessionId 기반 세션
검증, 황금열쇠 차감(기존 인프라 재사용), progress_state 네임스페이스 저장, CAS
버전 가드, 이어하기, 완료 이벤트 구조를 **모든 놀이 타입이 재사용할 수 있는 공통
모듈**로 추출했다. 신규 기능 추가가 아니라 **기존 MBTI 코드의 순수 리팩터링**이며,
동작을 하나도 바꾸지 않는 것이 최우선 목표였다.

## 변경 파일

### 신규 (공통 인프라)

- `lib/play/sessionAuth.ts` — `loadPlaySession()`: playSessionId+play_type 조회,
  6시간 이어하기 창(resume_expires_at) 경과 확인, status='in_progress' 확인. 선택적
  `expectedChildId` 인자로 소유권 검증(만료/상태 검사보다 먼저 수행, GET
  /api/mbti/session의 원래 순서 보존).
- `lib/play/progressState.ts` — `readProgressStateObject`/`readNamespace`
  (안전한 JSONB 읽기), `buildProgressState`(네임스페이스 조립, 루트 필드 보존),
  `progressVersionCasColumn`/`namespaceNullColumn`(PostgREST 필터 표현식),
  `saveProgressWithVersionCas`(버전 CAS 저장 전체 흐름).
- `lib/play/completion.ts` — `completeInProgressSession()`: status CAS 전이
  (in_progress→completed), 완료 시각을 호출부가 계산해 넘겨받아 progress_state
  내부 값과 DB 컬럼 값이 정확히 일치하도록 보장.
- `docs/play-lifecycle.md` — 신규 놀이 타입 추가 절차 문서(구현 아님, 가이드).

### 수정 (동작 변경 없음, 내부 구현만 공통 모듈 사용으로 교체)

- `app/api/mbti/progress/route.ts`
- `app/api/mbti/session/route.ts`
- `app/api/mbti/complete/route.ts`

### 수정하지 않음 (영향 없음 확인)

- `app/api/play/{consume,reserve,start,session,progress,restart,callback/*,
  bug-report,refund-notification}` — [1] 계층(세션 생성/재화 차감), 이미 4종
  놀이가 공유하는 완성된 인프라라 손대지 않음.
- `components/mbti/*`, `app/play/mbti/page.tsx`, `app/child/play/page.tsx` — 화면
  계층, API 응답 계약이 그대로라 클라이언트 코드는 무관.
- `lib/api/{mbtiProgress,mbtiComplete,fetchMbtiSessionProgress}.ts` — 클라이언트
  fetch 계약, 서버 응답 shape이 동일하므로 변경 불필요.
- comic_book/quiz/hairstyle — 실제 게임 구현 자체가 없어(placeholder만 존재)
  영향받을 코드가 없음.

## 동작 동일성 보증 근거

원래 세 라우트의 로직을 한 줄씩 대조해 다음을 그대로 보존했다.

1. **세션 조회 조건**: `id`+`play_type='mbti'` 매치 — 동일.
2. **만료 판정**: `resume_expires_at` 없거나 경과 시 무효 — 동일(24시간 hard cap인
   `expires_at`이 아니라 6시간 `resume_expires_at`을 쓰는 것도 그대로).
3. **상태 판정**: `status !== 'in_progress'`면 무효 — 동일.
4. **라우트별 다른 HTTP 상태/메시지 계약**: progress/complete는 만료·상태오류 모두
   409, session(GET)은 모두 404 — `loadPlaySession`은 중립적인 reason만 반환하고
   실제 상태코드/메시지는 각 라우트가 그대로 결정하도록 설계해 이 차이를 보존했다.
5. **소유권 검증 순서**: GET /api/mbti/session은 원래 "존재 확인 → 소유권(403) →
   만료 → 상태" 순서였다 — 리팩터링 중 최초 시도에서 이 순서가 깨질 뻔했으나(만료
   검사를 먼저 하면 다른 아이의 만료된 세션에도 403 대신 404가 나가는 회귀),
   `loadPlaySession`에 `expectedChildId` 인자를 추가해 원래 순서를 그대로
   재현하도록 수정함(아래 검증 로그의 "WRONG childId" 케이스로 확인).
6. **progress_state 네임스페이스 병합**: 진행 저장은 완전 교체
   (`{...existing, mbti: nextState, progressPercent}`), 완료 처리는 기존
   네임스페이스 필드 보존 병합(`{...existingMbti, mbtiType, finalAnswers,
   completedAt}`) — 각각 원래 로직 그대로.
7. **CAS 조건**: 진행 저장은 `progress_state->mbti->>progressVersion` 일치(또는
   `progress_state->mbti IS NULL`) 매치 UPDATE, 완료는 `status='in_progress'` 매치
   UPDATE — 동일한 PostgREST 필터 표현식 재사용.
8. **완료 이벤트**: `isWinner`(원래 `isWinningCompletion`)일 때만
   `recordMbtiCompletionEvent()`를 `after()`로 논블로킹 호출 — 동일.

## 실행한 검증 (재현 가능, 전부 실제 API/DB/브라우저)

`npx next start`로 프로덕션 빌드를 띄운 뒤 실제 Dev DB(QA테스트 5학년,
childId `cde1b847-b1d2-4378-b337-b8cf4d532b00`)로 검증했다. 모든 항목이 리팩터링
**전**(커밋 413d3a7 시점)과 **후** 두 번 다 동일한 결과를 냈다.

| 항목 | 결과 |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npx next build` | PASS |
| 존재하지 않는 sessionId → 세 라우트 모두 `404 session_not_found` | PASS |
| 진행 저장 v1(답변1개) → `{applied:true,reason:"ok"}` | PASS |
| 동일 버전(v1) 재저장 → `{applied:false,reason:"stale_progress_version"}` | PASS |
| 진행 저장 v2(답변2개) → `{applied:true,reason:"ok"}` | PASS |
| **`GET session`을 틀린 childId로 호출 → `403 forbidden`(만료 여부와 무관하게 우선)** | PASS(리팩터링 중 발견한 순서 이슈를 수정 후 확인) |
| `GET session`을 올바른 childId로 호출 → v2 상태 정확히 재수화 | PASS |
| DB 직접 조회 — `progress_state`가 `{mbti:{...}, progressPercent:13}` 형태로 네임스페이스 분리 저장 | PASS |
| `complete` 호출 → `{completed:true,reason:"ok"}`, DB `status=completed`,
  `progress_state.mbti`에 `mbtiType/finalAnswers/completedAt` 병합, 루트
  `progressPercent=100` | PASS |
| 완료 후 재호출 → `409 session_not_in_progress`(원본과 동일한 가드 순서) | PASS |
| `mbti_completion_events`에 정확히 1행 기록 | PASS |
| 실제 브라우저 E2E(QA테스트 계정, 로그인→MBTI 카드→시작하기→16문항 전체 응답→결과 화면→닫기→`/child/play` 복귀) | PASS |
| `git diff` 범위 확인 — 의도한 4개 신규 파일 + 3개 라우트 수정 외 변경 없음 | PASS |

테스트 중 생성한 DB 행(k_play_sessions, mbti_completion_events)은 모두 삭제해
QA 계정을 원상 복구했다.

## claude-review 검증(별도 tmux 인스턴스, 읽기 전용) 및 반영한 수정

- 검토 결과: 체크 순서 보존, CAS 조건 동일성, completedAt 계산 방식, 다른 모듈
  영향 없음 전부 확인 — [통과]. [단순] 1건 지적, 반영함.
- **[단순→반영]** `saveProgressWithVersionCas`가 `storedVersion` 파라미터를
  `number | null`로 단순화하면서, 원본의 `storedVersion = storedProgress?.
  progressVersion ?? 0` 관용구(버전 비교는 항상 0 기본값)와 미묘하게 달라져
  `progressVersion<=0`인 요청이 **최초 저장(네임스페이스가 아직 없는 상태)**에
  한해 조기 거부되지 않고 실제로 DB에 쓰이는 엣지케이스를 발견했다. 정상 클라이언트
  (`components/mbti/QuestionScreen.tsx`)는 항상 1부터 증가시켜 보내므로 실사용
  경로에서는 도달하지 않지만, "동작을 하나도 안 바꾼다"는 목표에 어긋나 수정함 —
  버전 비교는 `requestVersion <= (storedVersion ?? 0)`으로 원복하고, CAS UPDATE의
  `.is`/`.eq` 필터 분기 선택에만 `storedVersion === null` 여부를 그대로 쓴다(두
  관심사를 분리). 수정 후 `tsc`/`build` 재확인 + 실제 API 호출로
  `progressVersion=0`이 신규 세션에서도 즉시 `stale_progress_version`으로 거부되고
  DB에 전혀 쓰이지 않음을 재검증했다(PASS).

## 남은 리스크 / 대표님 확인 불필요 항목

- comic_book/quiz/hairstyle에 실제로 이 공통 모듈을 적용하는 것은 이번 범위 밖이다
  (콘텐츠·화면 자체가 없음). `docs/play-lifecycle.md`가 그 시점의 가이드 역할을
  한다.
- `lib/play/mbtiSessionHandoff.ts`(세션ID sessionStorage 핸드오프)는 이번에
  일반화하지 않았다 — 두 번째 네이티브 게임이 실제로 생길 때 playType 매개변수를
  추가하는 편이 지금 미리 일반화하는 것보다 과설계 위험이 낮다고 판단했다.
