# K-Bestie-v3 프로젝트 상태 장부 (2026-07-26~27 반영본)

기준 문서:
- `requests/_log.md`
- `requests/_blocked.md`
- `requests/098-project-status-refresh.md`
- 최근 git 커밋 30개
- 현재 작업 브랜치/워킹트리 상태

현재 기준:
- 브랜치: `feat/family-backend`
- 원격 추적: `legacy-origin/feat/family-backend`
- 현재 상태: 로컬 변경 남아 있음(예: `components/mbti/*`, `hooks/useResultScreenshot.ts`, `supabase/.temp/*`, 일부 신규 request 문서)
- Dev 기준 URL: `https://k-bestie-v3-dev.vercel.app`
- 주의: 이 문서는 "코드 존재"가 아니라 `_log/_blocked`, 실제 커밋, Dev 반영 기록, 대표님 확인 필요 여부를 분리해 적는다.

## 요약
- 대표님 확인 대기: 4건
- 개발 완료·Dev 배포: 6건
- 개발 문서 완료: 1건
- 미착수: 3건
- 외부 의존·차단: 1건
- 중단·보존: 1건
- 의도적 보류: 2건

## 1. 대표님 확인 대기

### 011 미션 반복/상태/레이아웃/연결 관련 연속 수정
- 상태: 대표님 확인 대기
- 근거 요청서: `requests/011-mission-repeat-state-layout-connection-fix.md`
- 관련 커밋 예시:
  - `bb530f4` PC/PWA 마스코트 미노출 수정
  - `20cf045` Live 모드 버튼 잠김 회귀 수정
  - `00084ea` 하단 메인 음성 버튼 3상태 전환
- 현재 반영된 범위:
  - PC/PWA/모바일에서 마스코트 노출 수정
  - 하단 메인 버튼 대기/녹음중/K말하는중 3상태 분리
  - "케이가 잘 못 들었어" 문구 제거
  - 비Live 상태배지/레이아웃/연결 관련 다수 수정
- Dev 배포: 됨
- 자동 검증: `tsc`, `build`, `npm test`, Playwright/QA 계정 라이브 검증 기록 있음
- 대표님 확인이 남은 이유:
  - 실기기 기준 최종 사용감 확인이 아직 남음
  - 일부 NOT TESTED 시나리오(B/G/H 등) 기록이 `_log.md`에 남아 있음
- 다음 행동: 대표님 실기기에서 미션 화면 최종 확인 후 완료 판정

### 012 미션 대화 화면 UI 개편 7항목
- 상태: 대표님 확인 대기
- 근거 요청서: `requests/_done/012-add-request.md`
- 관련 커밋: `1e6bd36`
- 반영 범위:
  - 세션 시작 인사 턴
  - 상태배지/토글/스피커 재배치
  - 로고 교체
  - 히스토리 스크롤/플로팅 버튼
  - 스텝 인디케이터 개선
- Dev 배포: 됨
- 자동 검증: `tsc`, `build`, `npm test`, QA 계정 실배포 검증 완료
- 다음 행동: 대표님이 실제 미션 대화 화면 흐름과 인사턴 체감 확인

### 019 자유대화 화면 음성 UI 레이아웃 통합
- 상태: 대표님 확인 대기
- 근거 요청서: `requests/_done/019-unify-voice-conversation-layout.md`
- 관련 커밋: `d1b150d`
- 반영 범위:
  - 자유대화 화면을 미션 화면과 유사한 최신 Voice Conversation Layout으로 통합
  - 하단 상태배지/케이/토글 고정, 히스토리 양쪽 화자 유지
- Dev 배포: 됨 (`dpl_CBTAq1PJTRo29eh3bqjv7FYg8x4q` 기록)
- 자동 검증: `tsc`, `build`, `npm test`, Playwright 실배포 검증 완료
- 다음 행동: 대표님 실기기에서 자유대화 화면 시각/조작감 최종 확인

