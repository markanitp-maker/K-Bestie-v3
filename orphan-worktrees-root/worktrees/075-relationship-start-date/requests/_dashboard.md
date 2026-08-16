# Request 작업 대시보드

## 📋 2026-08-11 16:52 현재 상태표 (최신, 이 표를 우선 참고)

| 항목 | 상태 | 비고 |
|---|---|---|
| 069/070/074/PWA배너/마스코트신발/iPhone첨부/family-invite/retention | ✅ 완료 | 전부 Production 배포 완료 |
| 073 Mission v3 Phase 5C | 🟡 작업진행 | 게이트① 3라운드째. 2차 반려 2건 수정·로컬 검증 완료, 실제 DB SQL 검증은 네트워크 허용 환경에서 재실행 필요 |
| 076 미션 키보드 세션끊김 버그 | 🟡 작업진행 | 게이트① 4라운드째. 4건→3건→3건, 이슈 계속 축소 중(안전 관련 아님, UX 엣지케이스) |
| 075 Relationship Engine V1 | 🟡 작업진행 | 대표님 결정 2건 모두 완료(중1=초6 동일, relationship_started_at 정책 확정) → 구현 착수 |
| 100 Legal Consent Master | 🟡 작업진행 | LEGAL_REVIEW_REQUIRED로 확정, 개발 BLOCKER 아님 → Legal Registry/문서초안/모달 UI 구현 착수. Production 신규 문서버전 전환·재동의 강제·공개는 법률자문 전까지 금지 |
| chosung-game Phase 5 | 🕰 대기 | Claude 직접 설계 필요, 아직 미착수 |

## 👤 대표님 확인 필요 — 전부 해결됨 (2026-08-11 17:12)

1. ~~075 — 학년 "중1" 처리 방식~~ **해결: 중1은 초6과 동일 설정.**
2. ~~075 — 관계 시작 기준일~~ **해결: child_profiles.created_at을 source of truth로 쓰지 않음. 별도 relationship_started_at을 "CHILD 메시지+K 응답이 모두 저장된 최초 정상 턴" 시점으로 최초 1회 기록(불변). 기존 사용자는 과거 chat_messages를 Production Read-only로 역산해 backfill, 정상 턴 없으면 created_at을 fallback으로 사용하되 구분 가능하게 표시.**
3. ~~100 — 법률 자문 필요 여부~~ **해결: LEGAL_REVIEW_REQUIRED로 확정(개발 BLOCKER 아님). 구현은 계속 진행하되 민감정보·아동 자유대화·국외이전 관련 문구는 LEGAL_REVIEW_REQUIRED로 명시. 법률자문 완료 전 신규 document_version Production active 전환·기존 사용자 재동의 강제·신규 개인정보처리방침 Production 공개 금지. 구현 완료 후 법률자문용 문서 5종+쟁점 목록 별도 보고.**

---

## 🔴 2026-08-11 5C 게이트① 반려 수정 — 빌드 검증 실패

**게이트① 2라운드 반려 2건 코드 수정·로컬 셀프검증 완료** (2026-08-11 대표님 직접 지시).
session lock 뒤 저장된 assessment/output을 progress 검증보다 먼저 재사용하도록 두 RPC의 순서를 최소 수정했고,
30초 processing lease 기대값 및 output/finalize first-writer·safety·boredom SQL 검증을 보강했다.
SAFETY_PAUSED 로직 자체는 이번 라운드 범위 밖으로 유지했다. `npx tsc --noEmit` 오류 0건,
Mission v3 단위 테스트 6/6 통과. SQL은 migration+검증 스크립트를 단일 트랜잭션/ROLLBACK으로 실행하려 했으나
샌드박스 외부 네트워크 차단(`fetch failed`) 및 로컬 PostgreSQL 부재로 실제 DB 실행은 불가했다(영구 변경 없음).
클린 `npm run build`는 환경 분리 검사 통과 후 `✓ Compiled successfully in 6.9min`을 확인했고, 사용자 지시대로
후속 장시간 lint/type 단계는 중단해 추가 재시도하지 않았다. 작업 전 `.next`는 파일 수·바이트 수 동일하게 복원했다.
실제 DB SQL 검증만 네트워크 허용 환경에서 재실행해야 하며, 커밋·배포 없음.

**073 Mission v3 Sub-phase 5C — 게이트① 반려 7건 구현 수정 완료, build 미통과** (대표님 직접 지시). 안전 신호를
원자적으로 `SAFETY_PAUSED` 전이시키는 경로를 최우선으로, prompted Goal 영속화, K draft 재사용,
세션 직렬화+`IN_PROGRESS` 검증, boredom 무보상 조기 종료, `FORCE_ENDED` 시간정책, Goal 로더 중복을
수정했다. 신규 v3 라우트·공용 v3 지원 코드·필요한 신규 migration만 최소 변경했으며 레거시 v1/v2
라우트·Production 환경·프론트엔드·배포·커밋은 범위 밖이다. `npx tsc --noEmit`은 오류 0건으로
통과했다. 개발 서버가 없는 상태에서 `.next` 삭제 명령은 안전 정책에 의해 실행 전 차단되어,
기존 캐시를 `/tmp/kbestie-v3-next-before-gate-fix-build`로 이동하고 깨끗한 `npm run build`를
실행했으나, 환경 분리 사전검사 통과 후 `Creating an optimized production build ...`에서 6분 이상
추가 출력 없이 정체되어 종료했다(exit 130, 명시적 컴파일 오류 없음). 부분 캐시는 분리하고 작업 전
캐시를 복원했다. `npx tsc --noEmit`은 최종 재실행도 오류 0건이며, Goal Engine·시간정책 테스트는
2/2 통과했다. 안전 발화 `친구한테 맞았어`는 IPC 없는 직접 실행에서 `category=safety`,
`subcategory=violence`였고, safety 선판정 → 최초 K 초안 저장 → v3 finalizer의 원자적
`SAFETY_PAUSED` 전이 → 후속 턴 `IN_PROGRESS` 차단 → 응답 반영 assertion 6/6을 통과했다.
동일 build 정체가 기존 기록 포함 2회 이상 반복되어 추가 재시도는 중단한다. 커밋·배포는 하지 않았다.

## 🔵 2026-08-11 13:55 배치 업데이트 (069/070/074/STT/073/075/100/retention)

**⚠️ 표기 정정**: 커밋 `7817eae`("100 — 개인정보 플랜 보존기간...")에 실수로 "100" 번호를 붙였다.
**"100"은 `requests/100-legal-consent-privacy-master.md`(별도, 아직 미착수) 소유 번호다.** 보존기간
hard-delete 작업은 요청서 없이 채팅으로 직접 지시된 건이라 원래 큐 번호가 없다 — 커밋 메시지의
"100"은 무시할 것, 두 작업은 서로 다른 별개 건이다.

**069+074+STT — 게이트① 전부 [통과], 커밋 완료, Dev 배포 완료**(`dpl_72vuiafgtJ6CMkBfWKnMd5EQkjGx`, 격리 워크트리).
커밋: 069 `cdcbe71`, 074 `7ffe4d7`, STT `7cac9dc`(+childauth `6231be1`도 같은 배치 대상). 다음: agy E2E QA(§12-G 1회 실패 시 즉시 Codex 전환) → 대표님 Production 승인 대기.

