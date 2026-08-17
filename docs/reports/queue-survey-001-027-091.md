# 큐 지시서 조사 및 착수 분석 보고서 (001 / 027 / 091)

> **작성 일시**: 2026-08-12  
> **조사 대상**:  
> 1. `requests/001-answer-dashboard.md`  
> 2. `requests/027-feature-landing-support-inquiry.md`  
> 3. `requests/091-admin-acquisition-existing-links-landingpage-migration.md`  
> **조사 기준 워크트리**: `/mnt/e/VibeCoding/K-Bestie-v3` (`main`)  
> **운영 원칙 준수**: 비즈니스 로직 신규 작성 없음 (순수 현황 조사 및 요약 보고서)

---

## 1. `requests/001-answer-dashboard.md`

### 1-1. 요구사항 핵심 요약 (3~5줄)
- **3개 긴급 작업 통합 지시서**: (1) 073 Mission v3 백엔드 준비 완료 상태를 넘어 실제 아이 미션 클라이언트(`app/child/missions`) 런타임에 v3 API(`start`→`turn`→`today-progress`)를 실배선 연결, (2) P0 Mission 수동모드 최초진입 시 마이크 자동 시작 버그 및 키보드 모드 전환 후 입력 잠김 버그의 근본 원인 재현 및 수정, (3) 076 미션 키보드 모드 K 실시간 상태 UI(`waiting`/`listening`/`thinking`/`speaking`) 표시 및 모드 전환 중 세션 연속성 보장을 요구함.
- "백엔드 존재"나 "테스트 통과"가 아닌 실제 사용자 화면 및 런타임 동작 기준으로 완료를 판정하도록 지시함.

### 1-2. 범위에 명시된 파일 / 경로
- `app/child/missions/page.tsx` (아이 미션 메인 화면 및 상태머신)
- `hooks/useVoiceChat.ts`, `hooks/useSttRouter.ts` (음성 세션, 마이크 제어, STT 라우팅)
- `app/api/mission/v3/start/route.ts`, `app/api/mission/v3/turn/route.ts`, `app/api/mission/v3/today-progress/route.ts` (v3 API 라우트)
- `lib/mission-v3/*` (`goalEngine.ts`, `missionAdapter.ts`, `timePolicy.ts`, `rewardPolicy.ts`, `questionBank.ts` 등)
- `components/mission/*` (미션 UI 및 K 상태 표시 컴포넌트)

### 1-3. 기존 관련 코드 / DB 현황 조사
- **백엔드 (v3)**:
  - `app/api/mission/v3/` (`start`, `turn`, `today-progress`) 라우트 구현 완료.
  - `lib/mission-v3/` 모듈군(`goalEngine.ts`, `timePolicy.ts`, `rewardPolicy.ts` 등) 단위 테스트 완료 상태로 존재.
  - Supabase 마이그레이션(`20260811250000_mission_v3_turn_terminal_contract.sql`, `20260811200000_mission_v3_assessment_retry_idempotency.sql` 등) 존재.
- **프론트엔드 클라이언트 (`app/child/missions/page.tsx`)**:
  - 여전히 레거시 `/api/mission/start`, `/api/mission/respond`, `/api/mission/force-end`, `/api/mission/answer`를 호출 중이며 v3로 전환되지 않음.
  - 최근 커밋(`cc547fd`, `1c071fd`)에서 P0 키보드 잠김 및 마이크 자동시작 수정을 시도했으나 런타임 이슈가 남아 재작업 상태(`page.real-repro.test.ts` 테스트 작성됨).
- **관련 계획서**: `docs/plans/073-phase5-wiring.md`, `docs/plans/073-mission-v3.md` 존재.