### ✅ 놀이 앱 아키텍처 최종 확정 — 퀴즈마스터 리버스 프록시 (2026-07-27, 실행 완료)
- 상태: **실행 완료**(Dev). Production 전환은 대표님 별도 결정 대기.
- 근거 문서: `.omc/plans/quizmaster-resplit-plan.md`(EXECUTION APPROVED), `req04.md`(KY 놀이 앱 아키텍처 원칙)
- 확정 방향:
  - 퀴즈마스터는 **독립 프로젝트(Quiz repo) + 독립 Vercel 배포**가 유일한 정본이다(req04 원칙).
  - K-Bestie-v3는 **런처 + 공통 자원**만 담당한다: 놀이 카드, 황금열쇠 차감·환불,
    handoff token 발급, completion/refund 콜백 수신.
  - 사용자 진입 경로 `/play/quiz`는 **iframe이 아니라 same-origin 리버스 프록시**로
    독립 Quiz 배포에 연결된다(`middleware.ts` → `app/api/quiz-proxy/[[...path]]/route.ts`).
    브라우저 주소창에는 항상 K-Bestie 도메인만 보이고 Quiz 배포 주소는 노출되지 않는다.
  - 프록시는 K-Bestie 인증 세션을 요구하고, 업스트림으로 나가는 쿠키를 Quiz 전용
    allowlist로만 재조립하며(부모 세션 쿠키 유출 차단), 업스트림의 `Set-Cookie`도 같은
    allowlist로 걸러 K-Bestie 쿠키 덮어쓰기를 막는다. 서버간 공유 시크릿
    (`QUIZ_INTERNAL_AUTH_SECRET`, `x-quiz-proxy-auth` 헤더)이 없으면 양쪽 모두 fail-closed.
  - **인앱 중복 구현은 제거 완료**(Phase 7): `app/play/quiz/{page,layout}.tsx`,
    `components/quiz/QuizPlayScreen.tsx`, `lib/quiz/play/`(17개), `app/api/quiz-play/`(11개)
    총 31개 파일 삭제. 롤백용 `quiz_proxy` has-게이트도 함께 제거했다 — 폴백이 사라진 뒤
    게이트를 남기면 `quiz_proxy=off` 쿠키를 든 브라우저가 영구 404를 받기 때문.
  - 오류 복귀 경로: Quiz가 진입 실패 시 `/play/quiz-error?quiz_error_code=...`로 돌려보내고,
    K-Bestie가 그 화면을 직접 서빙한다(프록시 대상 아님).
  - 고아 황금열쇠 정산: `POST /api/batch/quiz-handoff-reconcile`(`BATCH_SECRET` 인증)이
    attempt로 이어지지 못한 handoff를 회수한다. pg_cron 등록은 대표님 실행 대기.
- 안전 스냅샷: 브랜치/태그 `pre-play-rollback-snapshot-20260726`(커밋 `72ace57`)
- 다음 행동: Production용 별도 Quiz Vercel 프로젝트 생성 여부·시점 대표님 결정

### ⛔ (SUPERSEDED) 놀이 앱 아키텍처 방향 전환 확정 (2026-07-27) — iframe PlayModal 안
> **이 항목은 위 "리버스 프록시" 확정으로 대체됐다(2026-07-27).** 아래 iframe PlayModal
> 서술은 검토 과정에서 나온 이전 안이며 최종 결정이 아니다. 계획 문서 Phase 0 항목 1이
> 지적한 "정본 문서 충돌"이 이 대목이었고, 대표님이 리버스 프록시 방향을 최종 확인하면서
> 종결됐다. 이력 보존을 위해 삭제하지 않고 남긴다.
- 상태: ~~확정, 단계적 실행 대기~~ → **폐기(superseded)**
- 근거 문서: `outputs/play-app-rollback-plan-20260727.md`
- 당시 방향(현재 무효):
  - MBTI·퀴즈마스터는 각자 **독립 프로젝트·독립 Vercel 배포**로 되돌린다(각각 별도 Claude Code 세션에서 복원·재작성·배포 진행 중)
  - K-Bestie-v3에는 최종적으로 **놀이 카드 / 공통 황금열쇠 차감·환불 / handoff token 발급 / completion·refund callback 수신 / 독립 놀이 앱 URL을 불러오는 공통 전체화면 인앱 iframe PlayModal**만 남긴다
  - 현재 K-Bestie-v3 안에 있는 네이티브 MBTI·퀴즈 코드(`components/mbti`, `lib/mbti`, `app/api/mbti`, `components/quiz`, `lib/quiz/play`, `app/api/quiz-play` 등, 약 8,703줄)는 **삭제하지 않고 임시 안전망으로 보존** — 각 독립 앱의 Dev 배포 + E2E 검증이 끝난 뒤 연동 계약이 전달되면 연결·검증 후 단계적으로 제거
  - 안전 스냅샷: 브랜치/태그 `pre-play-rollback-snapshot-20260726`(커밋 `72ace57`)
