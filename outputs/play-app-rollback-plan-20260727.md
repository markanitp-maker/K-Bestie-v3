# 놀이(MBTI/퀴즈마스터) 독립 앱 + iframe 모달 롤백 계획

작성일: 2026-07-27
상태: **분석 전용 — 코드 제거·파일 삭제·DB 변경 없음. 실행은 이 문서 보고 후 별도 명시 승인 필요.**
안전 보존: 현재 HEAD는 브랜치+태그 `pre-play-rollback-snapshot-20260726`(커밋 `72ace57`)로 보존됨.

---

## 핵심 요약 (먼저 읽을 것)

| 항목 | 애초 추정 | 실측 |
|---|---|---|
| 제거 대상 줄 수 | 약 3,472줄 | **약 8,703줄** (2.5배 — MBTI 문항뱅크 `lib/data/questionBank.ts` 2,326줄 등 콘텐츠 파일이 누락돼 있었음) |
| 유지 대상(얇은 계층) | 약 350줄 | 501줄 + `app/api/play/*` 827줄 + `lib/play/*` 346줄 |
| 제거 대상 파일 수 | — | 47개(코어) + 10개(데이터/훅/헬퍼) |

**가장 위험한 지점 3가지:**

1. **퀴즈마스터 독립 앱이 이미 삭제됐다.** `/mnt/e/VibeCoding/Quiz`는 git 저장소가 없는 빈 껍데기(`.omc/`, `req01.md`, `req02.md`만 존재). 커밋 `8dcf3f4`("legacy standalone repo decommissioned")가 삭제를 확정하고 `QUIZMASTER_BASE_URL` 환경변수까지 Production/Preview 양쪽에서 제거했다. **"독립 앱 유지"라는 전제 자체가 퀴즈에는 이미 성립하지 않는다.** 백업은 private GitHub(`markanitp-maker/quizmaster-legacy-archive`, master 브랜치, 마지막 push 2026-07-26T05:39:14Z)에 존재 — 복원은 가능하나 저장소 clone + Vercel 프로젝트 재생성 + 배포 검증이 선행돼야 한다.
2. **퀴즈는 iframe 모달을 가진 적이 없다.** 과거 구현은 `window.location.href = redirectUrl`(전체 페이지 외부 이동)이었다 — 이게 정확히 "모바일 PWA에서 주소창 노출" 문제의 원인이었고, 그래서 네이티브 포팅(021)이 시작됐다. 되돌릴 이전 구현이 없으므로 이건 롤백이 아니라 **신규 개발**(postMessage 프로토콜 설계 + 독립 앱 CSP 헤더 + 핸드셰이크 수신부 전부 새로 만들어야 함).
3. **`8c9ab6c`(completion/refund URL 폴백 수정)는 "계약 계층"이 아니라 제거 대상 파일(`lib/quiz/play/rewardsCallback.ts`) 안에 있다.** 콜백 수신측 라우트(`/api/quiz/completion`, `/api/rewards/golden-key/refund`)는 애초에 미수정이므로 자동 보존되지만, "폴백 로직 자체를 유지하라"는 요구는 이 형태로는 충족 불가능 — 리스크가 독립 앱의 outbound base URL 설정으로 그대로 이동한다.

**MBTI는 상대적으로 저위험** — 독립 앱(`/mnt/e/VibeCoding/mbti`)이 살아있고 최신(커밋 `d00412c` 등, 2026-07-25/26), iframe 임베딩 준비 완비(`next.config.mjs`의 `frame-ancestors` 단일 오리진, `lib/playMessage/checkEmbeddingAncestor.ts`), 그리고 **되돌릴 이전 iframe 구현이 커밋 히스토리에 온전히 남아 있다**(`e6f1dff`, 172줄 프로토콜 + 526줄 부모 컨테이너, origin 체크·source 체크·세션ID 일치·15초 INIT_ACK 타임아웃 자동환불 전부 검증된 구현).

