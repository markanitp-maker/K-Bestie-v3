# 베타 사용자 승인 및 서비스 플랜 관리 — 구조 분석 보고서

- 대상 지시서: `requests/beta-user-approval-and-production-control.md`
- 작성일: 2026-07-26
- 브랜치: `feat/family-backend`
- **성격: 읽기 전용 조사 보고서. 코드·마이그레이션 파일을 생성하거나 DB를 실행하지 않았다.**
- 표기 규칙: 확인되지 않은 항목은 `미확인`으로 명시했고, 추측으로 채운 항목은 없다.

---

## 1. 현재 구조 분석

### 1-1. 실제 계정 생성·진입 경로 (지시서가 전제한 "회원가입 → 바로 사용"과 다름)

지시서는 "회원가입 → 바로 서비스 사용 가능"을 현재 구조로 적었지만, 실제 코드는 이미 다르다.

| 경로 | 파일 | 실제 동작 |
|---|---|---|
| `/signup` | `/mnt/e/VibeCoding/K-Bestie-v3/app/signup/page.tsx` | **껍데기.** `useEffect`에서 `router.replace("/")` 즉시 리다이렉트. 주석: "베타 흐름 제외: 루트(/)로 즉시 리다이렉트" |
| `/onboarding` | `/mnt/e/VibeCoding/K-Bestie-v3/app/onboarding/page.tsx` | **껍데기.** `/parent/settings`로 즉시 리다이렉트 |
| `/invite/accept` | `/mnt/e/VibeCoding/K-Bestie-v3/app/invite/accept/page.tsx` | **껍데기.** `/`로 즉시 리다이렉트 |
| `/login` | `/mnt/e/VibeCoding/K-Bestie-v3/app/login/page.tsx` | **유일한 실제 진입점** |

즉 "셀프서비스 회원가입 페이지"는 이미 죽어 있으나, **계정 생성 자체는 여전히 막혀 있지 않다.**

**실제 신규 계정 생성 경로 = 소셜 로그인(OAuth) 자동 프로비저닝**

1. `/login` → 카카오/구글 `signInWithOAuth` (`app/login/page.tsx:36`)
2. `/auth/callback` (`/mnt/e/VibeCoding/K-Bestie-v3/app/auth/callback/route.ts`) → `exchangeCodeForSession` 성공 시
3. **service_role 클라이언트로 `parents` 테이블에 upsert** — 신규 사용자면 이 시점에 계정이 자동 생성된다:

```ts
const { error: upsertError } = await serviceSupabase
  .from("parents")
  .upsert({ id: user.id, email: user.email ?? "", name: (user.user_metadata as any)?.name ?? "" },
          { onConflict: "id", ignoreDuplicates: true });
```

4. `/` (`/mnt/e/VibeCoding/K-Bestie-v3/app/page.tsx`) → `/api/auth/auto-join` 호출 → 매칭 실패 시에도 `/parent/home`으로 보내 **가족 그룹을 새로 만들게 한다** (`app/page.tsx:80-84`).

> **결론: 카카오/구글 계정만 있으면 지금도 누구나 서비스에 진입해 가족·아이를 만들 수 있다.** 지시서의 "무분별한 Gemini API 비용 발생 방지"라는 문제 인식은 정확하다. 다만 차단해야 할 지점은 "회원가입 폼"이 아니라 **OAuth 콜백 이후의 자동 프로비저닝 경로**다.

**아이(구성원) 계정 경로:** `/login`의 아이디/비밀번호 폼 → `{username}@kbestie.local` 가짜 도메인으로 `signInWithPassword` (`app/login/page.tsx:65-69`). 아이 계정은 오너 부모가 먼저 발급해야 생기며 **자기 스스로 가입할 수 없다**. 따라서 승인 게이트의 1차 대상은 오너(부모) 계정이다.

### 1-2. 설문조사 / 베타 신청 기능

`app/`, `lib/`, `components/`, `supabase/migrations/` 전체에서 `survey` / `설문` 관련 구현을 검색한 결과 **0건**. 베타 신청 폼·테이블·API 모두 존재하지 않는다. → **신규 개발 필요(가장 큰 미구현 덩어리).**

### 1-3. 서비스 플랜(요금제) — 이미 상당 부분 구현되어 있음

지시서 5번의 "방법 A / 방법 B" 검토는 **기존 구조를 반드시 전제해야 한다.** 새 구조를 처음부터 만들면 안 된다.

| 구성요소 | 위치 | 현재 상태 |
|---|---|---|
| `plans` 테이블 | `supabase/migrations/20260712000000_plans_tier.sql` | **이미 존재·적용 완료**(파일 상단 `[APPLIED 2026-07-11]`). PK `tier INT (1,2,3)`, 컬럼 `name`, `price_krw`, `voice_mode`, `daily_report_detail`, `weekly_report_detail` |
| 시드 데이터 | 동일 파일 | tier 1 = `Care Start`(9,900원, stt_tts), tier 2 = `Insight`(14,900원, stt_tts), tier 3 = `Premium`(150,000원, live) |
| `parents.tier` | 동일 파일 42행 | `INT NOT NULL DEFAULT 1 REFERENCES plans(tier)` — 결제 주체(부모) 단위. 삭제하지 않기로 결정됨 |
| `child_profiles.tier` | `supabase/migrations/20260712300000_child_profiles_tier.sql` | **아이 1명당 요금제 1개**가 요구사항이라 아이 단위로 이전됨. 형제자매 tier 분리 목적 |

**용어 불일치 주의:** 지시서는 `Care Start / Care Insight / Care Premium`이라 쓰지만, DB `plans.name`의 실제 값은 `Care Start / Insight / Premium`이다. 화면 표기와 DB 값 중 무엇을 정본으로 할지 결정이 필요하다(→ 6장 대표님 확인 항목).

### 1-4. 관리자 대시보드 구조