- 중단된 것: K-Bestie-v3 안에서 놀이 UI·문항·채점·진행상태·이어하기·결과·리더보드를 추가 이식·확장하는 모든 작업(병렬 세션 포함, 단 병렬 세션은 각 세션 소유자가 직접 중단해야 함)
- 다음 행동: MBTI·퀴즈마스터 Dev URL과 연동 계약(handoff/completion/refund) 전달 대기 → 연결·검증 → 중복 네이티브 코드 단계적 제거(계획 문서의 Phase 1~5)

### 010 + 013 + 016 퀴즈마스터 연동 묶음 (최종 형태로 정리 완료)
- 상태: **정리 완료** — handoff/completion/refund 콜백 계약은 그대로 유효하고 계속 쓰인다.
  네이티브 플레이 화면 부분은 iframe이 아니라 **리버스 프록시로 대체됐고, 인앱 구현은
  Phase 7에서 삭제됐다**(위 "놀이 앱 아키텍처 최종 확정" 참고).
- 근거 요청서:
  - `requests/010-quizmaster-main-app-integration.md`
  - `requests/_done/013-Quiz-add.md`
  - `requests/_done/016-quiz-add.md`
- 관련 커밋 예시:
  - `32d7ba0` 퀴즈마스터 카드/시작 연동
  - `f191b5b` 퀴즈마스터를 K-Bestie 내부 Full Screen Modal로 전환
  - `8c9ab6c` completion/refund 콜백 자기호출 URL 버그 수정
- 현재 상태:
  - 시작/이어하기 프론트 연결 완료
  - 내부 풀스크린 퀴즈 플레이 전환 완료
  - completion/refund 콜백 포함 백엔드 반영 완료
  - `_log.md` 기준 Dev/QA 계정 검증 완료
- Dev 배포: 됨
- 대표님 확인이 남은 이유:
  - 대표님 실사용 관점 최종 체감 확인이 남음
  - 실계정 직접 E2E는 정책상 자동 수행하지 않음
- 다음 행동: 대표님이 놀이 홈 → 퀴즈마스터 진입/이어하기/결과 흐름 확인

## 2. 개발 완료·Dev 배포

### 018 대화 맥락 보정 파이프라인
- 상태: 개발 완료·Dev 배포
- 근거 요청서: `requests/_done/018-conversation-context-correction-pipeline.md`
- 관련 커밋 예시:
  - `cf8f429` Raw 수집 → Gemini 보정 → corrected 저장 → 리포트 생성
  - `ed75a00` pg_cron 스케줄 등록
  - `0e8efd9`, `461fb08`, `4b5bbc1` 후속 결함 수정
- 현재 상태:
  - 수집/보정/리포트 생성/보관삭제 파이프라인까지 구현 및 Dev 반영됨
  - `_log.md`에 실제 배포/DB 적용/결함 수정 이력까지 남아 있음
- 남은 것: 별도 운영 승인 없이 Production 반영은 하지 않음

### 011-memory A안
- 상태: 개발 완료·Dev 배포
- 근거 요청서: `requests/_done/011-memory-context-and-proactive-friend.md`
- 관련 커밋: `9363079`
- 현재 상태:
  - 대화 종료 후 생성된 요약 기억을 다음 세션 인사 컨텍스트에 주입하는 A안 구현 완료
  - 자유대화 규칙기반 구조는 유지
- Dev 배포: 됨

### 018-pad-home-change
- 상태: 개발 완료·Dev 배포
- 근거 요청서: `requests/_done/018-pad-home-change.md`
- 관련 커밋: `4f6e304`
- 현재 상태:
  - 태블릿/PC 홈 화면을 스마트폰과 동일한 좁은 세로 레이아웃으로 교정 완료
  - 이전 오판정은 `_log.md`에 정정 이력 남음
- Dev 배포: 됨

### 020-K-position
- 상태: 개발 완료·Dev 배포
- 근거 요청서: `requests/_done/020-K-position.md`
- 관련 커밋: `58022da`
- 현재 상태:
  - 상태배지 길이 변화에도 케이/토글이 흔들리지 않도록 그리드 구조로 수정 완료
- Dev 배포: 됨