**대표님이 결정해야 할 것 (아래 Open Questions 참고, 특히 Q1이 나머지를 좌우함):** 퀴즈마스터 저장소를 아카이브에서 복원할지, 아니면 이번엔 MBTI만 롤백하고 퀴즈는 네이티브 유지할지.

---

## 1. 커밋 타임라인 (`413d3a7`/`f191b5b` 전후)

| 커밋 | 날짜 | 의미 |
|---|---|---|
| `e97c9e7` | 07-24 | 놀이 런처/황금열쇠 소비·환불/버그신고 인프라 (`/api/play/*`, `lib/play/protocol.ts` 172줄) |
| **`e6f1dff`** | 07-24 | **공통 놀이 런처에 MBTI iframe/postMessage 연동** ← 부활 기준점 |
| `413d3a7` | 07-25 | MBTI 네이티브 통합 시작. `protocol.ts`에서 163줄 삭제, `app/play/mock-mbti/page.tsx` 삭제 |
| `b485343` | 07-25 | MBTI 검증 로직 → 공통 놀이 생명주기 인프라 추출 |
| `7b992d0` | 07-25 | 200문항뱅크 + 세션당 20문항 균형 무작위 |
| `d5ac726` / `23bf734` | 07-25 | 문항 일러스트 연결, 스크린샷 동물 이미지 버그, 연속배치 방지 |
| `f191b5b` | 07-26 | 퀴즈마스터 네이티브 통합 시작 |
| `8c9ab6c` | 07-26 | completion/refund 자기호출 URL 폴백 수정 (`VERCEL_URL` 2차 폴백) |
| `40434fb` | 07-26 | MBTI 로고·마스코트 연결 + 스크린샷 캡처 버그 |
| `b1f7249` | 07-26 | 골드키 재접속 이중차감 수정 + 리더보드/자동진행 인앱 포팅 |
| `2228929` | 07-26 | 인앱 퀴즈 화면 K-Bestie 브랜딩 |
| `fd1a435` | 07-26 | MBTI 디자인토큰 + 모바일 UX |
| `c2672d3` | 07-26 | 학년확인화면 복원 |
| `5e17963` | 07-26 | 콘텐츠 밀도 증가, 네비 버튼 하단 고정 |
| `8dcf3f4` | 07-26 | **독립 Quiz 저장소 폐기(삭제) 문서화** |

---

## 2. 파일 3분류

### 완전 제거 대상 (약 8,703줄)

| 그룹 | 파일 | 줄 수 |
|---|---|---|
| MBTI 문항/콘텐츠 | `lib/data/questionBank.ts` | 2,326 |
| | `lib/data/typeProfiles.ts` / `mbtiTypes.ts` | 453 / 53 |
| MBTI UI | `components/mbti/*`(6개: MbtiPlayScreen 292, QuestionScreen 256, ResultScreen 188, ProgressErrorOverlay 132, ErrorScreen 89, ResultLoadingScreen 66) | 1,023 |
| MBTI API | `app/api/mbti/{session 216, complete 203, progress 155}` | 574 |
| MBTI 로직 | `lib/mbti/*`(selectQuestions 240, scoreResult 119, errorKinds 100, classifyProgressSaveError 47, autoClose 23 + 테스트 188) | 717 |
| MBTI 클라 헬퍼 | `lib/api/{mbtiProgress 219, fetchMbtiSessionProgress 98, mbtiComplete 96}` | 413 |
| MBTI 훅 | `hooks/{useResultScreenshot 239, useResultAutoClose 110}` | 349 |
| MBTI 리포트 | `lib/report/recordMbtiCompletionEvent.ts` | 45 |
| 퀴즈 UI | `components/quiz/QuizPlayScreen.tsx` | 711 |
| 퀴즈 API | `app/api/quiz-play/*`(11개 라우트) | 734 |
| 퀴즈 로직 | `lib/quiz/play/*`(17개 파일) | 1,155 |
| 라우트 래퍼 | `app/play/{mbti,quiz}/page.tsx` | 150 |