| 구성요소 | 위치 | 내용 |
|---|---|---|
| 인증 (Edge) | `/mnt/e/VibeCoding/K-Bestie-v3/middleware.ts` | matcher = `/parent/:path*`, `/admin/:path*`, `/api/admin/:path*`. 미인증 시 `/api/*`는 401 JSON, 그 외는 `/login` 리다이렉트. 관리자 화이트리스트 불일치 시 403 / `/` 리다이렉트 |
| 인증 (Node, API) | `/mnt/e/VibeCoding/K-Bestie-v3/lib/admin/requireAdmin.ts` | 모든 `app/api/admin/**/route.ts`가 첫 줄에서 `await requireAdmin()` 호출, 반환값이 non-null이면 그대로 return |
| 화이트리스트 판정 | `/mnt/e/VibeCoding/K-Bestie-v3/lib/admin/isAdminEmail.ts` | `ADMIN_EMAILS` 환경변수(콤마 구분). **DB `admin_roles` 테이블이 아니라 환경변수 기반**임에 주의 |
| `admin_roles` 테이블 | `supabase/migrations/20260717150100_admin_roles.sql` | 파일 상단 `DRAFT: 실행 전 사용자 승인 필요, 아직 미적용` — **실제 적용 여부 미확인.** 현재 코드는 이 테이블을 쓰지 않는다 |
| 관리자 UI 진입 | `/mnt/e/VibeCoding/K-Bestie-v3/app/admin/layout.tsx` (18줄, 헤더만) + `/mnt/e/VibeCoding/K-Bestie-v3/app/admin/page.tsx` (1,569줄) | 좌측 사이드바 네비게이션 1개 파일에 탭 전부 인라인 |
| 사이드바 메뉴 정의 | `app/admin/page.tsx:503-509` `ADMIN_NAV_ITEMS` | `overview`(전체 현황), `revenue`(매출·가입자 상세), `cost`(나갈 돈·비용 상세), `ai-config`(AI 설정), `account-restore`(계정 복구 승인) |
| 별도 라우트 페이지 | `app/admin/plays/page.tsx`, `app/admin/retention/**` | 대시보드 외 독립 페이지도 존재(두 가지 패턴 공존) |

**가장 참고할 선례: `account-restore`(계정 복구 승인).** 이번 "베타 신청 관리"와 구조가 거의 동일하다 — 목록 조회 + 승인 + 거절.
- UI: `app/admin/page.tsx:801` `AccountRestoreTab()`
- API: `app/api/admin/account-restore-requests/route.ts`(목록), `.../[userId]/approve/route.ts`, `.../[userId]/reject/route.ts`

### 1-5. 기존 "상태 기반 차단" 선례 2종 (그대로 복제할 패턴)

**(a) 계정 탈퇴 게이트 — 화면 레벨** (`middleware.ts:78-90`)
`parents.account_status`가 `WITHDRAWN_PENDING` / `RESTORE_REQUESTED`이면 `/parent/*` 접근을 `/account/withdrawn`으로 리다이렉트. 컬럼은 `supabase/migrations/20260724000000_account_withdrawal_system.sql:3`에서 추가됨(`TEXT NOT NULL DEFAULT 'ACTIVE'` + CHECK).

**(b) 법정대리인 동의 철회 가드 — API 레벨** (`/mnt/e/VibeCoding/K-Bestie-v3/lib/plan/consentGuard.ts`)
```ts
export async function checkConsentForChild(childId: string): Promise<NextResponse | null>
export async function checkConsentForSession(sessionId: string): Promise<NextResponse | null>
```
차단 시 403 + 한국어 메시지, 통과 시 `null`. 호출부는 `const blocked = await checkConsentForChild(x); if (blocked) return blocked;` 두 줄.

> **이 (b) 패턴이 이번 승인 게이트의 정답 템플릿이다.** 새 설계 불필요 — `lib/plan/approvalGuard.ts`를 같은 시그니처로 추가하면 된다.

### 1-6. 공통 인가 헬퍼

`/mnt/e/VibeCoding/K-Bestie-v3/lib/auth/requireChildAccess.ts` — `(supabase, userId, childId) => { allowed, role }`. **38개 라우트가 사용 중**인 최대 초크포인트. 단, 리포트 열람·황금열쇠 잔액 조회 같은 **비과금 읽기 라우트도 포함**하므로 여기에 승인 게이트를 통짜로 넣으면 "승인 전에도 본인 정보 확인 가능"이라는 지시서 요구와 충돌한다(→ 4장 참조).

---

## 2. 변경 필요 DB 구조

### 2-1. "13개 승인 테이블 변경 금지" 규칙 확인 결과

- 근거 문구는 `/mnt/e/VibeCoding/K-Bestie-v3/docs/DEV-SPEC.md:13`, `:85`에 있다: "기존 13개 DB 테이블과 스키마는 변경하지 않는다."
- **13개 테이블의 명시적 목록은 저장소 어디에도 없다.** `docs/`, `CLAUDE.md`, `requests/` 전체 검색 결과 열거된 곳 없음 → **미확인.**
- 다만 **선례상 이 규칙은 "컬럼 추가(additive)"까지 금지하지는 않는 것으로 운용되어 왔다.** 두 마이그레이션이 명시적으로 이 규칙을 언급하며 컬럼 추가를 진행했다:
  - `20260712000000_plans_tier.sql:5` — "기존 13개 승인 테이블 스키마 변경 아님(신규 테이블 1개 + parents에 컬럼 1개 추가)"
  - `20260712300000_child_profiles_tier.sql:9` — "기존 13개 승인 테이블 중 child_profiles에 컬럼 1개만 추가"
  - `20260724000000_account_withdrawal_system.sql` — `parents`에 `account_status` 등 다수 컬럼 추가
- 즉 **`parents`와 `child_profiles`는 13개 테이블에 포함되지만, `ADD COLUMN ... DEFAULT` 형태의 additive 변경은 전례가 확립되어 있다.**

### 2-2. approval_status를 어디에 둘 것인가 — 권장안

**권장: `parents` 테이블에 컬럼 2개 추가 (지시서의 "방법 A" 변형).**

```
-- 제안(실행 금지, 파일 생성도 아직 하지 않음)
ALTER TABLE public.parents
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS approved_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by   UUID,
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT;
```

**근거:**
1. **승인 주체 단위가 "계정(오너 부모)"이다.** 지시서 3장의 목록 화면 컬럼이 "사용자명/이메일"이며, 이메일을 가진 실체는 `parents`뿐이다(아이 계정은 `@kbestie.local` 가짜 이메일).
2. **`parents.account_status`라는 동일 성격의 상태 컬럼 선례가 이미 있다**(`20260724000000`). 게이트 판정 로직·미들웨어 조회 위치를 그대로 재사용할 수 있다.
3. 별도 테이블로 빼면 모든 AI 라우트마다 JOIN이 1회 더 늘어난다. 이 프로젝트는 응답 지연에 매우 민감하다(`app/api/mission/reaction-lean/route.ts:44-46` 주석: 인증 체크 지연이 1.3~2.3초까지 늘어난 실측 기록).
4. `ADD COLUMN ... DEFAULT 'pending'`은 additive이며 기존 행에 값을 채운다 → 기존 데이터 유실 없음. 단, **기본값을 무엇으로 할지는 반드시 결정 필요**(→ 4장).