### 021 퀴즈 내부 모듈화 (되돌림 완료 — 코드 삭제됨)
- 상태: **되돌림 완료**. 이 항목이 만든 인앱 플레이 모듈은 Phase 7에서 전부 삭제됐다.
- 근거 요청서: `requests/_done/021-Quiz-add.md`
- 관련 커밋: `f191b5b`, `8c9ab6c` / 되돌림: `c7a76e2`(31개 파일 삭제)
- 경과:
  - 외부 퀴즈마스터 리다이렉트 의존을 줄이고 K-Bestie 내부 플레이 모듈로 전환(당시 지시에 따름)
  - 이후 아키텍처가 **독립 앱 + 리버스 프록시**로 최종 확정되며(iframe 안은 채택되지 않음)
    이 모듈은 중복 구현이 됐고, Dev E2E·캐너리 통과 후 삭제했다.
  - 완료/환불 콜백 계약(`8c9ab6c` 포함)은 **삭제 대상이 아니었고 계속 유효**하다 —
    독립 Quiz 앱이 그대로 호출한다.
- Dev 배포: 삭제 반영 완료(`tsc`/`build` 통과, `api/quiz-play` 라우트 0개 확인)

### 014 추가요청 + 아이 홈 카드 색상 체계
- 상태: 개발 완료·Dev 배포
- 근거 요청서 / 직접 지시:
  - `requests/_done/014-addrequest.md`
  - 채팅 직접 지시(아이 홈 액션 카드 색상 variant)
- 관련 커밋: `94c6eba`, `b106927`
- 현재 상태:
  - 마이크 버튼 형태 명확화 완료
  - 아이 홈 액션 카드 색상 variant 체계 적용 완료
- Dev 배포: 됨

### 020 Care Start / Care Insight / Care Premium 음성 UI 레이아웃 통합
- 상태: 완료(코드 변경 없음 — 착수 전 조사로 이미 충족 확인)
- 근거 요청서: `requests/_done/020-unify-care-plan-voice-layout.md`
- 현재 상태:
  - 미션 화면(`app/child/missions/page.tsx`)은 Live API(Care Premium)/STT·TTS
    (Care Start·Insight) 모두 이미 동일한 `MissionConversationLayout`을 쓴다 —
    011 지시서 여러 라운드에서 이미 통합·실측 검증 완료(재작업 불필요).
  - 자유대화 화면(`app/chat/page.tsx`)은 Care Premium이라도 Live API를 전혀
    쓰지 않는다(Care Start/Insight와 동일하게 STT/TTS만) — "교체할 기존 Live
    UI"가 없고 Live API 자체가 부재한 상태라 020의 UI-only 범위 밖으로 판단,
    대표님 확정으로 별도 요청서(`requests/024-freechat-live-api-care-premium.md`)로
    분리.
- Dev 배포: 해당 없음(코드 변경 0건)

## 3. 개발 문서 완료

### 098 PROJECT_STATUS 최신화
- 상태: 문서 갱신 완료
- 근거 요청서: `requests/098-project-status-refresh.md`
- 현재 상태:
  - 이 문서가 바로 해당 요청의 산출물
  - `_log/_blocked`, 최근 커밋, 현재 브랜치 상태를 기준으로 상태를 재분류함
- 후속 연계:
  - 요청서 099 체크리스트 문서 작성 시 이 문서를 기준 소스로 사용

## 4. 미착수

### 베타 사용자 승인 및 서비스 플랜 관리 시스템
- 상태: 미착수(분석만 완료)
- 근거 요청서: `requests/beta-user-approval-and-production-control.md`
- 현재 상태:
  - `outputs/beta-approval-analysis-20260726.md` 구조 분석 보고서 작성됨
  - 코드/마이그레이션 생성은 아직 하지 않음
- 다음 행동: 대표님 결정 사항 확정 후 구현 라운드 시작

### 공통 Resume Session 기능 (아키텍처 전환으로 재검토 필요)
- 상태: 병렬 세션에서 처리·`_done/` 이관됨(`requests/_done/feature-play-resume-session.md`)
  → **퀴즈마스터 몫은 소유권 이전 완료**, MBTI 몫은 재검토 대상으로 남음
- 이유: 퀴즈/MBTI 이어하기 로직이 K-Bestie 내부(`k_play_sessions`/`quiz_attempts` 직접 참조)에
  있었으나, 놀이 실행이 독립 앱으로 넘어가면 이어하기 상태 관리도 각 독립 앱 책임으로 이동