주의: `hooks/useResultScreenshot.ts`·`components/mbti/{QuestionScreen,ResultScreen}.tsx`는 **현재 미커밋 수정 상태**(`git status` M). 제거 전 이 변경분이 독립 앱에 반영됐는지 먼저 확인해야 유실이 없다.

### 유지 대상 (501줄 + 인프라)

| 파일 | 줄 수 | 역할 |
|---|---|---|
| `app/api/quiz/completion/route.ts` | 157 | 완료 콜백 (Bearer + Idempotency-Key) |
| `app/api/rewards/golden-key/refund/route.ts` | 123 | 환불 콜백 |
| `lib/quiz/handoffToken.ts` | 96 | handoff token 발급 |
| `lib/quiz/rewardCallbackAuth.ts` | 55 | 콜백 인증 |
| `app/api/play/*`(10개) | 827 | 범용 놀이 생명주기(consume/reserve/restart/session/progress/bug-report/refund-notification/callback×2) |
| `lib/play/{completion,progressState,sessionAuth,protocol}.ts` | 346 | 놀이 공통 |
| `supabase/migrations/20260744000000_quiz_refund_rpc.sql` | — | K-Bestie 소유 유일 quiz RPC |

### 변경 필요

| 파일 | 현재 | 필요 변경 |
|---|---|---|
| `app/child/play/page.tsx`(462줄) | `router.push("/play/mbti")` ×2, `router.push("/play/quiz")` ×2 | `e6f1dff`의 `MbtiGameScreen` iframe 컨테이너 부활 + 퀴즈용 신규 컨테이너 |
| `app/api/quiz/start-handoff/route.ts` | `{ token }` 반환 | `{ redirectUrl }` 또는 postMessage용 token — Q3 결정에 따라 |
| `lib/play/protocol.ts`(11줄) | 상수만 남음 | `e6f1dff` 172줄 버전 복원 + **QUIZ_\* 이벤트 신규 추가** |
| `lib/play/{mbti,quiz}SessionHandoff.ts` | sessionStorage page→page | iframe 전환 시 **전량 사장(死藏)**, 제거 대상 |
| `app/play/mock-mbti/page.tsx` | `413d3a7`에서 삭제됨 | dev 폴백 경로 재생성 필요 |

---

## 3. sessionStorage handoff의 운명과 iframe 토큰 전달 방식

`app/play/{mbti,quiz}/page.tsx`가 제거되면 두 handoff 모듈의 존재 이유가 소멸한다 — 둘 다 "같은 오리진 페이지 A → 페이지 B" 전송 전용이고, iframe은 cross-origin이라 sessionStorage를 공유하지 않는다. **전량 제거 대상.**

| 방식 | 트레이드오프 | 판정 |
|---|---|---|
| A. URL 쿼리(`?token=`) | 독립 앱 서버/Vercel 액세스 로그에 토큰 평문 기록. 현행 코드 주석이 명시적으로 이 이유로 거부한 방식 | ❌ |
| **B. postMessage(READY→INIT 핸드셰이크)** | 어떤 URL·로그에도 안 남음. `e6f1dff`에 이미 검증된 구현 존재(origin 체크 + `event.source` 체크 + 세션ID 일치 + 15초 INIT_ACK 타임아웃 자동환불) | ✅ **권장** |
| C. URL fragment(`#token`) | 서버 전송 안 됨(로그 안전)이나 프레임 내 스크립트가 `location.hash`로 읽을 수 있고 잔존 | △ 차선 |
| D. 3rd-party 쿠키 | 대표님이 쿠키 인증 명시적으로 배제. Safari ITP 등으로 신뢰성 낮음 | ❌ |