### 2-3. subscription_plan은 신규 컬럼을 만들면 안 된다 — 기존 tier 재사용

**권장: 신규 `subscription_plan` 컬럼도, 신규 `user_subscriptions` 테이블도 지금 만들지 않는다. 승인 시 `child_profiles.tier`(및 `parents.tier`)를 갱신한다.**

**근거:**
1. `plans` 테이블이 정확히 Care Start(1)/Insight(2)/Premium(3) 3개를 이미 정의하고 있다. `subscription_plan TEXT`를 새로 만들면 **같은 개념이 두 곳에 저장되는 이중 소스**가 되고, 두 값이 어긋나는 순간 요금제 분기(음성 방식 stt_tts vs live, 리포트 상세도)가 깨진다.
2. `child_profiles.tier`는 **이미 런타임 동작을 실제로 좌우한다** — `lib/plan/voiceMode.ts`(`getVoiceModeForChild`)를 통해 `app/api/voice/token/route.ts`가 Live/STT+TTS를 분기한다. 승인 화면에서 플랜을 지정한다는 것은 곧 이 값을 지정한다는 뜻이다.
3. 아이 단위 tier로 이전한 이유가 "형제자매 tier 분리"였다(`20260712300000` 파일 상단). 승인 단위(부모)와 과금 적용 단위(아이)가 다르므로, **승인 시 지정한 플랜을 그 가족의 아이들에게 어떻게 전파할지**가 별도 결정 사항이다(→ 4장).
4. 지시서 "방법 B"의 `user_subscriptions`(start_date/end_date/결제 연동)는 **유료 전환 시점에 필요한 구조**다. 베타 승인 단계에서 미리 만들면 결제 요구사항이 확정되기 전에 스키마가 굳는다. 향후 필요해지면 `parents.tier`를 유지한 채 이력 테이블을 덧붙이는 것이 안전하다(현재 `insight_extension_purchases` 테이블이 정확히 이 "본체 컬럼 + 구매이력 테이블" 패턴을 쓰고 있다 — `20260726200000_insight_extension_purchases.sql`).

### 2-4. 베타 신청서(설문) 저장용 신규 테이블

설문·신청 데이터는 `parents`에 넣지 말고 **신규 테이블 1개**로 분리한다(가변 문항이라 컬럼화 부적합).

```
-- 제안(실행 금지)
CREATE TABLE public.beta_applications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.parents(id) ON DELETE CASCADE,
  answers      jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.beta_applications ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.beta_applications TO anon, authenticated;   -- §5 체크리스트 규칙
-- 정책: 본인 SELECT/INSERT + service_role ALL (insight_extension_purchases 패턴 준용)
```

신규 테이블이므로 "13개 테이블 변경 금지" 규칙과 무관하다. RLS + `GRANT ALL ON ... TO anon, authenticated` 형태는 `20260726200000_insight_extension_purchases.sql:11-12`의 확립된 관례를 그대로 따른 것이다.

### 2-5. 마이그레이션 파일 취급

프로젝트 절대 규칙에 따라 **SQL 파일 생성만 하고 직접 실행하지 않는다.** 파일명은 `supabase/migrations/YYYYMMDDHHMMSS_*.sql` 타임스탬프 규칙(현재 최신 = `20260749000000_drop_temp_cron_debug_fn.sql`). 기존 파일들의 관례대로 상단에 `초안 (DDL DRAFT ONLY) — 실행 금지, 대표 승인 후 대표가 SQL Editor에서 직접 실행할 것` 주석을 넣고, 실행 완료 시 `[APPLIED YYYY-MM-DD]`를 추가한다.

---

## 3. 관리자 기능 구현 계획

### 3-1. 기존 admin 구조를 그대로 따르는 방식

**UI:** `app/admin/page.tsx`의 `ADMIN_NAV_ITEMS`(503-509행)에 항목 1개 추가 + 탭 컴포넌트 1개 추가.

```
{ id: "beta-approval", label: "베타 신청 관리" }
```
렌더 분기는 942-990행의 `page === "ai-config" ? ... : page === "account-restore" ? <AccountRestoreTab /> : ...` 체인에 한 갈래 추가. `AccountRestoreTab`(801행)이 목록+승인+거절 구조를 이미 갖고 있어 그대로 복제 가능하다.

> 주의: `app/admin/page.tsx`는 이미 1,569줄이다. 신규 탭은 별도 컴포넌트 파일로 분리하는 편이 낫지만, 기존 탭들이 전부 같은 파일에 있어 관례를 깨는 선택이 된다 → 판단 보류 항목(6장).

**API:** `app/api/admin/beta-applications/` 아래에 `account-restore-requests`와 동일한 3-라우트 구조.

| 라우트 | 메서드 | 역할 |
|---|---|---|
| `app/api/admin/beta-applications/route.ts` | GET | 목록(사용자명/이메일/신청일/승인상태/플랜). `parents` + `beta_applications` 조인 |
| `app/api/admin/beta-applications/[userId]/approve/route.ts` | POST | body에 `tier`(1/2/3) → `approval_status='approved'`, tier 적용 |
| `app/api/admin/beta-applications/[userId]/reject/route.ts` | POST | `approval_status='rejected'` + 사유 |

**모든 라우트 첫 줄에 `const denied = await requireAdmin(); if (denied) return denied;`** — `app/api/admin/account-restore-requests/route.ts:8`과 동일. 미들웨어(`middleware.ts` matcher에 `/api/admin/:path*` 포함)가 1차, `requireAdmin()`이 2차로 이중 방어된다.

**감사 로그:** `20260718200000_admin_audit_log.sql` / `20260725110000_admin_audit_log_action_check_restore.sql`에 관리자 감사 로그 테이블이 이미 있고 action 값에 CHECK 제약이 걸려 있다. 승인/거절 액션을 기록하려면 **CHECK 제약에 새 action 값을 추가하는 마이그레이션이 함께 필요**하다(계정 복구 승인 때 이미 같은 일을 했다 — `..._admin_audit_log_action_check_restore.sql`).