### 1-4. 대표님 판단 필요 지점 (모호한 지점)
1. **073 클라이언트 롤아웃 방식**: 기존 v1/v2 미션 진행 중인 아이 세션을 즉시 강제 v3로 전환할 것인지, 기존 진행 세션은 v1/v2 완료 후 다음 날부터 v3를 적용할 것인지(Feature Gate/Flag 여부).
2. **P0 수동모드 초기화 정책**: 수동 모드 진입 시 K의 첫 인사 음성(TTS)은 자동 재생되고 마이크만 비활성 대기할 것인지, 아니면 K 음성 재생 없이 완전 수동 클릭 전까지 침묵할 것인지.

### 1-5. 타 지시서와의 파일 범위 중복 및 병렬 가능 여부
- **027/091과의 중복**: 없음 (`app/child/missions/*` 및 `lib/mission-v3/*` 전용).
- **병렬 가능 여부**: 027 및 091과 **완전 독립 병렬 작업 가능**. 단, 001 내부의 3개 작업(073 실배선 / P0 수정 / 076 K 상태 UI)은 `app/child/missions/page.tsx` 한 파일에 집중되므로 내부적으로는 [P0 버그 수정] → [076 K 상태 UI] → [073 v3 실배선] 순차 처리가 안전함.

---

## 2. `requests/027-feature-landing-support-inquiry.md`

### 2-1. 요구사항 핵심 요약 (3~5줄)
- 랜딩페이지(`app.k-bestie.com/`) Footer의 `문의하기 준비중`을 `문의하기`로 활성화하고 클릭 시 비로그인 문의 모달을 띄움.
- 별도 랜딩 문의 DB/관리자 페이지를 만들지 않고, 기존 앱 CS 백엔드 테이블(`support_requests`)과 관리자 접수 화면(`app/admin/customer-requests`)을 그대로 재사용함.
- 비로그인 접수이므로 `user_id = null`, `guardian_id = null`, `child_id = null`을 허용하며, `contact_email`(필수), `content`(필수, 최대 2000자), `source = 'landing'`, `category = 'inquiry'`로 저장함.
- 서버 측 Rate Limit(과도한 연속 요청 방지), 이메일 유효성 검사, XSS 방지 등 보안 검증을 적용함.

### 2-2. 범위에 명시된 파일 / 경로
- `components/landing/BetaLandingPage.tsx` (Footer 링크 교체 및 모달 연동)
- `components/landing/LandingInquiryModal.tsx` (또는 문의 모달 신규 컴포넌트)
- `app/api/support/route.ts` (또는 비로그인 지원용 CS 접수 API)
- `app/admin/customer-requests/page.tsx` (관리자 목록/상세에서 랜딩 출처 및 이메일 표시)
- `app/api/admin/support-requests/route.ts` (관리자 조회 시 nullable 유저 정보 대응)
- `supabase/migrations/*` (`support_requests`에 `contact_email` 및 `source` 컬럼 추가)

### 2-3. 기존 관련 코드 / DB 현황 조사
- **테이블 (`support_requests`)**:
  - `id`, `user_id`, `child_id`, `category` (`inquiry`/`suggestion`/`bug`/`voc`), `subject`, `body`, `status` (`open`/`in_progress`/`resolved`/`closed`), `admin_note`, `request_number`, `submitter_role`, `guardian_id`, `app_surface`, `current_route`, `app_version`, `environment`, `device_info`, `idempotency_key`, `deleted_at` 컬럼 보유 (`supabase/migrations/20260739000000_...`, `20260751000000_...`, `20260808070000_...`).
  - **신규 컬럼 필요**: 비로그인 답변용 `contact_email` 컬럼이 현재 테이블에 없음 (신규 마이그레이션 필요). 출처는 기존 `app_surface`를 `'landing'`으로 재사용하거나 `source` 컬럼 추가 필요.
- **접수 API (`app/api/support/route.ts`)**:
  - 현재는 `const { data: { user } } = await supabase.auth.getUser(); if (!user) return 401;` 로 로그인 필수 제약이 걸려 있음. 비로그인 요청 분기 추가 또는 랜딩 전용 핸들링 필요.
