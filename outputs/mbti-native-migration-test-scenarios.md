# MBTI 네이티브 통합(/play/mbti) 테스트 시나리오

작성일: 2026-07-25 / 작성 주체: 메인 Claude Code(직접 개발, claude-review 검증 대상)

## 배경

별도 저장소(`/mnt/e/VibeCoding/mbti`)의 iframe+postMessage 기반 MBTI 앱을
K-Bestie-v3 메인 앱 `/play/mbti` 네이티브 라우트로 완전 통합했다. 인증은
Supabase Auth 쿠키가 아니라 별도 저장소 commit `c6080b3`에서 확정한
playSessionId 기반 DB 세션 검증 패턴을 그대로 유지한다. MBTI 상세 진행
상태는 `k_play_sessions.progress_state.mbti` 네임스페이스에 저장해 다른
놀이 타입이 공유하는 루트 `progressPercent` 필드와 충돌하지 않는다.

## 변경 파일 요약

- 신규: `app/api/mbti/{progress,session,complete}/route.ts`
- 신규: `app/play/mbti/page.tsx`, `components/mbti/MbtiPlayScreen.tsx`(신규 작성)
- 포팅(대부분 원본 그대로): `components/mbti/{QuestionScreen,ResultScreen,ResultLoadingScreen,ProgressErrorOverlay,ErrorScreen}.tsx`,
  `lib/data/{questionBank,mbtiTypes,typeProfiles}.ts`, `lib/mbti/{scoreResult,errorKinds,autoClose,classifyProgressSaveError}.ts`,
  `lib/api/{mbtiProgress,fetchMbtiSessionProgress,mbtiComplete}.ts`, `lib/report/recordMbtiCompletionEvent.ts`,
  `hooks/{useResultScreenshot,useResultAutoClose}.ts`
- 수정: `app/child/play/page.tsx`(iframe `MbtiGameScreen`/`getRealMbtiUrl` 제거, MBTI 선택 시
  `/play/mbti`로 라우팅), `lib/play/protocol.ts`(MBTI postMessage 전용 타입 제거, `PLAY_KEY_COSTS`/
  `AUTO_REFUND_STAGES`만 유지), `app/globals.css`(MBTI 로딩 연출 keyframes 추가)
- 삭제: `app/play/mock-mbti/page.tsx`(iframe 테스트용 mock, 더 이상 아무도 참조하지 않음)
- 신규 의존성: `html-to-image`(결과 카드 스크린샷 저장 기능 유지용)
- 마이그레이션 이관 기록: `supabase/migrations/20260723150000_mbti_completion_events.sql`
  (테이블은 별도 저장소가 2026-07-23 Dev에 이미 생성 완료 — 재실행 아님, 이력 추적용 복사)

## 자동 검증 완료 (이번 세션에서 실제 실행)

- `npx tsc --noEmit`: 통과
- `npx next build`: 통과, `/play/mbti` 및 `/api/mbti/{progress,session,complete}` 라우트 정상 빌드
- 로컬 dev 서버(port 3012) + 실제 Dev DB(QA테스트 childId `cde1b847-b1d2-4378-b337-b8cf4d532b00`)에
  DB row를 직접 생성해 아래 항목을 실제 HTTP 호출로 검증:
  1. 존재하지 않는 sessionId → `progress`/`session`/`complete` 모두 `404 session_not_found` (PASS)
  2. 진행 저장 v1(답변 1개) → `{applied:true, reason:"ok"}` (PASS)
  3. 동일 progressVersion(1) 재저장 → `{applied:false, reason:"stale_progress_version"}` (PASS, CAS 가드 확인)
  4. 진행 저장 v2(답변 2개) → `{applied:true, reason:"ok"}` (PASS)
  5. `GET session` 재수화 → v2 상태(answers 2개, progressVersion 2) 정확히 반환 (PASS)
  6. DB 직접 조회로 `progress_state` shape 확인 → `{mbti:{...}, progressPercent:13}` — 루트
     `progressPercent`와 `mbti` 네임스페이스가 분리 저장됨 확인 (PASS, 네임스페이스 요구사항 충족)
  7. `complete` 호출(mbtiType=INFP) → `{completed:true, reason:"ok"}`, DB에서 `status=completed`,
     `progress_state.mbti`에 `mbtiType/finalAnswers/completedAt` 병합 저장, 루트 `progressPercent=100`
     확인 (PASS)
  8. 완료 후 재호출(같은 세션) → `409 session_not_in_progress`(이미 종료된 세션 재완료 방지, 원본
     계약과 동일한 가드 순서) (PASS)
  9. `mbti_completion_events`에 child_id/session_id/mbti_type 정확히 1행 기록 확인 (PASS)
  10. `resume_expires_at`(6시간 이어하기 창) 경과 세션에 진행 저장 시도 → `409 session_not_in_progress`
      (PASS, 6시간 세션 만료 요구사항 충족)
  - 테스트 후 생성한 DB 행(k_play_sessions, mbti_completion_events)은 모두 정리(DELETE) 완료.

## 미실행 — 실제 브라우저 E2E (대표님 확인 필요 항목)

아래는 로그인 세션(부모/자녀 실제 쿠키)과 실제 브라우저 렌더링이 필요해 이번 세션에서
자동 실행하지 못했다. QA테스트 계정으로 브라우저 기반 검증이 필요하다.