MBTI 독립 앱은 이미 B를 구현 중(`MBTI_INIT` 수신이 세션 획득의 유일한 경로). **퀴즈 쪽은 프로토콜 자체가 없다** — `QUIZ_*` 이벤트 7종 + 런타임 가드를 새로 설계해야 한다.

---

## 4. DB 영향 분석

**결정적 발견: quiz_\* 스키마의 DDL이 K-Bestie 마이그레이션 어디에도 없다.** `quiz_attempts`, `quiz_question_bank`, `quiz_handoff_tokens`, `quiz_bug_reports`, `quiz_leaderboard` 테이블과 관련 RPC 7종의 정의가 하나도 없다 — 형상관리 원본이 **삭제된 Quiz 저장소에만** 있었다. 유일한 K-Bestie 소유 quiz 마이그레이션은 `20260744000000_quiz_refund_rpc.sql`(`refund_gold_keys_by_consumption_id`)뿐.

| RPC/테이블 | 롤백 후 책임 | 비고 |
|---|---|---|
| `quiz_draw_questions`, `quiz_submit_attempt`, `quiz_apply_signal`, `quiz_enter_background`, `quiz_mark_refund_requested` | 독립 앱 전담 | K-Bestie 호출 제거 |
| `quiz_claim_handoff_entry`, `consume_quiz_handoff_token` | 독립 앱 전담 | K-Bestie는 발급만 |
| `quiz_handoff_tokens` | 양쪽(K-Bestie 발급 + 콜백 검증) | 유지 필수 |
| `gold_key_consumptions`, `refund_gold_keys_by_consumption_id`, `restore_gold_key_reservation` | K-Bestie 전담(황금열쇠 원장) | 유지 필수 |
| `k_play_sessions`, `consume_play_access`, `start_new_play_session`, `refund_play_session` | K-Bestie 전담(MBTI 경로) | 유지 필수 |
| `quiz_attempts` | 독립 앱 소유 + K-Bestie 읽기 ⚠️ | `app/api/play/session/route.ts:19`가 유지 대상인데 이 테이블을 읽음 — 교차 의존 |
| `quiz_leaderboard`, `quiz_question_bank`, `quiz_bug_reports` | 독립 앱 전담 | K-Bestie 호출 제거 |

**데이터 보존:** 스키마 변경 불필요(같은 Supabase 프로젝트, 호출 주체만 변경). 기존 컬럼/데이터 삭제 금지. **선제 조치 권고**: quiz_\* DDL을 프로덕션에서 덤프해 K-Bestie 마이그레이션에 additive-only로 기록(원본이 삭제된 저장소에만 있었다는 사실 자체가 상시 리스크).

---

## 5. 위험 지점 상세

**위험 1 — 퀴즈마스터 독립 앱 부재(치명, 전제 무효)**: §핵심요약 참고. 폐기 근거가 "6가지 조건 + 실사용자 테스트 전부 통과"였다는 점 — 대표님이 그 판단을 뒤집는 결정을 하는 셈.

**위험 2 — 퀴즈는 신규 개발**: 과거 진입 방식은 `window.location.href = redirectUrl`(외부 이동)이었고 이게 주소창 노출 문제의 원인 그 자체였다.

**위험 3 — `8c9ab6c`는 제거 대상 안에 있음**: `lib/quiz/play/rewardsCallback.ts::getSelfBaseUrl()`이 제거 그룹. 콜백 라우트 자체는 미수정이었으므로 자동 보존되나, 리스크가 독립 앱의 outbound URL 설정으로 이동. 검증 계획에 `completion_notified_at`/`completion_score` non-null 확인 필수(원래 실패가 무증상이었음).

**위험 4 — 콜백 계약 2개 병존**: MBTI 경로(쿠키 세션, 부모 프레임이 `/api/play/callback/*` 호출, `k_play_sessions` 원장) vs 퀴즈 경로(서버간 Bearer, `/api/quiz/completion`·`/api/rewards/golden-key/refund`, `gold_key_consumptions` 원장). 한 모달 컨테이너에 섞으면 인증 경계가 흐려짐 — 통일 여부 결정 필요(Q4).

