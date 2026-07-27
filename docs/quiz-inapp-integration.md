# 퀴즈마스터 인앱(QuizPlayScreen) 기능 이식 — API 계약 매핑 (⛔ SUPERSEDED, 이력 보존용)

작성일: 2026-07-26 (최초) / 갱신: 2026-07-26 / **폐기: 2026-07-27**

> # ⛔ 이 문서의 결론은 뒤집혔다 — 현재 구조를 알고 싶다면 여기서 멈출 것
>
> 아래 §0은 "독립 Quiz 저장소를 폐기하고 K-Bestie-v3 인앱 구현을 유일한 정본으로
> 삼는다"고 선언하지만, **2026-07-27에 정확히 반대로 확정됐다.**
>
> **현재 정본 구조:**
> - 퀴즈마스터의 유일한 정본은 **독립 Quiz 저장소 + 독립 Vercel 배포**다(`req04.md` 원칙).
>   "독립 저장소 폐기"는 취소됐고, 저장소는 아카이브에서 복원됐다.
> - 사용자 진입 경로 `/play/quiz`는 **same-origin 리버스 프록시**로 그 배포에 연결된다
>   (`middleware.ts` → `app/api/quiz-proxy/[[...path]]/route.ts`). iframe이 아니다.
> - 이 문서가 서술하는 인앱 구현(`components/quiz/QuizPlayScreen.tsx`,
>   `lib/quiz/play/`, `app/api/quiz-play/*`)은 **2026-07-27에 전부 삭제됐다**(커밋
>   `c7a76e2`, 31개 파일). 따라서 §1~§4의 경로·파일 참조는 더 이상 존재하지 않는다.
>
> **여전히 유효한 부분:** handoff token 발급(`/api/quiz/start-handoff`),
> completion 콜백(`/api/quiz/completion`), refund 콜백
> (`/api/rewards/golden-key/refund`) 계약은 그대로 살아 있고 독립 Quiz 앱이 호출한다.
> 황금열쇠 차감·환불 소유권도 K-Bestie-v3에 그대로 남는다.
>
> **현재 구조의 정본 문서:** `PROJECT_STATUS.md`의
> "놀이 앱 아키텍처 최종 확정 — 퀴즈마스터 리버스 프록시" 항목,
> 그리고 `.omc/plans/quizmaster-resplit-plan.md`.
>
> 이 문서는 "어떤 API 계약이 어떻게 매핑됐는가"의 이력 기록으로만 남긴다.

## 0. (무효) 당시 방향 — 독립 저장소 폐기 (2026-07-26)

독립 퀴즈마스터 저장소(Quiz repo)는 더 이상 실사용자 진입점이 아니었고, 실사용자
테스트 검증까지 완료되어 **독립 저장소는 폐기됐다.** 실제 아이가 보는 화면인
K-Bestie-v3 내장 화면(`components/quiz/QuizPlayScreen.tsx`, `/api/quiz-play/*`,
requests/021)이 유일한 정본이다. **앞으로 퀴즈마스터 신규 개발은 K-Bestie-v3
기준으로만 진행한다.**

- 폐기 전 삭제 조건 6가지(자동 다음 문제 이동/이어하기/리더보드/결과 화면/진행 상태
  복원/황금열쇠 중복 차감 방지 + 실사용자 테스트 검증) 전부 통과 확인 완료.
- 폐기 전 의존성 확인 완료: K-Bestie-v3 코드/운영 앱(app.k-bestie.com) 어디에도
  독립 저장소·`quizmaster-dev.vercel.app`를 호출하는 코드/rewrite/환경변수가 없음을
  확인. 완료/환불 콜백은 K-Bestie-v3가 자기 자신을 호출하는 구조로 이미 완전히
  내재화되어 있어 외부 의존 없음.
- 폐기 조치: 독립 저장소는 원격이 전혀 없어(로컬 유일 사본) 삭제 전
  `github.com/markanitp-maker/quizmaster-legacy-archive`(private)로 전체 히스토리
  백업 후, 로컬 폴더 삭제 + `quizmaster-dev` Vercel 프로젝트 삭제 + 이제 쓰지 않는
  `QUIZMASTER_BASE_URL` 환경변수(K-Bestie-v3-dev, production/preview 전부) 제거
  완료. DB(`quiz_attempts`/`quiz_question_bank`/`quiz_leaderboard` 등)는 K-Bestie-v3와
  공유 자원이라 그대로 유지 — 삭제/초기화하지 않음. `MAIN_APP_REWARDS_API_KEY`는
  K-Bestie-v3 자체 콜백 인증에 계속 쓰이므로 유지.

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