- **관리자 화면 (`app/admin/customer-requests/page.tsx`, `app/api/admin/support-requests/route.ts`)**:
  - 이미 `support_requests` 목록/상세, 상태 변경, 내부 메모 기능 구현 완료. 비로그인 행(`user_id` null)에 대해 이메일 및 출처(`랜딩페이지`)를 렌더링하도록 뷰 보완 필요.
- **랜딩페이지 Footer (`components/landing/BetaLandingPage.tsx`)**:
  - 408~411라인에 `문의하기 준비 중` span이 하드코딩되어 있음.

### 2-4. 대표님 판단 필요 지점 (모호한 지점)
1. **비로그인 이미지 첨부 지원 여부**:
   - 현재 `app/api/support/attachments` 및 Supabase Storage는 인증된 `user_id` 기준 RLS/세션으로 동작함.
   - 지시서 §3에 "기존 업로드 구조 재사용이 어렵다면 이번 구현에서 임의의 별도 Storage 구조를 만들지 말고 기존 구조에 맞춰 구현"이라고 명시되어 있으므로, 1차 구현에서는 비로그인 랜딩 문의 시 **이미지 첨부를 제외(텍스트 전용)**하고 이메일+문의내용만 필수 접수받는 방안 권장 (또는 익명 업로드 정책 승인 필요).
2. **Rate Limit 저장소 정책**:
   - 비로그인 상태이므로 Client IP 기반 10초 1회 및 시간당 5회 제한을 메모리 맵(LRU cache)으로 적용할지, DB 로그 기반으로 할지 (Vercel Serverless 인스턴스 특성 고려 시 인스턴스별 인메모리 + 이메일/IP 중복 DB 체크 결합 권장).

### 2-5. 타 지시서와의 파일 범위 중복 및 병렬 가능 여부
- **001과의 중복**: 없음 (완전 독립).
- **091과의 중복**: `components/landing/BetaLandingPage.tsx`를 공유하나, 091은 이미 main에 병합 완료(`6445b29`)되었으므로 충돌 없이 **병렬/단독 착수 가능**.

---

## 3. `requests/091-admin-acquisition-existing-links-landingpage-migration.md`

### 3-1. 요구사항 핵심 요약 (3~5줄)
- 관리자 `운영 도구 > 유입 링크 관리`에서 생성된 기존/신규 모든 일반 마케팅 유입 링크의 목적지를 `/signup`에서 랜딩페이지 `/`로 전면 전환.
- 기존 DB 내 `acquisition_links` 레코드의 `destination_path`를 `/signup`에서 `/`로 마이그레이션하되 `link_id`, UTM 파라미터, 통계/전환율 데이터는 보존.
- 관리자 복사 버튼의 URL 빌더를 `https://app.k-bestie.com/?...` 형태로 통일하고, 외부 공유된 레거시 `/signup?...` URL 유입 시 랜딩 `/`로 query 파라미터를 유지하며 안전하게 유도.
- 랜딩 CTA(`시작하기`)의 `href`를 서버 렌더링하여 새 탭/우클릭 복사/OAuth 완료 후에도 `link_id` 및 attribution이 유실되지 않도록 보장.

### 3-2. 범위에 명시된 파일 / 경로
- `app/admin/(dashboard)/AcquisitionLinksTab.tsx`
- `app/admin/(dashboard)/AcquisitionDashboardTab.tsx`
- `app/api/admin/acquisition/links/route.ts`
- `app/api/admin/acquisition/dashboard/route.ts`
- `app/page.tsx`, `components/landing/BetaLandingPage.tsx`
- `app/signup/page.tsx`
- `lib/acquisition/captureAttribution.ts`, `lib/landing/preservedHref.ts`
- `supabase/migrations/20260812010000_acquisition_links_landing_destination.sql`
- `e2e/qa-acq-link-landing.spec.ts`