### 3-2. 승인 대기 사용자용 화면

신규 `/account/pending` 페이지 1개. `middleware.ts:78-90`의 `/account/withdrawn` 리다이렉트 로직이 그대로 참고 대상이다. 표시 문구는 지시서 지정: "현재 베타 승인 대기 중입니다. 승인 완료 후 서비스를 이용할 수 있습니다."

### 3-3. 베타 신청 폼(설문)

**완전 신규.** 페이지 + `POST /api/beta/apply`(본인 인증만, admin 아님) + `beta_applications` INSERT. 설문 문항이 확정되지 않아 지금은 설계 불가 → 6장 대표님 확인 항목.

---

## 4. API 비용 보호 적용 위치

### 4-1. 권장 방식: `lib/plan/approvalGuard.ts` 신규 + 기존 consentGuard 호출부 옆에 2줄 추가

`lib/plan/consentGuard.ts`와 **동일한 시그니처**로 만들어, 이미 확립된 호출 관례를 그대로 재사용한다.

```ts
// 제안 시그니처 (구현하지 않음)
export async function checkApprovalForChild(childId: string): Promise<NextResponse | null>
export async function checkApprovalForSession(sessionId: string): Promise<NextResponse | null>
```

내부 조회 경로: `child_profiles.family_id` → `family_members(role='owner_parent')` → `parents.approval_status`.
(이 조인 경로는 `20260712300000_child_profiles_tier.sql`의 백필 쿼리가 쓰는 것과 동일하며, `lib/auth/requireChildAccess.ts:37-38`도 같은 role 값을 사용한다.)

### 4-2. 게이트를 삽입할 정확한 위치 (파일:라인)

**A. Gemini/LLM 직접 호출 — 최우선 (실제 토큰 과금 발생)**

| 파일 | 삽입 위치 | 현재 그 자리에 있는 코드 |
|---|---|---|
| `app/api/mission/start/route.ts` | 45행 직후 | `const consentBlocked = await checkConsentForChild(childId);` |
| `app/api/mission/answer/route.ts` | 111행 직후 | `checkConsentForChild(session.child_id)` |
| `app/api/mission/answer-lean/route.ts` | 97행 직후 | `checkConsentForChild(session.child_id)` |
| `app/api/mission/respond/route.ts` | 109행 직후 | `checkConsentForSession(body.sessionId)` |
| `app/api/mission/respond-lean/route.ts` | 227행 직후 | `checkConsentForSession(sessionId)` |
| `app/api/mission/reaction-lean/route.ts` | **44-52행 — 특수, 아래 4-3 참조** | `authCheckPromise` 병렬 블록 |
| `app/api/chat/messages/route.ts` | 52행, 137행 직후 (2곳) | `checkConsentForChild(session.child_id)` |
| `app/api/voice/token/route.ts` | 33행 직후 | `checkConsentForChild(body.childId)` — **Live API, 단가 최고** |
| `app/api/voice/respond/route.ts` | 65행 직후 | `checkConsentForSession(sessionId)` |
| `app/api/report/generate/route.ts` | 52행 직후 | `checkConsentForChild(session.child_id)` |
| `app/api/parent/questions/route.ts` | 40행 / 93행 직후 | `requireChildAccess(...)` (consentGuard 미적용 상태) |

**B. STT / TTS — GCP 유료 API 키 사용**

| 파일 | 삽입 위치 | 비고 |
|---|---|---|
| `app/api/mission/stt/route.ts` | 55행 직후 | `GCP_STT_API_KEY` 사용(30행) |
| `app/api/voice/tts/route.ts` | 73행 직후 | `GCP_TTS_API_KEY` 사용(35행) |

**C. 놀이(미션/놀이 실행) — Gemini 비과금이나 황금열쇠 소모**

| 파일 | 삽입 위치 |
|---|---|
| `app/api/play/consume/route.ts` | 23행 직후 |
| `app/api/play/start/route.ts` | 26행 직후 |
| `app/api/quiz-play/start/route.ts` | 58행 직후 |
| `app/api/mbti/session/route.ts` | 161행 `loadPlaySession(...)` 직후 |
| `app/api/chat/session/route.ts` | 25행 직후 |

> MBTI·퀴즈마스터 라우트에서 `@google/genai` 호출은 **0건**(검증: `grep -rln "@google/genai\|generateContent\|GoogleGenAI" app/api/` 결과에 미포함). 즉 놀이는 Gemini 비용이 아니라 **황금열쇠 경제**를 소모한다. 지시서는 "놀이 실행"도 차단 대상으로 명시했으므로 게이트는 걸되, "비용 보호"가 아니라 "베타 범위 통제" 목적임을 구분해야 한다.

**D. 차단하면 안 되는 라우트 (지시서: 승인 전에도 "본인 정보 확인" 가능해야 함)**

`app/api/auth/change-password`, `app/api/child/me`, `app/api/parent/reports/*`(열람), `app/api/goldkey/balance` 등 읽기 전용 라우트. → **`lib/auth/requireChildAccess.ts` 내부에 게이트를 넣으면 이 38개 라우트가 전부 막혀 요구사항과 충돌한다. 넣지 말 것.**

### 4-3. ⚠️ 중대 발견 — `reaction-lean`은 인증 전에 Gemini를 먼저 호출한다

`/mnt/e/VibeCoding/K-Bestie-v3/app/api/mission/reaction-lean/route.ts:44-63`

주석(41-45행)이 의도를 명시한다: "인증/테스트계정 확인(DB 왕복 2~3회)과 Gemini 호출을 **순차가 아니라 병렬로** 시작한다 — 인증 체크가 느려도 모델의 첫 토큰 생성 시작이 그만큼 늦어지지 않게 하기 위함". 실제 코드:

```ts
const authCheckPromise = (async () => { ... })();   // 44행: 인증을 await 하지 않고 Promise만 생성
const ai = createGenAIClient({ provider: "vertex" });
const streamPromise = ai.models.generateContentStream({ ... });   // 58행: 인증 확정 전에 호출 시작
```

즉 **미인증/미승인 요청이라도 Gemini 호출은 이미 나가고 토큰이 과금된다.** 스트림 출력만 차단되어 "결과가 새어나가지 않을" 뿐이다.