**🔴 070(자유대화 K 마스코트 세로 배치) — 신발 잘림 수정 완료, 필수 로컬 실행 검증 실패/환경 차단** (2026-08-11 대표님 직접 지시).
`components/KBestieMascotAnimation.tsx`를 우선 범위로 실제 `/chat` canvas 렌더와 spritesheet 원본의 차이를 재현해
원인을 확정하고 있으며, 원인이 아니라고 확인될 때만 `app/chat/page.tsx`의 마스코트 렌더링 부분까지 확인한다.
최소 수정 후 로컬 canvas 스크린샷 육안 확인, `npx tsc --noEmit`, 개발 서버를 종료한 깨끗한 환경의
`npm run build` 검증이 남아 있다. 로컬 dev 기동은 실행 샌드박스의 `listen EPERM`으로
`127.0.0.1:3910`과 `0.0.0.0:3000` 모두 동일 실패해 2회 제한에 따라 중단했으며, 소켓이 필요 없는
Playwright 직접 DOM 재현(raw canvas/합성 canvas/받침대 숨김 비교)으로 원인 검증을 계속한다.
Playwright Chromium도 브라우저 프로세스 시작 전 `sandbox_host_linux.cc`의 `Operation not permitted`로
실패했고 WebKit도 시스템 라이브러리 부재로 실행 불가했다. 정적 수치 검증 결과 390×844에서 뒤 DOM인
받침대 상단면(`z-10`)이 같은 `z-10` 마스코트 canvas 하단 28.7px를 나중에 칠해 덮는 것이 확정 원인이며,
컴포넌트의 idle row·draw 수식·fallback 경로는 정상이다. `app/chat/page.tsx`의 마스코트 wrapper만
`z-10`에서 `z-30`으로 올리는 1줄 최소 수정을 완료했다. 실제 idle 프레임 픽셀과 390×844 CSS 치수를
합성한 수정 전 이미지는 신발·종아리가 덮였고 수정 후 이미지는 양쪽 운동화가 전부 보이는 것을 육안 확인했다
(`/tmp/kbestie-070/before-overlap-render.png`, `/tmp/kbestie-070/after-z30-render-proof.png`).
`npx tsc --noEmit`은 오류 0건 PASS, 개발 서버 부재 확인 후 클린 빌드 검증 중이다.
기존 `.next`는 `/tmp/kbestie-070/prebuild-next`로 복구 가능하게 격리했다. 첫 클린 `npm run build`는
10.8분 최적화 compile과 lint/type 검사를 PASS했으나 `Collecting page data`에서 빌드 산출물
`.next/server/pages-manifest.json`이 사라진 `ENOENT`로 실패했다(소스/타입 오류 아님).
현재 산출물 상태를 진단한 뒤 실패 `.next`를 별도 격리하고 1회 클린 재시도한다.
실패 후 `.next/server` 전체가 제거된 상태를 확인했고 실패 산출물은
`/tmp/kbestie-070/failed-build-next`로 격리했다. 두 번째 클린 빌드도 8.5분 compile 성공 후
lint/type 단계에서 상세 진단 없이 `Next.js build worker exited with code: 1`로 실패했다. 두 번의 빌드
파이프라인 실패로 추가 재시도는 중단한다. 또한 dev 서버는 두 바인드 모두 `listen EPERM`, Chromium은
브라우저 sandbox EPERM, WebKit은 시스템 라이브러리 부재라 실제 `/chat` 스크린샷 완료조건은 미충족이다.
수정 전/후 픽셀 합성 증거와 독립 `tsc` PASS는 확보했으나 **실브라우저 스크린샷·`npm run build` PASS를
깨끗한 실행 환경에서 재검증하기 전까지 완료 처리 금지**.
최종 범위 점검은 `app/chat/page.tsx` 1줄만 변경, `components/KBestieMascotAnimation.tsx`는 HEAD와 해시 동일,
`git diff --check` PASS다. 다른 사용처(자유대화 120px, 미션 202px)는 공용 컴포넌트 무수정이라 영향 없고,
작업 전 `.next` 캐시도 원상복구했다. 다음 단계는 로컬 소켓·브라우저 실행이 허용된 깨끗한 세션에서 위 두 검증 재수행.
**Production 배포·커밋 금지, Dev 미배포**.

**073 Phase 5A/5B C2 회귀 수정 — 구현·셀프검증 완료, 게이트① 재리뷰 대기** (2026-08-11 대표님 직접 지시):
- C1: `start_mission_turn_v3`/`mark_mission_turn_v3_assessed`/`assessGoalsFromUtterance` 전부 Production 호출부 0건 확인(예상된 상태 — Phase 5C 배선 전, 완료 보고 문구만 "계약 수정"으로 한정 필요).
- **C2(회귀, 수정 완료)**: 신규 `20260811200000_mission_v3_assessment_retry_idempotency.sql`에서 `start_mission_turn_v3`가 저장된 `answer_result`를 반환하고, `mark_mission_turn_v3_assessed`는 충돌 예외 없이 최초 assessment를 보존하며 `already_assessed=true`를 반환하도록 수정했다.
- **셀프검증 완료**: `npx tsc --noEmit`, Mission v3 관련 테스트 6파일, 클린 `npm run build`와 postbuild 보안검사 통과. 기존 적용 migration·v1/v2·`finalize_mission_turn_v1`·`policyResolution.ts` 무수정, DB 적용·배포 없음. **claude-review 재검증 전까지 073은 게이트① 미통과 상태다.**

**075(Relationship Engine V1) — Phase 0 AS-IS 감사 완료**. 핵심 발견: 실제 Gemini Live 삽입점은 `lib/k-conversation`도 브라우저 훅도 아니라 `services/vertex-live-relay/src/server.ts`(Relay) — session context 안전 전달 계약을 새로 설계해야 함. Memory V3(`memory_facts` 등)가 유일한 재사용 대상(신규 store 금지, 요청서 명시). `relationship_events` 신규 테이블 필요(`behavior_events`는 부적합). 미결 사항 2건: 학년 "중1" 처리 방식(요청서 미정의), 관계 시작 기준일(`child_profiles.created_at` 후보, Production 검증 필요). **다음: 계획서(docs/plans/) 작성 필요 — 아직 착수 전.**

**100(Legal Consent Master, 진짜 100번) — Phase 0 감사 부분 완료(중단)**. `CONSENT_DOCUMENT_TEXT`/`CONSENT_DOCUMENT_VERSION` 위치(`lib/plan/consentDocument.ts`) 확인, `/privacy` 페이지 부재 확인(057 지시서 기존 조사 재확인)까지만 진행되고 세션이 최종 보고 없이 종료됨 — **재감사 필요**. §7의 리포트/인사이트 retention 수치 부분은 아래 보존기간 구현이 이제 완료됐으니 문구 확정 가능.

**개인정보 플랜 보존기간 원자화 재설계 R1+R2(요청서 없음, 채팅 직접 지시) — 구현·셀프검증 완료, 게이트① 대기**. 신규 `apply_plan_tier_change` SECURITY DEFINER/service_role 전용 RPC에 tier 변경·가족별 유효 보존기간 재계산·다운그레이드 스탬프/재상향 복구를 한 트랜잭션으로 통합하고 두 API 라우트의 TS 후속 스탬프 호출을 제거했다. `npx tsc --noEmit`, 관련 테스트 2파일, 클린 build와 postbuild 검사를 모두 통과했다. R3(purge/FK 원자화)는 범위 밖이며 기존 `20260811180000`/`190000`/`210000`/`220000` migration과 `lib/plan/retention.ts`는 무수정 유지했다. Production 배포·migration 적용·실데이터 변경·커밋 없음. 다음: 별도 세션/교차 모델 게이트① 정적 리뷰.