### 3-3. 기존 관련 코드 / DB 현황 조사 (★ 중요: 이미 구현 및 배포 완료)
- **Git 커밋 조사 결과**:
  - 커밋 `6445b29` (`[기능] 유입 링크 → 랜딩페이지 리다이렉트`)에서 **요청서 091의 전 범위가 이미 구현 및 `main` 병합 완료**됨.
  - 마이그레이션 `20260812010000_acquisition_links_landing_destination.sql` 적용 완료 (`destination_path` 기본값 `/` 및 기존 레코드 update).
  - `app/admin/(dashboard)/AcquisitionLinksTab.tsx` URL 복사 빌더 `destination_path` 반영 완료.
  - `lib/acquisition/captureAttribution.ts` 분리 및 랜딩 페이지(`app/page.tsx`)에서 1st-party 쿠키 attribution 캡처 배선 완료.
  - `requests/_dashboard.md` (Row 11): `| 랜딩 유입링크→랜딩페이지 전환 + WHY 케이 문구 수정 | ✅ 완료(Dev+Production) |` 로 기록됨.
- **현재 상태**: 구현 완료 상태이나 요청서 파일 `091-admin-acquisition-existing-links-landingpage-migration.md`가 `requests/` 루트에서 `_done/`으로 이동되지 않고 남아 있는 상태.

### 3-4. 대표님 판단 필요 지점 (모호한 지점)
1. **완료 이동 승인 (`requests/_done/`)**: 커밋 `6445b29`로 구현·Dev/Prod 배포가 끝난 상태이므로, 대표님 실기기/브라우저 링크 복사 및 랜딩 유입 QA 확인 후 `requests/_done/`으로 이동 처리 필요.
2. **레거시 `/signup?link_id=...` 미들웨어 307 리다이렉트 추가 필요 여부**: 현재는 랜딩에서 attribution을 캡처하고 `/signup`에서도 query를 보존하나, 외부 공유된 구 `/signup` URL로 직접 진입했을 때 서버 레벨에서 `/`로 307 리다이렉트시킬지 여부(현재는 `/signup` 직접 진입 시 가입 화면 유지).

### 3-5. 타 지시서와의 파일 범위 중복 및 병렬 가능 여부
- 이미 `main`에 코드가 반영되어 있으므로 다른 지시서와 충돌 없음.

---

## 4. 종합 현황 및 착수 우선순위 매트릭스

| 지시서 | 성격 / 상태 | 수정 대상 경로 | 의존성 / 중복 | 권장 다음 액션 |
|---|---|---|---|---|
| **001-answer-dashboard.md** | 🔴 긴급 버그수정 + 🟡 v3 실배선 (미완료) | `app/child/missions/*`<br>`lib/mission-v3/*` | 027, 091과 파일 완전 분리 (독립) | **최우선 착수 (Codex 위임)**:<br>1. P0 마이크/키보드 잠김 수정<br>2. 076 K 실시간 상태 UI<br>3. 073 v3 실배선 (`docs/plans/073-phase5-wiring.md` 기준) |
| **027-feature-landing-support-inquiry.md** | ⚪ 신규 기능 (TODO, 미착수) | `components/landing/*`<br>`app/api/support/*`<br>`app/admin/customer-requests/*` | 001과 독립, 091 완료분 기반 위 작업 | **계획서 작성 후 착수 (Claude 계획 → Codex 구현)**:<br>1. `support_requests` 마이그레이션 (`contact_email`)<br>2. 비로그인 문의 모달 및 API 연동<br>3. 관리자 화면 출처/이메일 표시 |
| **091-admin-acquisition-...md** | ✅ 완료 (Dev+Prod 배포 완료, 커밋 `6445b29`) | `app/admin/(dashboard)/*`<br>`lib/acquisition/*` | 이미 main 반영 완료 | **정리 작업**:<br>대표님 최종 확인 후 `requests/_done/`으로 이동 |