- 보안(정보 유출) 관점: 현재 설계로 충분하다.
- **비용 보호 관점: 이 지시서의 핵심 목표(“무분별한 Gemini API 비용 발생 방지”)가 이 라우트에서만은 달성되지 않는다.**
- 승인 게이트를 여기에 `await`로 넣으면 의도된 지연 최적화(실측 1.3~2.3초 개선)가 되돌아간다.

→ **트레이드오프 결정 필요 항목**(6장). 절충안: 승인 상태만 미들웨어/쿠키·짧은 TTL 메모리 캐시로 선판정해 DB 왕복 없이 즉시 차단하는 방식이 있으나, 설계·검증 비용이 별도로 든다.

### 4-4. 미들웨어 레벨 게이트의 한계

`middleware.ts`의 matcher는 `["/parent/:path*", "/admin/:path*", "/api/admin/:path*"]`뿐이다. **`/child/*`와 AI API 라우트는 미들웨어를 전혀 거치지 않는다.** 파일 상단 주석이 이를 의도적 최적화로 설명한다("자녀 페이지·API 라우트는 각자 자체적으로 auth.getUser()를 호출해 401 처리함").

→ 화면 리다이렉트용으로 matcher에 `/child/:path*`를 추가하는 것은 가능하지만, **API 비용 차단을 미들웨어에만 의존해서는 안 된다**(matcher 확대는 모든 요청에 Supabase 왕복을 추가해 지연을 늘린다). 화면 UX는 미들웨어, 비용 차단은 라우트 가드 — **2계층 방식**을 권장한다.

---

## 5. Production 배포 가능 여부

### 5-1. Vercel 프로젝트 실측 (`vercel project ls`, 읽기 전용)

| 프로젝트 | 최신 Production URL | 비고 |
|---|---|---|
| `k-bestie-v3-dev` | `k-bestie-v3-dev-markanitp.vercel.app` | **현재 저장소가 링크된 프로젝트** (`.vercel/project.json` → `projectName: "k-bestie-v3-dev"`) |
| `k-bestie-v3` | `app.k-bestie.com` | 운영 |
| `k-bestie-mbti-dev` | `k-bestie-mbti-dev.vercel.app` | MBTI 별도 프로젝트가 **이미 존재** |
| `quizmaster-dev` | `quizmaster-dev.vercel.app` | 퀴즈마스터 별도 프로젝트가 **이미 존재** |
| `k-bestie-web` | `beta.k-bestie.com` | 미확인(용도 불명) |
| `modoo` | `modoo.k-bestie.com` | 미확인 |

**지시서 8번 항목은 이미 상당 부분 무효화되어 있다.** MBTI와 퀴즈마스터는 이 저장소 안의 **네이티브 모듈로 통합 완료**되었다:
- `app/play/mbti/page.tsx`, `app/play/quiz/page.tsx` (앱 내부 화면)
- `app/api/mbti/*`, `app/api/quiz-play/*` (앱 내부 API)
- `app/api/quiz-play/start/route.ts` 상단 주석: "requests/021: 퀴즈마스터 app/api/quiz/start/route.ts에서 포팅"
- 최근 커밋 `f191b5b`: "021: 퀴즈마스터를 K-Bestie 내부 Full Screen Modal 놀이 모듈로 전환"

→ 즉 `k-bestie-mbti-dev` / `quizmaster-dev` Vercel 프로젝트는 **레거시**일 가능성이 높다. 다만 `NEXT_PUBLIC_MBTI_APP_URL`, `QUIZMASTER_BASE_URL` 환경변수가 여전히 설정되어 있어(아래) **완전 폐기 여부는 미확인**.

### 5-2. "Preview → Dev Supabase, Production → Prod Supabase" 구조 — 이미 구현되어 있음 (지시서 8·9번의 답)

`/mnt/e/VibeCoding/K-Bestie-v3/lib/supabase/env.ts`가 정확히 이 구조를 제공한다:

