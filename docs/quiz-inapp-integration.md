# 퀴즈마스터 인앱(QuizPlayScreen) 기능 이식 — API 계약 매핑 및 완료 현황

작성일: 2026-07-26 (최초) / 갱신: 2026-07-26 (전체 기능 이관 완료, 대표 최종 결정 반영)

## 0. 최종 방향 (2026-07-26 대표 결정)

독립 퀴즈마스터 저장소(Quiz repo)는 더 이상 실사용자 진입점이 아니다. 실제 아이가
보는 화면은 K-Bestie-v3 내장 화면(`components/quiz/QuizPlayScreen.tsx`,
`/api/quiz-play/*`, requests/021)이며, **이 내장 화면이 지금부터 유일한 정본이다.**

- 독립 Quiz repo: **즉시 삭제하지 않고 임시 원본(참조용)으로 유지**. 신규 기능 개발은
  하지 않는다. DB(`quiz_attempts`/`quiz_question_bank`/`quiz_leaderboard` 등)는 두
  저장소가 공유하므로 그대로 둔다 — 삭제/초기화 대상 아님.
- **삭제 조건**(아래 6가지가 K-Bestie-v3 메인 앱에서 실사용자 테스트로 검증 완료된
  이후에만 archive 후 삭제):
  - [x] 자동 다음 문제 이동 — §2-A, 구현 완료
  - [x] 이어하기(재접속) — §2-C, 구현 완료
  - [x] 리더보드 — §2-B, 구현 완료
  - [x] 결과 화면 — 기존 존재 + 리더보드 병합 완료
  - [x] 진행 상태 복원 — `initialAttemptId` hydrate 경로, 기존 구현이 이어하기 연결로
        실제로 도달 가능해짐(§2-C 덕분)
  - [x] 황금열쇠 중복 차감 방지 — §2-C, 구현 완료
  - [ ] **실사용자 테스트 검증** — 코드 구현은 완료됐으나 실제 기기로 아직 검증 전.
        이 항목이 통과해야 삭제 조건이 완전히 충족된다.

## 1. API 계약 비교

두 저장소 모두 `/api/quiz*` 아래에 사실상 동일한 라우트를 갖고 있다(과거 requests/021
포팅 때 옮겨짐) — 이름공간과 게이트1 인증만 다르고 나머지는 동일하다.

| 기능 | Quiz(독립) 경로 | quiz-play(내장) 경로 | 상태 |
|---|---|---|---|
| 시작 | `POST /api/quiz/start` | `POST /api/quiz-play/start` | 기존 포팅 완료 |
| 재수화 | `GET /api/quiz/attempt/{id}` | `GET /api/quiz-play/attempt/{id}` | 기존 포팅 완료 |
| 진행저장 | `POST /api/quiz/progress` | `POST /api/quiz-play/progress` | 기존 포팅 완료 |
| 제출 | `POST /api/quiz/submit` | `POST /api/quiz-play/submit` | 기존 포팅 완료 |
| heartbeat/background | `POST /api/quiz/{heartbeat,background}` | `POST /api/quiz-play/{heartbeat,background}` | 기존 포팅 완료 |
| 리더보드 | `GET /api/quiz/leaderboard` | `GET /api/quiz-play/leaderboard` | **신규 포팅 완료** |
| 재접속 조회 | `GET /api/quiz/attempt/active` | `GET /api/quiz-play/attempt/active` | **신규 포팅 완료** |
| 재접속(claim) | `POST /api/quiz/attempt/{id}/claim` | `POST /api/quiz-play/attempt/{id}/claim` | **신규 포팅 완료** |

게이트1(신원 확인) 모델은 두 저장소가 다르지만 의도적으로 그렇게 포팅돼 있다
(`lib/quiz/play/auth.ts` 상단 주석): 독립 앱은 퀴즈마스터 전용 Supabase 세션(storageKey
분리), 내장 모듈은 K-Bestie 자신의 로그인 세션을 그대로 쓴다. `quiz_attempts.user_id`는
두 경로 모두 부모/가족 계정 id로 동일한 의미라 로직 변경 없이 포팅 가능했다. 게이트2
(attempt 소유권 + 기기잠금 + 6시간만료)는 이미 100% 동일하게 포팅돼 있었다.

## 2. 화면(QuizPlayScreen.tsx) 쪽 이식 내역

### 2-A. 자동 다음 문제 이동 — 완료

Quiz repo `QuizPlayClient.tsx`의 `AUTO_ADVANCE_FEEDBACK_MS`(500ms) + `isAdvancing` 락 +
async `handleSelectOption`("선택→짧은 피드백→자동 다음 이동, 마지막 문항이면 자동 제출")
을 그대로 포팅. `handleSubmit`은 `answersOverride` 파라미터를 받도록 리팩터링(자동 제출
경로와 수동 제출-확인 모달 경로가 공유).