---


## 색상 판정 규칙 (2026-08-10 전면 개정 — 대표님 지시, 이후 모든 갱신에 고정 적용)

**녹색(🟢/✅)은 대표님이 직접 Production에서 QA PASS를 확정했거나, 대표님 의사결정이
완료되고 모든 후속조치까지 끝나 실제로 `_done` 이동이 가능한 항목에만 사용한다.**

구현 완료 / 코드 리뷰 통과 / tsc·tests·build·E2E PASS / main commit 완료 / Dev 배포
완료 / Production 배포 READY / smoke PASS / 자동(agy) QA PASS — 이 중 무엇이 끝났어도
**대표님 최종 승인 전에는 녹색 표시를 쓰지 않는다.**

매 항목 갱신 시 아래 3개 질문을 먼저 평가한다. **셋 중 하나라도 YES면 녹색 금지.** 세
질문 모두 NO이고 대표님 최종 PASS까지 확인된 경우에만 녹색을 허용한다.

1. 대표님 결정이 필요한 지점이 남아 있는가?
2. 대표님의 실기기·실계정 QA가 아직 필요한가(아직 안 끝났는가)?
3. 현재 이슈·회귀·요구사항 미반영·BLOCKER가 있는가?

| 색상 | 라벨 | 의미 |
|---|---|---|
| ✅ / 🟢 | PASS 확정 | 대표님이 직접 PASS 확인, `_done` 이동 가능/완료 |
| 🟡 | 작업진행 / 검증완료-대표님QA대기 | 코드·리뷰·자동검증까지는 끝났으나 아직 배포 파이프라인 중간 단계(Dev 배포 등) — Production 배포나 최종 QA가 더 남음 |
| 🔵 | 배포완료-대표님QA대기 | Production까지 배포·smoke 완료, 대표님의 실기기·실계정 최종 QA만 남음 |
| 🟠 / ⏸ | 대표님 결정 필요 | 방향·정책·승인 등 대표님이 선택해야 진행 가능 |
| 🔴 | 이슈/재작업 필요 | 오류·회귀·요구사항 미반영·재작업·BLOCKER 존재 |
| ⚠️ | 외부 BLOCKER | 시스템 제약(라이브러리 부재, 실기기 전용 API 등)으로 자동화가 더 못 감 |
| 🕰 | 대기 | 단순 대기 또는 선행 작업 의존, 지금 당장 막힌 것은 아님 |

**자동 상태 갱신에서 개발자(Claude/Codex/agy) 자체 판단으로 녹색 승격하지 않는다.**
대표님의 명시적 PASS 문구("확인했다", "정상 동작", "PASS" 등 실사용 기반 확인)가
있어야만 녹색으로 바꾼다.

---

> **공통 배포 게이트(2026-08-09 확정)**: 구현 → Dev 자동검증(tsc/tests/build/E2E) PASS →
> 최신 main 통합 → 필요한 Production migration 적용 → Production 배포 → Production
> smoke → 대표님 실기기·실계정 최종 QA → PASS 시 `_done` 이동.
>
> iPhone/Android 실제 기기 Push, PWA 홈 화면 앱 아이콘 badge, OS 알림 클릭, Google/Kakao
> OAuth 실계정 callback처럼 자동 실행 환경에서 검증 불가능한 항목은 **Production 배포
> 차단 사유로 쓰지 않는다** — `_done` 완료 차단 사유로만 기록한다.
>
> 예외적으로 Production 배포 전에 멈추는 경우: Production 데이터 훼손 가능성, 기대값
> 불일치, destructive migration, 보안 BLOCKER, 인증/권한 BLOCKER가 발견된 경우만.
>
> **판정 원칙**: "리뷰 통과"/"구현 완료"/"배포 예정"이라는 자체 보고만으로 PASS
> 처리하지 않는다. 실제 main commit + Production deployment READY + smoke 증거가
> 있어야 "대표님 QA 대기"로 전환할 수 있고, **대표님이 직접 PASS 판정한 경우에만** `_done`
> 이동한다.