- `NEXT_PUBLIC_SUPABASE_TARGET` = `'prod'` | 그 외(미설정 포함) → **무조건 `dev` 폴백**(안전한 기본값, 12-13행)
- `prod`일 때 `NEXT_PUBLIC_SUPABASE_URL` / `..._ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 사용
- `dev`일 때 `NEXT_PUBLIC_SUPABASE_DEV_URL` / `..._DEV_ANON_KEY` / `SUPABASE_DEV_SERVICE_ROLE_KEY` 사용
- **fail-closed 교차 검증**: `checkProjectRefMismatch()`가 target과 URL의 project ref 불일치 시 예외를 던진다 (`PROD_PROJECT_REF = 'fetvnhhjicndmxvhrffk'`, `DEV_PROJECT_REF = 'mkrsaaedxqrcrktapaus'` 하드코딩)
- 빌드 타임 검증도 걸려 있다: `package.json` `prebuild` → `scripts/validate-env-separation.js`, `postbuild` → `verify-client-bundle-env.js` + `verify-no-client-secrets.js`

> **결론: 단일 Vercel 프로젝트에서 Preview는 Dev Supabase, Production은 Prod Supabase로 붙이는 구조는 코드 레벨에서 이미 가능하다.** Vercel의 Preview 스코프에 `NEXT_PUBLIC_SUPABASE_TARGET=dev` + Dev 키 3종, Production 스코프에 `=prod` + Prod 키 3종을 넣으면 된다. 신규 개발 불필요.

### 5-3. 실제 환경변수 설정 상태 (`vercel env ls` — 링크된 `k-bestie-v3-dev` 프로젝트 기준, 읽기 전용)

`k-bestie-v3-dev` 프로젝트에는 **Production 스코프와 Preview 스코프 양쪽에** 다음이 모두 설정되어 있다:
`NEXT_PUBLIC_SUPABASE_TARGET`, `NEXT_PUBLIC_SUPABASE_DEV_URL`, `NEXT_PUBLIC_SUPABASE_DEV_ANON_KEY`, `SUPABASE_DEV_SERVICE_ROLE_KEY`

즉 **개발 프로젝트는 Production 스코프조차 Dev Supabase를 바라보도록 구성되어 있다**(설계상 정상 — 개발 프로젝트니까). 값은 전부 `Encrypted`로 표시되어 **실제 문자열 값은 확인하지 않았다**(읽기 전용 조사 원칙 준수).

기타 설정된 변수: `ADMIN_EMAILS`(Preview/Development), `GCP_STT_API_KEY`·`GCP_TTS_API_KEY`(Prod/Preview/Dev), `GCP_VERTEX_SA_KEY_JSON`·`GOOGLE_CLOUD_PROJECT`·`GOOGLE_CLOUD_LOCATION`(Production), `VERTEX_LIVE_RELAY_URL`·`..._SECRET`(Prod/Preview), `QUIZMASTER_BASE_URL`·`MAIN_APP_REWARDS_API_KEY`(Prod/Preview), `BATCH_SECRET`(Production), `NEXT_PUBLIC_MBTI_APP_URL`(Production), `DEV_USES_SHARED_PROD_AI`(Production), `MISSION_TIME_GATE_MODE`, `QUESTION_ENGINE_V2`.

**⚠️ 확인 필요 1:** `ADMIN_EMAILS`가 **Preview / Development 스코프에만 있고 Production 스코프에는 보이지 않는다.** 이 프로젝트(`k-bestie-v3-dev`)의 Production 배포에서는 `isAdminEmail()`이 항상 `false`를 반환해 `/admin`이 통째로 막힌다는 뜻이다. 운영 프로젝트(`k-bestie-v3`)의 설정은 별도 확인 필요.

**⚠️ 확인 필요 2 (미확인):** 운영 프로젝트 `k-bestie-v3`의 환경변수 목록은 **조사하지 않았다.** 현재 저장소가 dev 프로젝트에만 링크되어 있어 `vercel env ls`가 dev만 조회한다. Production 배포 전 반드시 별도 확인해야 한다.

### 5-4. 하드코딩된 개발 URL 존재 여부 (지시서 9번)

전수 검색 결과 실질적 하드코딩은 다음뿐이다:

| 위치 | 내용 | 평가 |
|---|---|---|
| `lib/supabase/env.ts:1-2` | `PROD_PROJECT_REF` / `DEV_PROJECT_REF` 상수 | **의도된 하드코딩**(교차 검증용). 문제 없음 |
| `app/api/families/[id]/invite-parent/route.ts:68` | `process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"` | **위험.** Production에서 `NEXT_PUBLIC_APP_URL` 미설정 시 초대 메일 링크가 `localhost:3000`이 된다 |
| `lib/quiz/play/rewardsCallback.ts:43-49` | 동일 패턴 | 최근 커밋 `8c9ab6c`가 "NEXT_PUBLIC_APP_URL 미설정 시 localhost로 폴백해 실제로는 항상 실패하던 문제"를 수정한 이력 — **같은 부류의 버그가 `invite-parent`에 아직 남아 있을 가능성** |
| `scripts/validate-env-separation.js:10-11` | Cloud Run relay 호스트 2종 | 검증 스크립트 전용. 런타임 무관 |

**`NEXT_PUBLIC_APP_URL`은 `vercel env ls` 결과 어느 스코프에도 없다** → Production 배포 시 초대 메일 링크가 깨질 위험이 실재한다.

### 5-5. Production 배포 가능 여부 — 판정

**현 상태로는 배포 불가.** 차단 사유:

| # | 차단 사유 | 성격 |
|---|---|---|
| 1 | 승인·플랜 관리 기능이 **전혀 구현되지 않았다**(설문/신청/승인 UI/API/게이트 모두 0건). 지시서의 최종 결과물이 코드가 아니라 이 보고서이므로 이는 정상 | 미구현 |
| 2 | `parents.approval_status` 기본값 결정 미완 — 잘못 선택하면 **기존 사용자 전원이 즉시 차단**되거나 **베타 통제가 무의미**해진다 | 대표님 결정 |
| 3 | 운영 프로젝트 `k-bestie-v3`의 환경변수 상태 **미확인** | 조사 필요 |
| 4 | `NEXT_PUBLIC_APP_URL` 미설정 → 초대 메일 링크 localhost 폴백 | 사전 수정 |
| 5 | DB 마이그레이션은 **파일 생성만 하고 대표님이 SQL Editor에서 직접 실행**해야 한다(프로젝트 절대 규칙). Production DB 변경은 명시적 승인 필요 | 승인 필요 |
| 6 | `app/api/mission/reaction-lean/route.ts`의 인증-선행-호출 구조 때문에 승인 게이트를 넣어도 **이 라우트만은 비용이 새어나간다** | 설계 결정 |

**참고 — Production 승인 주체:** `requests/_log.md`와 `requests/_blocked.md` 전수 확인 결과, "Production DB 변경 승인 주체는 대표님(형진님)"이라는 명문 규정은 이 두 파일에 기록되어 있지 않다. 다만 **실제 운용 이력은 일관되게 "대표님 명시 승인 없이 Production 미반영"**이다:
- `_log.md` 2026-07-25 22:15 (010-quizmaster): "Production 미반영(대표님 승인 대기)"
- `_blocked.md` 003 항목: 실계정 비밀번호 재설정 — "대표님의 명시적 승인 없이 Claude가 임의로 재설정할 수 없다"
- `CLAUDE.md` 안전장치: "운영 DB / 배포 파괴적 작업은 대표 명시 승인 없이 금지"

---

## 6. 추가 작업 목록

### 6-A. 대표님 결정이 필요한 항목 (구현 착수 전 반드시 선행)

**① `approval_status` 기본값 + 기존 사용자 처리** — 가장 중요

- 왜 멈췄는지: `DEFAULT 'pending'`으로 컬럼을 추가하면 **기존 `parents` 행 전원이 즉시 `pending`이 되어 서비스가 통째로 멈춘다.** 반대로 `DEFAULT 'approved'`로 하면 신규 가입자도 자동 승인되어 베타 통제가 무의미해진다.
- 선택지:
  - **A. `DEFAULT 'pending'` + 마이그레이션 내에서 기존 행 전부 `approved`로 백필** (`UPDATE parents SET approval_status='approved' WHERE created_at < now()`)
  - B. `DEFAULT 'approved'` + 신규 가입 경로(`app/auth/callback/route.ts`의 upsert)에서만 명시적으로 `'pending'` 지정
- **권장: A.** 스키마 기본값이 안전한 쪽(pending)으로 fail-closed 되고, 백필 범위가 명시적이라 검증 가능하다. B는 새 진입 경로가 하나라도 추가되면 게이트를 우회한다.
- 결정해야 할 것: A / B 선택