### 2-B. 리더보드 결과 표시 — 완료

`phase === "submitted"` 블록에 `GET /api/quiz-play/leaderboard`(§1) 호출 + 순위 목록
렌더링 추가. 실패 시 `null`로 두고 섹션만 비우는 관용구 그대로 이식.

### 2-C. 이어하기(재차감 없는 재접속) — 완료

애초에 문제였던 것: `app/child/play/page.tsx`가 quizmaster의 "시작하기"/"이어하기"를
구분하지 않고 매번 `POST /api/quiz/start-handoff`를 호출해 매번 황금열쇠를 차감했다
(진행 중 attempt가 있어도 재차감). 아래처럼 해결:

1. **`app/api/play/session/route.ts`**(놀이 목록 공용 이어하기-여부 조회 라우트) —
   `play_type === "quizmaster"`일 때는 기존 `k_play_sessions` 조회(quizmaster는 이
   테이블에 쓰지 않으므로 항상 빈 결과였음) 대신 `quiz_attempts`를 직접 조회하는 분기
   추가(`checkQuizmasterResume`, 독립 앱의 `/api/quiz/attempt/active`와 동일한
   in_progress|background + 6시간 조건). 다른 놀이 타입은 완전히 그대로.
2. **`app/child/play/page.tsx`** — 위 조회 응답의 `sessionId`(attemptId)를
   `resumeAttemptId` state로 보관. `handleResume`의 quizmaster 분기를 `start-handoff`
   호출에서 `POST /api/quiz-play/attempt/{resumeAttemptId}/claim` 호출로 교체 — claim은
   순수 재인증이라 황금열쇠 테이블을 전혀 건드리지 않는다. 성공 시
   `writeQuizSessionHandoff({ token: "", childId, attemptId: resumeAttemptId })`로
   attemptId를 채워 `/play/quiz`로 이동한다(`token`은 이 경로에서 `QuizPlayScreen`이
   전혀 읽지 않으므로 빈 문자열로 충분 — `initialAttemptId`가 있으면 redeem 자체를
   건너뛰기 때문).
   `handleStart`(새로 시작하기)는 변경하지 않음 — 항상 `start-handoff`로 새로 차감.

이로써 이어하기 경로에서는 황금열쇠 관련 코드가 아예 호출되지 않는다(차감 트리거
지점/조건 자체를 바꾼 게 아니라, 이어하기 경로가 그 트리거를 호출하지 않도록 진입
분기를 바꾼 것 — `/api/quiz/start-handoff`/`/api/quiz/completion`/
`/api/rewards/golden-key/refund` 계약은 전부 무변경).

## 3. 변경 없이 유지되는 것

- Quiz(독립) 프로젝트의 모든 API/비즈니스 로직 — 아무것도 수정하지 않음.
- `app/api/quiz/start-handoff`의 차감 트리거 조건 자체(호출되면 차감) — 변경 없음.
- `/api/quiz/completion`, `/api/rewards/golden-key/refund` 콜백 계약 — 변경 없음.
- `app/api/quiz-play/redeem/route.ts` — 변경 없음(claim 경로는 redeem을 거치지 않음).

## 4. 구현 범위 (완료)

1. `app/api/quiz-play/leaderboard/route.ts` 신규.
2. `app/api/quiz-play/attempt/active/route.ts` 신규.
3. `app/api/quiz-play/attempt/[attemptId]/claim/route.ts` 신규.
4. `lib/quiz/play/api-contracts.ts` — `QUIZ_LEADERBOARD_PATH`, `QuizLeaderboardResponse`,
   `QUIZ_ATTEMPT_ACTIVE_PATH`, `QuizAttemptActiveResponse`, `quizAttemptClaimPath` 추가.
5. `components/quiz/QuizPlayScreen.tsx` — 자동 다음 문제 이동, 리더보드 추가.
6. `app/api/play/session/route.ts` — quizmaster 전용 조회 분기 추가.
7. `app/child/play/page.tsx` — quizmaster `handleResume`을 claim 기반으로 교체.

## 5. 검증 상태

- [x] 타입 검사(`tsc --noEmit`) 통과.
- [ ] 실사용자 테스트: 새 게임 시작(정상 차감 1회), 진행 중 이탈 후 재진입(이어하기
      표시 + 재차감 없음 + 정확한 문제 위치부터 재개), 자동 다음 문제 이동, 제출 후
      리더보드 표시, 6시간 만료 후에는 새로 시작 처리, completion/refund 콜백 무회귀.
      **§0 삭제 조건의 마지막 항목 — 아직 통과 전.**
- 참고: 이 저장소의 `next build` 전체 빌드는 이번 변경과 무관하게 사전부터 실패하는
  환경 이슈가 있음(별도 확인 필요, `tsc --noEmit`으로 타입 정합성은 확인함).