- 퀴즈마스터 확정 결과: K-Bestie는 `/api/play/session`으로 이어하기 **가능 여부만** 판단하고
  (`quiz_attempts` 읽기 전용 조회 — 계획에서 명시 승인된 예외), 실제 재개는 Quiz 앱이 자기
  세션으로 처리한다. K-Bestie가 claim 라우트를 직접 호출하던 구조는 제거됐다
  (`app/child/play/page.tsx`에 `quizAttemptClaimPath`/`lib/quiz/play/*` import 0개).
- 다음 행동: MBTI 쪽 이어하기 소유권만 별도 재검토

## 5. 외부 의존·차단

### 베타 승인 시스템 구현의 선결정 항목
- 상태: 외부 의존·차단
- 근거 문서:
  - `requests/beta-user-approval-and-production-control.md`
  - `outputs/beta-approval-analysis-20260726.md`
- 막힘 이유:
  - `approval_status` 기본값 정책
  - 기존 사용자 처리 방식
  - Care Start / Insight / Premium 명칭과 DB `plans.name` 정합성
  - 베타 신청 문항/폼 구조
  - 승인 시 플랜을 부모/아이 tier에 어떻게 반영할지
- 다음 행동: 대표님 결정 후에만 구현 시작

### 자유대화 Care Premium(Live API) 적용
- 상태: 외부 의존·차단(제품 방향 결정 필요)
- 근거 요청서: `requests/024-freechat-live-api-care-premium.md`
- 막힘 이유: Live API를 자유대화에 추가하는 것은 UI 수정이 아니라 신규 기능
  구현 — 우선순위·일정·범위(미션 Live 파이프라인 재사용 여부 등)를 대표님이
  결정해야 함(020 처리 중 분리·신규 등록, 2026-07-28)
- 다음 행동: 대표님 결정 후 별도 세션에서 설계·구현 착수

## 6. 중단·보존

### A/B/C/E 트랙 보존
- 상태: 중단·보존
- 근거 문서:
  - `requests/_log.md`
  - `requests/_blocked.md`
- 현재 상태:
  - `paused/voice-session-resumption-ab` 등 보존 브랜치 유지
  - A/B/C/E 신규 개발은 중단 상태 유지
  - 관련 테스트/화면 보존 요구는 계속 유효
- 다음 행동: 대표님 재개 지시 전까지 그대로 유지

## 7. 의도적 보류

### 015 디자인 스킬 기반 앱 테마·톤앤매너 개편
- 상태: 의도적 보류
- 근거 요청서: `requests/015-Design-upadte.md`
- 근거 로그: `requests/_done/019-answer-QA.md`에 "017/015는 계속 보류 확인" 기록
- 다음 행동: 우선순위 재지시 전까지 보류 유지

### 017 리포팅 모듈 오픈 전 수정·배포·검증
- 상태: 의도적 보류
- 근거 요청서: `requests/017-reporting-module-preopen-fix.md`
- 근거 로그: `requests/_done/019-answer-QA.md`에 "017/015는 계속 보류 확인" 기록
- 현재 상태:
  - 요구사항은 크고 명확하지만, 현재 라운드에서 진행 재개 지시 없음
- 다음 행동: 우선순위 재지시 시 재개

## 8. 다음 우선순위 제안
1. `099-dev-acceptance-checklist.md` 작성
   - 이유: 지금 Dev에 쌓인 대표님 확인 대기 항목을 실제 검수 순서로 바꿔야 함
2. `020-unify-care-plan-voice-layout.md` 착수 여부 결정
   - 이유: Premium Live UI 통합은 아직 열린 요청으로 남아 있음
3. 베타 승인 시스템 결정사항 확정
   - 이유: 분석은 끝났고, 구현 시작 전 사람 결정이 먼저 필요함

## 이번 갱신에서 정정한 핵심
- 2026-07-24 기준 오래된 `PROJECT_STATUS.md`를 2026-07-26~27 작업까지 반영해 재분류했다.
- 퀴즈/미션/자유대화/보정 파이프라인 관련 최근 완료 항목을 Dev 배포 기준으로 분리했다.
- 015/017은 "미완료 누락"이 아니라 대표 지시로 멈춘 의도적 보류임을 명확히 했다.
- 베타 승인 시스템은 "이미 구현 중"이 아니라 "분석만 완료, 결정 대기" 상태로 정리했다.

마지막 갱신: 2026-07-26~27 작업 반영본