**위험 5 — 토큰 개념 불일치**: MBTI는 `playSessionId`(`k_play_sessions`), 퀴즈는 `quiz_handoff_tokens` 1회용 토큰. 통일 여부 결정 필요(Q3).

**위험 6 — dev 환경 iframe 빈 화면**: `NEXT_PUBLIC_MBTI_APP_URL`은 Production에만 설정, dev/preview엔 없음. 폴백 대상 `/play/mock-mbti`는 `413d3a7`이 삭제함. MBTI 프로덕션 배포 존재 여부도 미확인.

**위험 7 — 병렬 세션 실시간 충돌**: 세션 시작 시 있던 `requests/feature-play-resume-session.md`가 분석 중 사라짐(다른 세션이 처리). 3개 파일 미커밋 상태. 브랜치는 `feat/family-backend`(main 아님).

**위험 8(좋은 소식) — MBTI는 저위험**: `/mnt/e/VibeCoding/mbti` 살아있고 최신(2026-07-25/26 커밋), iframe 준비 완비. 단 K-Bestie에서만 수정된 `40434fb`/`fd1a435`/미커밋 3파일이 독립 앱에 등가로 존재하는지 파일 단위 diff 필요.

---

## 6. 단계별 검증 계획

### Phase 0 — 제거 전 필수 확인 (하나라도 실패 시 중단)

| # | 확인 항목 | 통과 기준 |
|---|---|---|
| 0-1 | 병렬 세션 정지 + 브랜치 확정 | `git status --short --branch` 클린 |
| 0-2 | 아카이브 Quiz 저장소 복원 | `git clone` 성공 + `npm run build` 통과 |
| 0-3 | Quiz 앱 Vercel 재배포 | 배포 URL 200 응답 |
| 0-4 | `QUIZMASTER_BASE_URL` 재설정 | production + preview 양쪽 설정 확인 |
| 0-5 | quiz_\* DDL 프로덕션 덤프 → 마이그레이션 기록 | 12개 RPC + 5개 테이블 DDL 파일 존재(additive-only) |
| 0-6 | MBTI 프로덕션 배포 존재 확인 | 프로덕션 MBTI URL 200 |
| 0-7 | `NEXT_PUBLIC_MBTI_APP_URL` dev/preview 설정 | 3개 환경 전부 설정 |
| 0-8 | 콜백 계약 E2E(독립앱 → K-Bestie) | `gold_key_consumptions.completion_notified_at` **및** `completion_score` non-null |
| 0-9 | 환불 콜백 E2E | `status='refunded'` 전이 + `refunded_count > 0` |
| 0-10 | 네이티브 전용 수정분 독립앱 반영 확인 | `40434fb`/`fd1a435`/미커밋 3파일 diff 등가 구현 존재 |

### Phase 1 — iframe 컨테이너 추가(additive, 삭제 없음)

`lib/play/protocol.ts`를 `e6f1dff` 버전으로 복원 + `QUIZ_*` 추가, `app/play/mock-mbti/page.tsx` 재생성, `app/child/play/page.tsx`에 iframe 컨테이너를 **플래그 뒤에** 추가. 기존 `router.push` 경로는 그대로 남김.

### Phase 2 — 진입점 전환(되돌릴 수 있는 피벗)

플래그 ON, `QA테스트` 계정 검증: iframe 안에 주소창/브라우저 컨트롤 미노출(실기기), READY→INIT 핸드셰이크, 15초 타임아웃 자동환불, 골드키 이중차감 없음, 완료 콜백 기록, origin 위조 메시지 차단.

### Phase 3 — 프론트 라우트 제거(API보다 먼저)