**② 승인 시 지정한 플랜을 아이에게 어떻게 전파할 것인가**

- 왜 멈췄는지: 승인 단위는 부모(`parents`)인데 요금제 실제 적용 단위는 아이(`child_profiles.tier`)다. 승인 시점에 그 가족에 아이가 아직 없을 수도 있다.
- 선택지:
  - A. `parents.tier`만 갱신 → 이후 아이 생성 시 부모 tier를 상속(`20260712300000` 백필과 동일 로직을 생성 시점에 적용)
  - B. 승인 시 그 가족의 기존 아이 전원 `child_profiles.tier`를 일괄 갱신
  - C. A + B 둘 다(부모 tier = 기본값, 기존 아이도 일괄 갱신)
- **권장: C.** 형제자매 개별 조정 여지를 남기면서(기존 설계 의도 보존) 승인 즉시 실제 동작이 바뀌는 것을 보장한다.
- 결정해야 할 것: A / B / C 선택

**③ 플랜 명칭 정본**

- 왜 멈췄는지: 지시서는 `Care Start / Care Insight / Care Premium`, DB `plans.name`은 `Care Start / Insight / Premium`. 관리자 화면 드롭다운·향후 결제 연동에서 어느 쪽이 정본인지 정해야 한다.
- 선택지: A. DB 값을 화면 표기에 맞춰 UPDATE / B. 화면에서만 "Care " 접두어를 붙여 표시(DB 무변경)
- **권장: B.** `plans`는 `parents.tier`/`child_profiles.tier`가 FK로 참조하는 마스터 테이블이라 무변경이 안전하다. 표시 라벨은 프런트 상수로 분리.
- 결정해야 할 것: A / B 선택

**④ 베타 신청 설문 문항**

- 왜 멈췄는지: 설문 관련 구현이 코드베이스에 0건이고, 문항이 없으면 폼·저장 스키마 설계가 불가능하다.
- 결정해야 할 것: 문항 목록(질문/답변 형식/필수 여부). `beta_applications.answers jsonb`로 받으면 문항 변경 시 스키마 변경이 불필요하다.

**⑤ `reaction-lean` 비용 누수 — 지연 vs 비용 트레이드오프**

- 왜 멈췄는지: `app/api/mission/reaction-lean/route.ts:44-63`이 인증 확정 전에 Gemini 호출을 시작하도록 **의도적으로** 설계되어 있다(실측 1.3~2.3초 지연 개선). 여기에 승인 게이트를 `await`로 넣으면 그 최적화가 되돌아간다.
- 선택지:
  - A. 게이트를 `await`로 삽입 — 비용 완전 차단, 응답 지연 복귀
  - B. 현행 병렬 유지 — 지연 유지, 미승인 사용자의 이 라우트 호출만 비용 발생(출력은 차단됨)
  - C. 승인 상태를 세션 쿠키/짧은 TTL 캐시로 선판정 — DB 왕복 없이 즉시 차단(추가 설계·검증 필요)
- **권장: B로 우선 배포 후 C를 후속 개선.** 미승인 사용자는 애초에 미션 화면 진입 자체가 앞단(`/api/mission/start`)에서 막히므로 이 라우트에 도달할 확률이 낮다. 다만 이 판단은 "앞단 게이트가 확실히 동작한다"는 전제에 의존하므로 대표님 확인이 필요하다.
- 결정해야 할 것: A / B / C 선택

**⑥ Production DB 마이그레이션 실행 승인**

- 프로젝트 절대 규칙상 Claude는 SQL 파일 생성까지만 하고 실행하지 않는다. 대상: `parents` 컬럼 추가, `beta_applications` 신규 테이블, `admin_audit_log` action CHECK 확장.
- 결정해야 할 것: Dev Supabase(`mkrsaaedxqrcrktapaus`) 선반영 → 검증 → Production(`fetvnhhjicndmxvhrffk`) 반영 순서 승인

### 6-B. 기존 테스트 계정 보호 방안 (지시서 7번)

승인 게이트 도입 시 아래 계정들이 차단되지 않도록 **마이그레이션 안에 명시적 시드**를 포함한다.

| 계정 | 용도 (CLAUDE.md 규정) | 보호 방법 |
|---|---|---|
| `QA테스트` | 자동화 테스트 전용 (agy/claude-review/스크립트) | 소속 가족의 오너 `parents.approval_status='approved'` 시드 |
| `testi01` / `testi02` | D/F 회귀 테스트 전용 | 동일 |
| 김서아(`ksa160202`) / 김서현(`ksh160202`) | **대표님 최종 수동 검증 전용** | 동일. **어떤 자동화도 접근 금지** — 시드 UPDATE 외 어떤 조작도 하지 않는다 |

**권장 방식 (근거 포함):**

1. 6-A①의 A안(기존 행 전부 백필)을 채택하면 **위 계정들은 자동으로 `approved`가 되어 별도 시드가 불필요**하다. 이것이 가장 안전하다.
2. 그럼에도 **명시적 안전망을 하나 더 두는 것을 권장**한다: `child_profiles.is_test_account` 컬럼이 이미 존재한다(`supabase/migrations/20260732000000_test_account_and_mode_override.sql:8`). 승인 가드에서 `is_test_account = true`인 아이는 무조건 통과시키면, 향후 어떤 이유로 approval_status가 리셋되어도 테스트 라인이 죽지 않는다.
   - 단 이 예외는 **Production에서 악용 소지가 있는 백도어**이기도 하다. `is_test_account`는 service_role만 쓸 수 있는 컬럼이라 사용자가 스스로 설정할 수 없어 위험은 낮지만, 채택 여부는 대표님 판단 사항이다.
3. **초기 관리자 계정 처리:** 현재 관리자 판정은 DB가 아니라 `ADMIN_EMAILS` 환경변수 기반이라(`lib/admin/isAdminEmail.ts`) **관리자 계정 자체는 승인 게이트와 무관하게 `/admin`에 접근할 수 있다.** 단 5-3에서 발견한 대로 `k-bestie-v3-dev`의 Production 스코프에 `ADMIN_EMAILS`가 없으므로, **운영 프로젝트에 이 변수가 설정되어 있는지 반드시 먼저 확인**해야 한다. 없으면 승인 게이트 배포 직후 아무도 승인할 수 없는 데드락이 발생한다.

### 6-C. 구현 작업 목록 (승인 후 착수, 권장 순서)