1. `/child/play`에서 MBTI 카드 클릭 → "시작하기" → `/play/mbti`로 정상 이동하고 문항 1이 표시되는지
2. 16문항 연속 답변 → 결과 로딩 연출 → 결과 화면(동물 캐릭터/유형/강점/어울리는 친구) 표시
3. 결과 화면 "📸 스크린샷 저장" 버튼 동작(Web Share 또는 다운로드 폴백)
4. 결과 화면 "닫기" → `/child/play`로 정상 복귀 + 황금열쇠 잔액이 정상 갱신되는지
5. 8문항까지 답변 후 새로고침(또는 `/child/play` 갔다가 "이어하기") → 9번째 문항부터 정상 재개
   (이어하기 진행률 유지, 처음부터 다시 시작하지 않음)
6. 네트워크 끊김 상태에서 답변 선택 → 하단 비차단 저장 실패 배너만 표시되고 문항 진행은 막히지
   않는지(무한 로딩/오류 모달 없음)
7. 진행 중 3버튼 오버레이(세션 만료 등 치명적 실패 유도) → "이어가기"/"다시 시작하기"/"버그
   신고하기" 각각 정상 동작
8. 황금열쇠 부족 상태에서 MBTI 카드 클릭 → 기존 "황금열쇠가 부족해요" 모달 정상 표시(변경 없음)
9. comic_book/quiz/hairstyle 카드 클릭 → 기존과 동일하게 "준비 중" placeholder 화면으로 이어지고
   회귀 없는지(이번 작업이 건드리지 않은 영역 — 회귀 확인 목적)
10. 5분 결과 화면 방치 → 자동으로 `/child/play`로 복귀하는지(자동 종료)

## claude-review 검증(별도 tmux 인스턴스, 읽기 전용) 및 반영한 수정

- 검토 결과: 치명적 로직 결함·회귀 없음(CAS 로직/네임스페이스 병합/다른 놀이 타입 회귀/
  재시작 로직 모두 안전). [복잡] 1건, [단순] 2건 지적 — 아래와 같이 반영했다.
- **[복잡→반영]** `sessionId`(캐퍼빌리티 토큰)가 URL 쿼리 파라미터로 노출되던 것을
  `sessionStorage`(`lib/play/mbtiSessionHandoff.ts`) 핸드오프로 변경 — 브라우저 히스토리/
  서버 접근 로그에 playSessionId가 남지 않는다. 원본(iframe+postMessage)도 URL에 노출되지
  않았으므로 이 변경으로 원본과 동등한 노출 수준을 회복했다.
- **[부가 발견→반영]** 위 항목을 조사하며 `startMode`("new"/"resume")를 클라이언트가 한 번
  기억한 값으로 신뢰하던 설계에 새로고침 시 진행 유실 가능성이 있음을 발견 — `MbtiPlayScreen`이
  `startMode`를 아예 받지 않고 항상 `/api/mbti/session`으로 서버 상태를 재확인하도록 수정
  (있으면 이어서, 없으면 처음부터). 이 변경 후 `npx tsc --noEmit`/`npx next build`/
  `next start` 기동 후 `/play/mbti`·`/child/play` 200 응답을 재확인했다.
- **[단순→반영]** `components/mbti/ProgressErrorOverlay.tsx` 상단 주석이 구 iframe 설계를
  설명하던 부분을 네이티브 통합 후 실제 동작(`/api/play/restart`·`/api/play/bug-report` 직접
  호출)으로 갱신했다.
- **[단순→의도적 유지]** `progress`/`complete` 라우트가 `session`(GET) 라우트와 달리 child_id
  소유권을 검증하지 않는 점은 대표님이 명시한 "c6080b3 기준 유지" 지시에 따라 원본 계약을
  그대로 따른 것으로, 이번 sessionStorage 전환으로 노출 표면이 줄어든 만큼 잔여 위험이
  낮다고 판단해 변경하지 않았다.

## 알려진 설계 결정 (리뷰 시 참고)

- MBTI 진행 저장/세션 조회/완료 라우트는 의도적으로 Supabase Auth 쿠키를 확인하지 않는다
  (대표님 명시 지시, c6080b3 패턴 유지). 세션 생성(`/api/play/consume`)은 기존 쿠키 인증 +
  `requireChildAccess`를 그대로 거치므로, playSessionId 자체가 이미 인증된 요청으로만
  발급되는 capability token 역할을 한다.
- "다시 시작하기"(`ProgressErrorOverlay`)는 원본과 달리 페이지 이동 없이 같은 페이지에서
  `/api/play/restart`를 직접 호출해 새 세션으로 로컬 상태만 교체한다(원본은 세션을 못
  만들어 메인 앱에 재시작 요청 메시지만 보냈지만, 네이티브 통합 후에는 이 페이지 자체가
  메인 앱의 일부이므로 직접 호출 가능).
- MBTI 전용 분석 이벤트 로깅(원본의 `logMbtiEvent`, 14종 이벤트 → `/api/mbti/log`)은 이번
  통합에서 포팅하지 않았다 — 대표님 요구사항(playSession/황금열쇠/progress merge/6시간
  만료/이어하기/완료 이벤트)에 명시되지 않은 부가 기능이라 범위를 벗어난다고 판단했다.
  필요 시 별도 지시로 추가 가능.