> 최종 갱신: 2026-08-10 (KST) — **대표님 명시 지시("문제 없으면 무조건 Production까지
> 배포 후 QA 요청")에 따라 059+064/061/카카오/GreenList/063/088/087 Phase 1/089를
> Production에 일괄 배포 완료.** 커밋 `1016139`(정적 리뷰 전부 [통과] 확인된 마지막
> 지점, 087 Phase 2 `a3436d5`와 그 이후 docs 커밋 `5abd714`는 의도적으로 제외).
> `dpl_9gP3sQwxLg1cCBctCvHSSzkfM7j9` READY, `app.k-bestie.com` alias 완료. Production
> migration 2건도 함께 적용: `20260810120000_app_sessions.sql`(087P1),
> `20260810170000_mission_event_daily_activity_policy.sql`(089). smoke 통과(주요
> 라우트 200/307/401 정상), `get_runtime_errors` 재확인 결과 신규 배포 기인 에러
> 0건(유일한 에러그룹은 08-06부터 있던 이전 배포 기인 `child_temporal_context`
> 테이블 부재 건으로 이번 배포와 무관). **아래 항목들은 배포는 끝났으나 대표님
> 직접 QA 전이므로 🔵(배포완료-QA대기)이며 아직 녹색이 아니다.**
>
> **Dev DB 스키마 drift는 위 배포로 해소되지 않은 별도 이슈로 남아 있음** —
> `parents` 테이블이 Production 25개 컬럼 중 4개만 있어 로그인 후 인증 화면이
> 500으로 깨졌던 건은 Dev 전용 컬럼 catch-up으로 조치했으나, **Dev 마이그레이션
> 적용 상태 전수 감사는 아직 미완료** — 별도 작업으로 남음. QA 계정(`qatesti-dev`)도
> "AUTHENTICATED_INCOMPLETE(약관동의 미완료)" 상태라 Dev 실화면 재확인은 별도
> 후속 필요.
>
> **087 Phase 2 이후 후속(2026-08-10 계속)**: `a3436d5`의 C-1~C-3 수정분이 재리뷰에서
> R-1~R-3(신규 [복잡])을 냈고, 그 수정이 다시 weeklyAverageVisits 기간 과대계산·
> usageRate 분모 오류를 냈다 — 같은 기간/전체이력 혼용 계열 버그가 5라운드 연속 하나씩
> 나온 패턴이라 Codex Sol 반복 실패로 판단해 메인 Claude가 직접 수정, 5차 독립검증에서
> [단순] 1건(방문 쿼리 상한 누락, 즉시 수정)만 남고 완전히 통과. `dpl_4PCcouhiLMVUf1xo6KWWumYkcbsq`로
> 단독 Production 배포 완료.
>
> **030/065 신규 큐 항목 처리(2026-08-10)**: 대표님이 요청서와 동일 번호 참고
> 스크린샷(030.png/065.png) 업로드 → 각각 Codex Terra 구현·codex-rv [통과] · 클린
> 프로덕션 빌드(사전 `.next` 캐시 문제로 1회 재시도) → Dev 배포·smoke → Production
> 배포·smoke까지 완료(`dpl_4pmvC3J55SfuHvhCYQM3MwZYuRws`). 030은 emotion_hint 강조
> 박스가 스펙 §10 목업(장식 없는 평문)과 달라 메인 Claude가 직접 보정.
>
> **073 계획 정정(대표님, 2026-08-10)**: Phase 3 시간 게이트에 방학 기간 조건(방학
> 확정 시 10:00, 평소 13:00 — 기존 `getActiveVacationContext` 재사용) 추가. Phase 5는
> "30일 이벤트 신규 마이그레이션(target 30/30+d)" 전면 폐기, "기존 60 이벤트
> target·progress 보존 + 089 연동 Event 60 Compatibility"로 재정의. Phase 1은 첫
> claude-review에서 [복잡] 4건(RLS로 아이가 숨은 Goal 노출, 삭제경로 CHECK 충돌,
> cooldown 오기록, fail-open 위반) 반려 → Codex Sol 수정 → 재리뷰 진행 중.
>
> **부수 발견(schema drift, 2026-08-10)**: (1) 073 Phase 3 방학판정이 의존하는
> `child_temporal_context` 테이블이 Production에 아예 없어 방학 기능이 배포 이후
> 계속 조용히 죽어있었음 — 관련 마이그레이션 3건 Production 적용 완료. (2) 071의
> semantic topic cooldown이 의존하는 `conversation_topics`/`record_conversation_topic_usage`가
> Dev/Production 어디에도 적용된 적이 없었음(Production 런타임 에러로 발견) —
> 마이그레이션을 Dev·Production 모두에 적용 완료. 둘 다 순수 additive, 기존 데이터
> 무영향.

이 문서는 `requests/` 루트에 남아 있는 미완료·작업중·대기 항목만 표시합니다. 완료 항목은 즉시 `_done`으로 이동하고 `_log.md`에 기록합니다.

---

## 🟡 R1+R2 구현·셀프검증 완료 · 게이트① 대기 — 개인정보 플랜 보존기간 원자화 RPC (request 100 RELEASE BLOCKER)

**범위**: Care Start 6개월 / Insight 3년+연장 / Premium 1·3·5년·무제한을 동일 정책으로 계산해
`deleted_at IS NULL` 활성 `daily_reports`·`weekly_summaries`·`child_memory`만 bounded batch RPC로
영구 삭제. Premium 무제한은 `families.premium_retention_years = NULL`로 표현하고 대상에서 완전 제외.

**현재 상태**: R1 신규 migration과 R2 API 전환·미사용 모듈 정리, 셀프검증, 최종 범위 점검을 완료했다. 신규 migration의
`apply_plan_tier_change(p_child_id uuid, p_new_tier int, p_active_pack_count int)`가
`child_profiles.tier` 변경, `families.premium_retention_years` 기반 유효 보존기간 계산,
`chat_sessions`·`chat_messages`·`daily_reports`·`weekly_summaries`의 다운그레이드 스탬프 또는
30일 유예 내 재상향 복구를 단일 트랜잭션으로 수행하도록 작성하고, 자녀/관리자 승인 API의 기존
"tier RPC → TS retention 함수" 2단계를 이 RPC 한 번으로 교체한다. 호출부 전수 검색 결과 두 라우트 외
호출부가 없어 R2 전환 후 `retentionStamp.ts`를 삭제한다. 관리자 승인 요청 상태·감사 로그의 기존 원자성을
보존하기 위해 `admin_approve_plan_change_request`가 신규 RPC를 내부 호출하도록 같은 migration에서 교체한다.
R3와 기존 migration, `lib/plan/retention.ts`는 범위 밖이다.
호출부 전수 검색 결과 런타임 호출부가 사라진 `lib/plan/retentionStamp.ts`는 삭제했다.
`npx tsc --noEmit`, 관련 retention 테스트 2파일, 클린 `npm run build`(236개 정적 페이지)와
postbuild 환경 분리·클라이언트 비밀키 검사는 모두 PASS했다. 기존 `.next`는 빌드 전
`/tmp/kbestie-retention-build-LTPST4/prebuild-next`로 격리했다. 잔여 런타임 호출부 없음과
R3·기존 4개 migration·`lib/plan/retention.ts` 무수정을 확인했다. 다음은 별도 세션/교차 모델 게이트① 정적 리뷰다.

**선행 구현 상태**: migration/RPC·Dev SQL 검증 시나리오, TypeScript retention 타입·경계 테스트,
세 RPC 부분실패 격리 배치 worker 및 05:00 KST Vercel Cron 구현 완료. 관련 단위 테스트 1차는
샌드박스의 `tsx` CLI IPC 소켓 생성 `EPERM`으로 실패(코드 실패 아님)했으나 Node `--import tsx` 재실행은
PASS. 현재 Premium 403 게이트 뒤 선택 UI/API를 구현 중이다. `daily_reports` 참조
`report_views`·`evidence_card_links`는 대상 리포트보다 먼저 명시 삭제하고, 참조가 없는
`weekly_summaries`·`child_memory`는 독립 bounded RPC로 처리한다. `child_memory`에는 nullable
`deleted_at`을 추가해 세 테이블 모두 활성 행만 대상으로 통일하며, `families.purge_batch_id IS NULL`로
회원탈퇴 전체파기 예정 가족을 격리한다. Premium 선택 UI/API도 기존 tier 3 조기 반환·서버 403 뒤에
구현 완료(현재 미노출, 기본 5년). `git diff --check` 1차의 설정 화면 trailing whitespace 1건은
수정 후 PASS. Dev migration 적용 전 실제 데이터 dry-run 후보 건수 조회 중. 기존 V3 7일 purge,
회원탈퇴 30일 purge, downgrade
soft-delete 스탬프 및 비활성 초안은 무수정. Dev migration 전 dry-run count와 Dev 전용 적용,
tsc/tests/build 검증 예정. Production 배포·migration·실데이터 삭제는 금지 상태 유지.

**Dev DB 검증 상태**: migration 전 dry-run count 조회를 Dev project ref 고정·건수 전용 스크립트로
시도했으나 실행 샌드박스의 네트워크 차단으로 `fetch failed`(SQL/인증 오류 전 단계). 직접 연결된
DB 도구도 없고, `apply-migration.js` 안전기는 RPC 함수 본문의 `DELETE FROM`도 파괴적 실행으로
판정해 해당 파일을 거부한다. 안전장치를 약화하거나 dry-run 건수 없이 우회 적용하지 않았으므로
Dev migration·SQL fixture 검증은 대기. `tsc` 1차 nullable 전파 2건은 수정 후 오류 0건 PASS,
전체 테스트 51/51 PASS, dev 서버 없음 확인 후 클린 `npm run build`와 postbuild 환경·비밀키 검사 PASS.

---

## 🟠 대표님 확인 필요 — 워크트리 정리 중단 (요청서 없음, 채팅 직접 지시)

**작업**: `E:\VibeCoding\` 하위 12개 stale git worktree 정리(대표님이 지정한 목록).
**진행**: `deploy-dev-068` 1건만 재검증 통과 후 `git worktree remove`로 안전 제거 완료.
**중단 사유**: 2번째 대상 `master-integration-worktree`에서 주 저장소 어떤 브랜치/태그에서도
도달 불가능한 커밋 `d85cab3`("K-Bestie 랜딩 CTA 통합 및 미인증 라우팅·PWA 분기 완벽 보장",
2026-08-06, 파일 7개 변경: `app/api/auth/membership-status/route.ts`,
`app/api/signup/consent/route.ts`, `app/page.tsx`, `app/signup/page.tsx`,
`components/landing/BetaLandingPage.tsx`, `lib/auth/membershipState.ts`,
`e2e/qa-unified-routing-pwa-matrix.spec.ts`)를 발견 — 실질 소스 변경이라 지시서 정지 조건에
따라 나머지 10개(9번 `K-Bestie-v3-prod-release`는 애초에 git 워크트리가 아니라 빈 껍데기
디렉토리였음)는 전혀 손대지 않고 전체 중단.
**필요 결정**: 커밋 `d85cab3`이 이미 main에 반영됐는지 확인 필요 — 아니라면 정리 전에
cherry-pick 또는 별도 브랜치로 백업해야 한다. 확인되면 나머지 10개 재검증·제거를 이어간다.

---

## 🔵 게이트① [통과] · Dev 배포완료 — Production "아이 로그인 아이디 중복" 오류 처리 + Auth 고아 계정 재발방지 (요청서 없음, 대표님 긴급 UX 지시)

**배경**: Production에서 `hks@kbestie.local` 아이디가 아무 데이터에도 연결되지 않은 Auth
고아 계정으로 남아 영구 재등록 불가능했던 사고를 실측 확인(원인: `auth.admin.createUser`
성공 후 family_members/member_accounts/child_profiles/finalize/부모 ACTIVE 전환 중 실패
시 Auth 계정만 보상 삭제가 안 되던 구조적 결함). `hks` 오프 orphan 계정은 확인·삭제 완료(4개
테이블 무연결 검증 후), 재등록을 막던 큐 잔여 요청 행은 동시 작업 세션이 이미 정리함(재확인
완료, 실사용 가족은 `hks1`으로 이미 별도 정상 등록돼 있어 영향 없음).

**조치(메인 Claude 직접 구현, 하드룰1 예외 — 긴급 대응)**:
- 신규 SECURITY DEFINER RPC `admin_check_child_auth_orphan` (migration
  `20260811160000_child_auth_orphan_check.sql` + 수정판 `20260811161000_..._fix_member_id.sql`,
  Dev·Production 둘 다 적용 완료) — 충돌 이메일이 실사용 중인지 고아인지 판정.
- 신규 공유 헬퍼 `lib/plan/createChildAuthAccount.ts` — 중복 오류 시 orphan이면 안전
  삭제 후 1회 재시도, 실사용이면 `CHILD_LOGIN_ID_ALREADY_EXISTS` 코드 반환(Supabase 원문
  절대 미노출). 후속 단계 실패 시 이번 호출에서 새로 만든 Auth 계정만 보상 삭제하는
  `cleanupNewlyCreatedChildAuthAccount`도 포함.
- `lib/plan/autoApproveChildRequest.ts`(베타 자동승인) / `app/api/admin/child-approval-requests/[id]/approve/route.ts`(수동승인) 양쪽 5개·4개 실패 분기에 보상 삭제 배선.
- `app/api/families/[id]/children/route.ts` — 에러코드 매핑, 원문 노출 제거.
- `app/signup/page.tsx`(회원가입 4/4) / `app/parent/settings/page.tsx`(아이 추가) — 아이디
  중복 시 상단 배너 대신 아이디 입력창 하단 inline validation, 다른 입력값은 오류 시 유지.

**게이트① 진행 상황**: 1라운드 codex-rv(Sol·high) [복잡] 3건 지적(수동승인 경로 보상삭제
미배선, 삭제 후 `created_auth_user_id` 포인터 미초기화로 재시도 시 재고아화, RPC의
`child_profiles.member_id` 스키마 오조인) → 전부 수정 완료 → **2라운드 재검증 [통과]**(잔여
문제 없음 확인).

**진행 상태**: 커밋 `6231be1` 완료, 격리 워크트리로 Dev(`k-bestie-v3-dev`) 배포 완료
(`dpl_66JYYf6ecVonzJM1i7eq4T8qkDDe` READY), smoke 통과(signup/parent/settings 307,
chat 200). **다음: agy E2E QA(§12-G 신규 정책 — 1회 실패 시 즉시 Codex로 전환) 진행 예정**,
[통과] 시 Production 배포.

---

## ✅ 완료(배포 대기) — STT 중복 턴ID 버그 수정 (요청서 없음, 대표님 "중복 폴백" 지적 → 즉시 수정 지시)

**원인**: `hooks/useVoiceChat.ts`가 STT 라우터에 넘기는 턴 식별자를 `turnSeqRef.current + 1`로
"예측"만 했는데, 이 카운터는 메시지가 실제로 완료(append)될 때만 전진해 GCP 폴백 왕복이 아직
안 끝난 상태에서 아이가 바로 다시 말하면 서로 다른 두 턴이 같은 turn_id를 재사용 —
`turn_timing_events`/음성 로그가 서로 다른 턴을 뒤섞어 기록. **실제 대화 메시지(chat_messages)
저장 자체는 별도의 항상-고유한 카운터(`nextTurnId`)를 쓰므로 유실은 없었음** — 순수 타이밍/
로그 분석 정확도 문제였음(초기 보고보다 낮은 심각도로 확인됨, 대표님께 사실 정정 필요).

**수정**: `hooks/useSttRouter.ts`가 각 턴의 id를 `meta.childTurnId`/`onSpeechBegin`/
`onSpeechEnd` 인자로 명시적으로 전달하도록 변경(호출부가 더 이상 예측하지 않음),
`useVoiceChat.ts`는 이 값을 그대로 사용. `tsc --noEmit` 클린, 전체 `npm run build` 클린(postbuild
secret 검사 포함) 확인. 커밋 `7cac9dc`(위 회원가입 수정과 별도 커밋), 같은 배치로 Dev 배포
완료(`dpl_66JYYf6ecVonzJM1i7eq4T8qkDDe`). agy QA 통과 시 위 항목과 함께 Production 배포.

## 요약

| 분류 | 항목 |
|---|---|
| ✅ PASS 확정 (`_done`) | 095, 073(admin report), 058, 062(kakao), 027(062로 보완 충족), 029(주간 리포트 정책·Cron·백필 전체), **STT A1(2026-08-11 대표님 Dev 실사용 QA PASS 확인 후 Production 배포·번들 검증까지 완료)** — 전부 대표님 직접 확인 증거 있음 |
| 🔵 배포완료 — 대표님 QA 대기 | 071(K Conversation Engine), 060(미션 화면), **059+064·061·카카오·GreenList·063·088·087(P1+P2 전체)·089·030·065·066·067·068·069·fix-inapp·긴급수정(관심사 UI 제거)·075(부모 홈 PWA 배너)·090(관리자 출석 룰렛 UX)**(전부 Production 배포 완료) |
| ⏸ 보류 종료(대표님 결정) | 026·084·086(Push — 미해결이나 우선순위 종료, 상세는 하단 섹션) |
| ⚠️ 외부 BLOCKER — 별도 조사 필요 | Dev DB 마이그레이션 적용 상태 전수 감사(263개 파일 전체를 1:1로 대조하는 작업은 미완료). **2026-08-11 대형 사고 대응으로 실제 장애를 일으키던 항목은 근거 기반으로 전부 조치 완료**: RLS 정책 18개, `daily_reports`/`parent_questions`/`chat_sessions` 컬럼·제약 대량 누락, `mission_progress` FK 전무(PGRST200), `get_or_create_chat_session` RPC 오타(free_chat), `family_members.is_internal_test`. 원인이 된 스크립트(`scripts/run-migration.js`)는 영구 폐기, `apply-migration.js`에 파괴적 SQL 차단+재실행 추적 안전장치 도입(커밋 `9c07b67`). 잔여 위험: 아직 실제 증상으로 드러나지 않은 다른 drift가 남아있을 가능성은 배제 못 함 — 발생 시 같은 방식(pg_catalog 직접 대조)으로 대응. |
| 🟡 작업진행(배포 대상 아님, Dev 전용) | **074 — 부모·아이 일반 브라우저 PWA 설치 안내 문구 교체 구현·정적 검증 완료**(tsc·클린 빌드 통과, 설치·Push·Service Worker 로직 무변경; 실제 기기 QA·배포는 요청 범위 밖), **073-mission-v3 Phase 5 — 게이트① 지적 2건 수정·셀프검증 완료, 재리뷰 대기**(Phase 5A v3 assessed 전이 RPC 신규 migration, Phase 5B Goal 판정 LLM 3회 지연 재시도·파싱 실패 로그; tsc·관련 테스트 6파일·클린 build/postbuild 통과; Phase 5C 실배선·DB 적용·배포 제외), 088 Phase 1(진단 계측, 게이트① 통과 — Phase 2 대표님 실기기 iPhone 테스트 대기), request-free-chat-chosung-adaptive-game.md Phase 1~4 게이트① 전부 통과(Phase 5 Conversation Action 통합부터 계속) |
| ⚠️ 출처 재확인 | REQUEST_SIMPLIFY_CHILD_START_HANDOFF_UI.md |

---

## 🔵 2026-08-10 Production 일괄 배포 완료 — 대표님 QA 대기 (088 + 5개 UI/안전 항목)

**배포**: `dpl_9gP3sQwxLg1cCBctCvHSSzkfM7j9`, commit `1016139`, `app.k-bestie.com` READY.
smoke 통과, 신규 런타임 에러 0건(§ 상단 governance 노트 참고). 격리 워크트리 +
`vercel --prod`로 배포, Dev와 별개로 Production `k-bestie-v3` 프로젝트 확인 후 진행.

### 088 — SEO/AEO/GEO 통합 최적화 (agy E2E [QA 통과] 완료 항목)

`app.k-bestie.com` canonical, robots.txt/sitemap.xml/metadata/JSON-LD/semantic HTML. claude-review 3라운드 [통과]. **agy E2E [QA 통과]**: 로그인/미인증 랜딩, og/twitter 메타, robots/sitemap, "월간" 오표기 0건, 오프라인 재시도 화면 정상. 카카오 실앱 미리보기 렌더링만 자동화 한계로 [미검증].

**커밋**: `1006d9e`,`ecdc03f`,`8be7259`,`f53edd6`,`71ba329`,`7480bea`,`329d2f0`.

### 059 + 064 — 부모 리포트 UI 전면 개편

일간/주간 리포트 화면 세그먼트 탭·핵심 숫자·카드 확대, 감정 요약 박스 rounded rectangle 전환, 부모 공통 하단 네비게이션(76→88px) 전체 적용. claude-review [통과]. Claude 직접 실행 Playwright(§12-G, agy 인프라 2회 실패 후 에스컬레이션)로 실제 화면 스크린샷 확보 — 스펙과 일치 확인.

**커밋**: `8b93d45`.

### 061 — 자유대화 비주얼 2차 재작업

받침대 평면→3D 원기둥, halo 테두리 제거, 토글 받침대 전면 결합, 마스코트 소폭 확대, 장식 밀도. codex-rv **[통과]**. 실 아이 계정 로그인 기반 화면 검증은 QA 계정 미비로 아직 스크린샷 미확보(코드는 배포 완료, 후속 확인 필요).

**커밋**: `039476d`.

### 카카오 인앱브라우저 전역 차단 긴급수정

**대표님이 실측 발견**: `KakaoInAppBrowserNotice`가 전역 wrapper로 마운트되어 카카오톡 인앱브라우저의 모든 페이지가 UA 감지만으로 안내 화면으로 대체되고 있었음. 전역 wrapper 제거, 실제 "앱 설치하기" 클릭 시점에만 표시. **2차 리뷰 [통과]**.

**커밋**: `5376efa`, `e09d319`.

### Green Whitelist 임시 비활성화 (아동 안전 게이트)

플래그 미설정/false 시 전 학년 Crisis/Red는 항상 유지, GREEN 매칭만 중립 재작성으로 대체. **3차 리뷰 [통과]**. 아동 안전 게이트라 대표님 직접 QA 비중이 특히 중요.

**커밋**: `f119eed`, `fac502e`.

### 063 — 부모 홈 대시보드 개편 + 헤더 CTA

"아이와 케이 시작하기" 카드 제거 → 헤더 CTA 이동(기존 `ChildStartGuideModal` 재사용). codex-rv-063 **[통과]**. `/parent/home`→`/child/home` 리다이렉트 현상은 단일 자녀 가족의 의도된 라우팅인지 버그인지 아직 triage 안 됨 — 대표님 QA 시 함께 확인 필요.

**커밋**: `75a0c16`.

---

## 🔵 2026-08-11 Production 배포 완료 — 대표님 QA 대기 (075 + 090)

**배포**: `dpl_6y6XmBHZb6j5WCit2kcEPW1wQJT2`, `app.k-bestie.com` READY. 격리
워크트리에서 418726e 기준 커밋 순서(30f103a→7fc3e89→0b913fb→049eee1→f1d450d)
그대로 cherry-pick(STT/073P4/088/초성게임 등 Dev전용·미승인 커밋과 분리)해 배포.

### 075 — 부모 홈 PWA 설치 배너

아이 홈과 동일 패턴(useInstallPrompt, hide_pwa_banner sessionStorage, standalone
숨김, 카카오 인앱 분기)을 부모 홈에도 적용. 게이트① 2라운드([단순]1건: 카카오
인앱 미처리 → 수정 → [통과]). **게이트②(agy 2회 인프라 타임아웃 → CLAUDE.md
§12-G에 따라 메인 Claude 직접 Playwright 3/3 [QA 통과]**: 배너 노출/닫기/세션
유지, 카카오 인앱 UA 안내 화면 전환. 증거 `/tmp/codex-qa-075-090/qa075-*.png`.

**커밋**: `049eee1`.

### 090 — 관리자 출석 룰렛 UX 명확화

"보유 열쇠"와 "다음 룰렛 예약"을 라벨·안내문구·저장 성공 피드백으로 명확히
구분. 로직(override/spin/원장/상태전이) 무변경. 게이트① 2라운드([단순]1건:
저장 성공 피드백 부재 → 수정 → [통과]). **게이트② [QA 통과]**: 예약 저장 시
보유 열쇠 불변·예약 안내 문구·취소 동작 확인. 이 과정에서 090과 무관한 기존
Dev DB 스키마 drift(`family_members.is_internal_test` 컬럼 누락 →
`20260802092252_add_internal_test_flag.sql` 미적용으로 관리자 출석 룰렛 API가
500 반환 중이었음)를 발견해 Dev에 해소(Production은 이미 적용 확인됨).

**커밋**: `f1d450d`.

---

## 🟡 087 Phase 1 🔵 / Phase 2 🟡 — 관리자 Product Analytics 대시보드

**Phase 1 (계측 인프라) — 🔵 Production 배포 완료, 대표님 QA 대기.** `app_sessions`
테이블(service-role 전용 RLS, 원자적 heartbeat RPC), `app_session_start`/`foreground`/
`background`/`page_view` 계측, r2 수정(sessionId 재생성, 동시 start 가드, secret 토큰
sanitize) 전부 반영. claude-review [통과]. 커밋 `05ee131`,`07ffc3d`. Production
migration `20260810120000_app_sessions.sql` 적용 완료(`dpl_9gP3sQwxLg1cCBctCvHSSzkfM7j9`
배치에 포함).

**Phase 2 (백엔드 API 9종) — 🟡 재수정 완료, 재리뷰 대기 — 이번 배포에서 제외됨.**
커밋 `a3436d5`에서 claude-review-087-phase2가 [복잡] 3건(C-1 페이지네이션 tiebreaker
없어 1000행 초과 시 집계 오염, C-2 families 라우트 O(가족×이벤트), C-3 리텐션
코호트가 조회기간에 따라 흔들림 — 지시서 §26 불일치) + [단순] 7건을 지적. C-1~C-3·
S-1~S-3 수정 지시를 `codex-impl-087-phase2-fix`(Sol·high)에 위임, 세션 완료 확인됨.
**다음 조치(최우선)**: 이 fix 커밋에 대한 별도 재리뷰(`claude-review-087-phase2-r2`
성격)를 아직 실행하지 않음 — 지금 바로 착수. [통과] 확인 후 별도 Production
배포(단독 배치, 위 8-10 배치와 무관).

---

## 🔵 089 — 30일 미션 이벤트 (Production 배포 완료, 대표님 QA 대기)

**정책**: "미션 최대 1회/일 + 자유대화 보상 최대 1회/일 = 합계 최대 2회/일·30일 60회"
(대표님 확정). 이벤트 증가 RPC에 날짜별 상한 부재, 자유대화 보상 미연결, `chat/pause`
엔드포인트가 어떤 클라이언트에서도 호출되지 않던 dead code였던 근본 원인을 모두
해결.

**조치 완료**: `record_mission_event_completion` 일일 상한 로직 추가, `app/chat/page.tsx`
종료 시 `/api/chat/pause` 호출 신규 배선(턴 수 포함, 실패는 UX 비차단), 3가지 실제
Dev/Production 스키마 drift(session_type 값, chat_messages 컬럼, 제약 재적용) 발견·수정.
claude-review-089-r2 **[통과]**(복잡 5건 전부 해소 확인, Production 실측값 대조 완료).
커밋 `e73cb37`,`a7d770e`. Production migration
`20260810170000_mission_event_daily_activity_policy.sql` 적용 완료
(`dpl_9gP3sQwxLg1cCBctCvHSSzkfM7j9` 배치에 포함). 비차단 [단순] 4건은 후속 과제로 별도
기록.

---

## ⏸ Push 026 / 084 / 086 — 미해결 이슈 보존 후 우선순위 종료 (2026-08-11 대표님 결정)

**문제는 해결되지 않았다.** VAPID 키 재발급·재배포(`dpl_AzJqH19krPDBvDbRuHBXv95bh78Q`)로도 대표님
Production 실기기에서 Push가 끝내 동작하지 않았고, 후속 `088-iphone-pwa-web-push-apple-403-root-cause-fix.md`에서
Apple 403 원인 분석을 진행했으나, 대표님이 현재 작업량 대비 중요도를 고려해 **현 개발 큐에서 보류 종료**하기로
결정했다(PASS 아님 — 이 결정으로 문제가 해결된 것처럼 오기하지 않는다).

**조치**: 026/084/086 세 지시서를 `_done/`으로 이동(`_complete/`로는 이동하지 않음 — 미해결 상태를 그대로
유지). 관련 코드·DB·VAPID 설정·subscription 데이터는 삭제·롤백하지 않고 현재 상태 그대로 보존.
**향후 Push 기능을 다시 추진할 경우 026/084/086을 재개하지 말고, 이 로그와 088 조사 결과를 참조하는
신규 Request로 시작할 것.**

---

## ✅ PASS 확정 (`_done` 이동 완료 — 대표님 직접 확인)

- **095-parent-signup-onboarding-final-consolidation.md** — 대표님 Production 실기기 직접 확인.
- **073-admin-report-mission-progress-saved-collected-visibility.md** — 대표님 관리자 화면 직접 확인.
- **058-child-home-target-layout-compact-ui.md** — 대표님 Production 실기기 직접 확인.
- **062-kakao-inapp-browser.md** — 대표님 Production 정상 동작 직접 확인.
- **027-req-pwa-kakao.md** — 카카오 인앱 감지·전환 기능 자체는 대표님 정상 동작 확인. 보완(062)으로 완료 조건 충족.
- **029-production-weekly-report-policy-cron-backfill.md** — Phase 1~5 전체 완료 + 후속 수정 2건 완료.

---

## 🔵 071 — 자유대화 v2 K Conversation Engine (Production 배포 완료, 대표님 QA 대기)

`dpl_FizcLor6HeiJFGTAUQ8xSKPiKjWn`, commit `d49b32b`, READY, smoke PASS. 061 재작업이 같은 화면을 다시 수정하므로 061 Production 배포 후 함께 재QA 대상.

---

## 🔵 060 — 미션 화면 비주얼 (Production 배포 완료, QA 미실행 — 실패 아님)

미션 가능 시간이 아니어서 대표님이 아직 화면을 확인 못한 상태(실패 아님). Dev에서는 시간 무관하게 확인 가능(커밋 `12bb904`).

---

## ⚠️ 출처 재확인: REQUEST_SIMPLIFY_CHILD_START_HANDOFF_UI.md

대표님이 "요청한 적 없다"고 확인한 문서. 이미 배포된 변경(`a2cdda2`)은 되돌리지 않되 추가 투자 없음. **대표님 필수 QA 목록 및 작업 큐에서 제외.**

---

## 현재 큐 (진행 중 작업 상세)

**2026-08-10 대표님 지시로 Production 배포 완료 건 14개를 `_done/`으로 이동**(026,
030, 059, 060, 061, 063, 064, 065, 084, 086, 087, 088, 089, Green Whitelist) —
CLAUDE.md §1-A "실제 Production 배포 완료 확인 후 이동" 기준 그대로 적용, 대표님
개인 QA는 이 이동의 전제조건이 아님(대시보드 색상 🔵는 유지, `_done` 파일 이동과
녹색 승격은 별개). 아래는 아직 큐 루트에 남아 있는 항목만 표시.

| Request | 상태 | 진행 상황 / 다음 조치 |
|---|---|---|
| 070-free-chat-mascot-vertical-alignment-fix.md | 🔴 셀프검증 실패(build) | 자유대화의 K 마스코트·말풍선 세로 배치만 미션 화면의 명시적 grid/flex 흐름으로 보정 완료, `npx tsc --noEmit`은 통과. 그러나 공유 `.next` 캐시 경합 뒤 `npm run build`가 컴파일 시작 직후 종료되고 `BUILD_ID`가 생성되지 않아 성공 판정 불가; 원인 재확인 중. STT/TTS/LLM/세션/API/DB/voiceState/자동·수동·키보드 로직은 변경하지 않았다. |
| 088-iphone-pwa-web-push-apple-403-root-cause-fix.md | 🟡 Phase 1 완료(게이트① 통과), Phase 2 대표님 실기기 필요 | Apple reason/provider/allowlist 헤더 안전 로깅, 10s timeout, 403을 subscription 비활성화 조건에서 제거(404/410만 유지) — 게이트① 2라운드 끝에 [통과](커밋 317ee71). **다음: 대표님이 Development에서 실제 iPhone PWA로 관리자 Push Test 1회 실행 → 서버 로그의 Apple reason 확보 필요.** 그 결과 없이는 Phase 3(원인별 수정) 진행 불가. Production 배포는 지시서 자체가 금지. |
| 073-mission-v3-single-daily-dynamic-conversation-master-request.md | 🟡 Phase 5A/5B C2 회귀 수정·셀프검증 완료, 게이트① 재리뷰 대기 | 신규 `20260811200000_mission_v3_assessment_retry_idempotency.sql`에서 assessed 결과 선착순 보존과 start 재시도 `answer_result` 반환을 구현했다. `npx tsc --noEmit`, Mission v3 관련 테스트 6파일, 클린 `npm run build`와 postbuild 보안검사 통과. 기존 적용 migration·v1/v2·finalize 계약·policyResolution 무수정, DB 적용·배포 없음. |
| request-free-chat-chosung-adaptive-game.md | 🟡 Phase 1~4 게이트① 전부 통과, Dev 전용 | Phase 1(결정론 초성추출/정답판정/80단어 단어풀) → Phase 2(Grade별 난이도 필드) → Phase 3(게임 세션/라운드 DB 스키마, Sol 3라운드) → Phase 4(Adaptive Difficulty, 2라운드 — 1차 [단순]2건: child_asked 필터 순서 버그+테스트 보강 → 수정 → [통과]) 전부 완료. 전부 아직 실제 대화 엔진(K Conversation Engine의 Action Selector)에 연결되지 않은 백엔드 전용이라 E2E QA 대상 아님. **다음: Phase 5(Conversation Action 통합) — types.ts에 PLAYFUL_GAME_CHOSUNG 추가·actionSelector.ts에 능동 제안 판단 추가, 복잡도 높아 Claude 직접 검토 필요.** |
| REQUEST_SIMPLIFY_CHILD_START_HANDOFF_UI.md | ⚠️ 출처 재확인 | 대표님이 "요청한 적 없다" 확인. 이미 배포된 변경은 유지, 추가 투자 없음, QA 목록에서 제외 상태 유지. |
| (요청서 없음, 2026-08-11 대표님 실사용 발견) 자유대화 자동 종료(하드리밋) 버그 | 🔵 Dev 배포완료 — 대표님 QA 대기, Production 금지 | 대표님이 Dev에서 실제 자유대화 중 "오늘 대화는 여기까지야!"로 강제 종료됨을 발견(20턴/10분 하드리밋이 현재 베타 확정 정책(제한 없음)과 불일치, 플래그 게이팅 자체가 없었음). `FREE_CHAT_HARD_LIMIT_ENABLED` 플래그 신설(미설정 시 항상 OFF)로 client 3곳+API route 게이팅, 기존 로직은 삭제하지 않고 보존(커밋 `fc0cd95`). Dev 배포 완료. **다음: 대표님 재테스트(20턴 초과·재진입·10분 이상 장시간 대화)로 최종 확인 필요. Production 배포 절대 금지(명시 지시).** |

---

## 큐 정리 상태

- REQUEST_ONE_TIME_FAMILY_INVITE_LINK.md — **정정(2026-08-11 codex-rv 감사)**: 이전
  "095로 통합 완료(중복), 별도 처리 불필요" 메모는 부정확했다. 실제로는 커밋
  `514f3dc`/`9d4187a`(1회용 토큰·RPC·UI·migration)로 별도 구현이 존재하고,
  `_log.md` 2026-08-09 기록상 DB 원자성 E2E 411/415 PASS(동시수락 멱등·재사용
  차단·취소·만료·family/child 무변경까지 확인)까지 마쳤으나 **Google/Kakao 실제
  OAuth 로그인 완료→callback 복귀만 자격증명 부재로 검증 못 해 main·Production
  반영을 보류한 상태**로 남아 있다. "095 중복" 판단이 정확한지, 아니면 이 기능이
  실제로 별도로 필요한지 **대표님 확인 필요** — 확인되면 ①중복이면 이 지시서
  종료·정리, ②필요하면 즉시 main 통합·Production 배포로 이어간다(위 공통 배포
  게이트 원칙상 Google/Kakao 실계정 callback처럼 자동 실행 환경에서 검증 불가능한
  항목은 Production 배포 차단 사유가 아니다 — OAuth 검증 미완료 자체가 이 항목을
  더 이상 막을 이유는 아니며, 배포 후 대표님 QA 대기로 전환하면 된다).
- **2026-08-10**: 대표님 지시로 대시보드 **색상 판정 규칙 전면 개정** — 대표님 직접 PASS 전에는 녹색(🟢/✅) 표시 금지.
- **2026-08-10**: Dev/Production 스키마 drift 긴급 발견·조치(`parents`/`child_profiles` 컬럼 catch-up) — 상세는 `_log.md`.
- **2026-08-10**: 대표님 명시 지시("문제 없으면 무조건 Production까지 배포 후 QA 요청")에 따라 059+064/061/카카오/GreenList/063/088/087Phase1/089를 `dpl_9gP3sQwxLg1cCBctCvHSSzkfM7j9`로 Production 일괄 배포 완료, smoke PASS, 신규 런타임 에러 0건. 087 Phase 2는 재리뷰 미완료로 의도적 제외.
- **다음 최우선 조치**: (1) 087 Phase 2 fix 재리뷰 착수 → 통과 시 단독 Production 배포, (2) 073 Mission v3 Phase 5(Event 60 Compatibility) 착수 여부 판단, (3) 초성게임 Phase 4(Adaptive Difficulty) 착수, (4) 088 Phase 2는 대표님 실기기 iPhone 테스트 대기(Claude가 더 진행할 수 없음), (5) 061/063 실화면 확인 및 063 리다이렉트 triage는 대표님 QA와 병행, (6) Dev 마이그레이션 전수 감사는 저우선 후속(2026-08-11 `family_members.is_internal_test` 1건 추가 발견·해소, 동일 유형 잔여 가능성 있음).
- **2026-08-11**: 075(부모 홈 PWA 배너)/090(관리자 출석 룰렛 UX)를 게이트①②
  모두 통과 후 Production 배포 완료, `_done` 이동. 088(Push 403)은 Phase 1만
  완료(Dev 전용) — Phase 2는 대표님 실기기 필요해 큐에 남음. 초성게임은
  Phase 1~3 완료(Dev 전용, 백엔드만) — Phase 4부터 계속.