| # | 작업 | 대상 경로 | 선행조건 |
|---|---|---|---|
| 1 | 마이그레이션 파일 작성(실행 X) — `parents` 컬럼 + 백필, `beta_applications`, audit_log action 확장 | `supabase/migrations/2027*.sql` | 6-A ①②⑥ |
| 2 | 승인 가드 헬퍼 | `lib/plan/approvalGuard.ts`(신규) | 1 |
| 3 | AI 라우트 게이트 삽입(4-2 표 11곳 + STT/TTS 2곳) | `app/api/mission/*`, `app/api/voice/*`, `app/api/chat/*`, `app/api/report/generate` | 2 |
| 4 | 놀이 라우트 게이트 삽입(5곳) | `app/api/play/*`, `app/api/quiz-play/start`, `app/api/mbti/session` | 2 |
| 5 | 승인 대기 화면 + 화면 리다이렉트 | `app/account/pending/page.tsx`(신규), `middleware.ts` matcher 확대 | 1 |
| 6 | 베타 신청(설문) 폼 + API | `app/beta/apply/`(신규), `app/api/beta/apply/route.ts`(신규) | 6-A ④ |
| 7 | 관리자 "베타 신청 관리" 탭 | `app/admin/page.tsx` `ADMIN_NAV_ITEMS`(503행) + 탭 컴포넌트 | 1 |
| 8 | 관리자 API 3종 | `app/api/admin/beta-applications/**`(신규) | 1 |
| 9 | `NEXT_PUBLIC_APP_URL` 설정 + `invite-parent` localhost 폴백 수정 | Vercel env, `app/api/families/[id]/invite-parent/route.ts:68` | — |
| 10 | 운영 프로젝트 `k-bestie-v3` 환경변수 전수 점검(특히 `ADMIN_EMAILS`) | Vercel 콘솔 | — |
| 11 | 레거시 Vercel 프로젝트 정리 판단 | `k-bestie-mbti-dev`, `quizmaster-dev`, `k-bestie-web`, `modoo` | 6-A 별도 확인 |

### 6-D. 이번 조사에서 확인하지 못한 항목 (미확인)

1. **"13개 승인 테이블"의 정확한 목록** — `docs/DEV-SPEC.md`에 개수만 언급, 열거 없음. 저장소 전체 검색 결과 목록 문서 부재.
2. **운영 프로젝트 `k-bestie-v3`의 환경변수 전체** — 저장소가 `k-bestie-v3-dev`에만 링크되어 조회 불가.
3. **`admin_roles` 테이블의 실제 적용 여부** — 마이그레이션 파일이 `DRAFT ... 아직 미적용` 상태이고 코드도 사용하지 않음. DB 실조회는 하지 않음(읽기 전용 원칙).
4. **`NEXT_PUBLIC_SUPABASE_TARGET`의 실제 값** — Vercel에서 `Encrypted`로만 표시. 값 확인은 `vercel env pull`이 필요해 수행하지 않음.
5. **`k-bestie-web`(beta.k-bestie.com), `modoo`(modoo.k-bestie.com) 프로젝트의 용도** — 이 저장소와의 관계 불명.
6. **MBTI/퀴즈마스터가 K-Bestie와 동일 Supabase 프로젝트를 공유하는지** — 코드상 두 모듈 모두 `@/lib/supabase/server`의 클라이언트를 그대로 사용하므로 **동일 프로젝트 공유가 맞다**(별도 Supabase 접속 코드 없음). 다만 레거시 `k-bestie-mbti-dev` / `quizmaster-dev` Vercel 프로젝트가 별도 Supabase를 보고 있는지는 그쪽 프로젝트 설정을 봐야 하므로 미확인.
7. **`NEXT_PUBLIC_MBTI_APP_URL` / `QUIZMASTER_BASE_URL`이 아직 실사용 중인지** — 네이티브 통합 이후에도 환경변수는 남아 있음. 코드 참조 여부 상세 추적은 이번 범위 밖.

---

## 부록: 조사한 주요 파일 목록 (전부 읽기 전용)

- `/mnt/e/VibeCoding/K-Bestie-v3/app/signup/page.tsx`, `app/onboarding/page.tsx`, `app/invite/accept/page.tsx` — 전부 리다이렉트 스텁
- `/mnt/e/VibeCoding/K-Bestie-v3/app/login/page.tsx` — 실제 진입점(OAuth + 아이 ID/PW)
- `/mnt/e/VibeCoding/K-Bestie-v3/app/auth/callback/route.ts` — `parents` 자동 upsert
- `/mnt/e/VibeCoding/K-Bestie-v3/app/page.tsx` — 로그인 후 라우팅 허브, `auto-join`
- `/mnt/e/VibeCoding/K-Bestie-v3/middleware.ts` — matcher 3종, 관리자 화이트리스트, 탈퇴 게이트
- `/mnt/e/VibeCoding/K-Bestie-v3/lib/admin/requireAdmin.ts`, `lib/admin/isAdminEmail.ts`
- `/mnt/e/VibeCoding/K-Bestie-v3/lib/plan/consentGuard.ts` — 게이트 템플릿
- `/mnt/e/VibeCoding/K-Bestie-v3/lib/auth/requireChildAccess.ts` — 38개 라우트 공용 인가
- `/mnt/e/VibeCoding/K-Bestie-v3/lib/supabase/env.ts` — dev/prod 타깃 분리 + fail-closed 검증
- `/mnt/e/VibeCoding/K-Bestie-v3/app/admin/page.tsx` (특히 503-509행 `ADMIN_NAV_ITEMS`, 801행 `AccountRestoreTab`)
- `/mnt/e/VibeCoding/K-Bestie-v3/app/api/mission/reaction-lean/route.ts` (41-63행 — 인증 선행 호출 구조)
- `supabase/migrations/20260712000000_plans_tier.sql`, `20260712300000_child_profiles_tier.sql`, `20260724000000_account_withdrawal_system.sql`, `20260726200000_insight_extension_purchases.sql`, `20260732000000_test_account_and_mode_override.sql`, `20260717150100_admin_roles.sql`
- `/mnt/e/VibeCoding/K-Bestie-v3/docs/conventions.md`, `docs/DEV-SPEC.md`
- `/mnt/e/VibeCoding/K-Bestie-v3/requests/_log.md`, `requests/_blocked.md`