`app/play/{mbti,quiz}/page.tsx` + `lib/play/{mbti,quiz}SessionHandoff.ts` 제거. **순서 근거**: API를 먼저 지우면 아직 살아있는 네이티브 화면이 즉시 깨져 롤백 여지가 사라짐.

### Phase 4 — UI/로직/콘텐츠 제거

`components/{mbti,quiz}/`, `lib/{mbti,quiz/play}/`, `lib/data/{questionBank,typeProfiles,mbtiTypes}.ts`, `lib/api/mbti*`, `hooks/useResult*`, `lib/report/recordMbtiCompletionEvent.ts`.

### Phase 5 — API 라우트 제거(마지막)

`app/api/{mbti,quiz-play}/`. `app/api/play/session/route.ts`의 `quiz_attempts` 참조(위험 4) 필요 여부 최종 판단.

### Phase 6 — 통합 검증

`claude-review` 통합 리뷰, MBTI/퀴즈 각 1회 완주 E2E, 황금열쇠 원장 정합성, 기존 기능 회귀.

---

## Missing Acceptance Criteria (제안)

1. 주소창 미노출 — 실기기 PWA 스크린샷 브라우저 크롬 0픽셀
2. 토큰 미노출 — 놀이 1회 완주 후 독립 앱 액세스 로그 grep 0건
3. 골드키 정합성 — `SUM(차감) = SUM(완료) + SUM(환불)`, 오차 0
4. 콜백 도달 — `completion_notified_at`/`completion_score` non-null 비율 100%
5. init 실패 자동환불 — 독립 앱 500 응답 시 15초 내 환불 확정
6. 데이터 무손실 — 롤백 전후 row count/컬럼 집합 동일
7. `next build` 통과(`tsc` 단독 불충분)
8. 코드 잔재 0 — `grep -rn "quiz-play\|/play/mbti\|/play/quiz" app components lib` 결과 0건

## Open Questions (대표님 결정 필요)

- [ ] **Q1. 삭제된 퀴즈마스터 저장소를 아카이브에서 복원할 것인가?** (A) 복원+재프로비저닝 (B) 퀴즈는 네이티브 유지, MBTI만 롤백 (C) 전체 보류 — **이 결정이 나머지를 좌우함**
- [ ] Q2. 퀴즈 iframe 프로토콜 신규 개발 여부(롤백이 아니라 신규 개발 규모임을 인지 필요)
- [ ] Q3. 토큰 개념 통일 여부(MBTI `playSessionId` vs 퀴즈 `quiz_handoff_tokens`)
- [ ] Q4. 완료/환불 콜백 계약 통일 여부(쿠키 인증 vs 서버간 Bearer)
- [ ] Q5. MBTI 프로덕션 배포 존재 확인(Vercel 직접 확인 필요)
- [ ] Q6. 롤백 시점 진행 중 세션(`in_progress`) 처리 정책
- [ ] Q7. quiz_\* DDL을 K-Bestie 마이그레이션에 기록할지(권고: 함)

## Recommendations (우선순위)

1. Q1을 먼저 결정 — 나머지 전부 종속
2. MBTI와 퀴즈를 분리된 작업으로 취급(MBTI 저위험·즉시 착수 가능, 퀴즈 고위험·신규 개발)
3. Phase 0을 독립 승인 게이트로 — 10개 항목 전부 통과 전 코드 한 줄도 삭제 안 함
4. quiz_\* DDL 덤프는 Q1과 무관하게 지금 확보(상시 리스크 제거)
5. "3,472줄" 추정치를 8,703줄로 교정
6. `8c9ab6c` 지시는 "독립 앱 outbound URL 설정 검증 + non-null 확인"으로 재해석
7. 병렬 세션 정지 + 브랜치 확정 후 착수
8. `40434fb`/`fd1a435`/미커밋 3파일이 `/mnt/e/VibeCoding/mbti`에 등가로 존재하는지 diff 확인
</content>
