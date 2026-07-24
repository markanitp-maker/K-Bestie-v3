# K-Bestie-v3 코드베이스 컨벤션

> 이 문서는 실제 코드베이스를 스캔해 작성됐다. 확인되지 않은 항목은 "미확인"으로
> 표기했으며, 추측으로 채운 항목은 없다. `requests/` 큐로 작업을 처리하는 모든
> 에이전트는 작업 전 이 문서를 먼저 읽어야 한다.

## 기술스택

- **프레임워크**: Next.js 15.3.3 (App Router, `output: "standalone"`)
- **런타임**: React 19, TypeScript 5 (strict 모드 켜짐, `tsconfig.json`)
- **스타일링**: Tailwind CSS 4 (`@tailwindcss/postcss`)
- **DB/백엔드**: Supabase (`@supabase/supabase-js`, `@supabase/ssr`) — Postgres + RLS
- **AI**: `@google/genai`(Vertex/Gemini), GCP Speech-to-Text/Text-to-Speech(REST API 키 방식)
- **기타 주요 의존성**: `recharts`(관리자 대시보드 차트), `xlsx`(내보내기), `html2canvas`(PNG 캡처),
  `nodemailer`, `@google-cloud/bigquery`(빌링)
- **테스트**: Node 내장 테스트 러너(`tsx --test`) — Jest/Vitest 아님. `package.json`의
  `test` 스크립트가 대상 파일을 명시적으로 나열한다(`lib/**/*.test.ts` 전체 자동 탐색 아님 —
  새 테스트 파일을 추가하면 이 스크립트에도 경로를 추가해야 실행됨).
- **패키지 매니저**: 미확인(`package-lock.json` 존재 → npm으로 추정되나 `.nvmrc`/enforced
  매니저 설정은 미확인)
- **린트**: `eslint-config-next` (`npm run lint`)

## 폴더구조

```
app/            Next.js App Router 페이지 + API 라우트(app/api/**/route.ts)
  admin/        관리자 대시보드 화면(대표님 전용, 이메일 화이트리스트)
  api/          전부 서버 전용 라우트 핸들러
  child/        아이용 화면(홈/미션/놀이/대화 등)
  parent/       부모용 화면
  auth/ login/ signup/ onboarding/ invite/ account/  인증·가입 플로우
  demo/         (별도 데모/샌드박스 화면)
components/     재사용 UI 컴포넌트(페이지 트리 밖, 여러 화면에서 공유)
hooks/          커스텀 React 훅(useVoiceChat, useGeminiLive 등)
lib/            서버·공용 로직 — 기능(도메인) 단위로 하위 폴더 분리:
  admin/ analytics/ auth/ batch/ billing/ child/ freechat/ goldkey/
  mission/ notifications/ plan/ play/ pwa/ questions/ stt/ supabase/ utils/
  (레이어 기준이 아니라 "무엇을 다루는가" 기준으로 분리됨 — 예: 황금열쇠 원장은
  전부 lib/goldkey/, 미션 관련은 전부 lib/mission/)
supabase/
  migrations/   실제 DB 스키마 변경(타임스탬프 접두어 파일명, 아래 네이밍컨벤션 참고)
  functions/    (Edge Functions로 추정, 이번 스캔에서 상세 미확인)
data/questions/ 문항 데이터(정적 시드 데이터로 추정, 상세 미확인)
scripts/        1회성/운영 스크립트(마이그레이션 적용기, env 검증기 등) — scripts/lib/에 공통 헬퍼
services/vertex-live-relay/  별도 Cloud Run 서비스(이 Next.js 앱과 별개 배포 단위)
kbestie-play-scaffold/  별도 K-Play 앱 소스(이 저장소에 스캐폴드만 존재, 별도 배포 단위 —
  본 프로젝트의 app/lib과는 독립적인 코드베이스이므로 이 문서의 컨벤션이 그대로
  적용되는지는 미확인)
tests/          미확인(내용 미스캔)
```

## 타입정의

- **중앙 `types/` 폴더나 전용 `.d.ts` 파일이 없다.** 타입은 그것을 사용하는 기능
  모듈 파일 안에 `export interface`/`export type`으로 바로 선언한다(예:
  `lib/goldkey/ledger.ts`의 `export type EarnResult`, `lib/mission/answer/route.ts`
  내부의 `type QuestionState`, `lib/store.ts`의 `export interface StoreChild`).
- 명명 규칙: PascalCase(`StoreChild`, `EarnResult`, `MissionProgressRow` 등),
  주로 명사형. 접두어(`I`, `T` 등) 없음.
- 여러 파일에서 공유되는 타입은 그 타입의 "주인" 모듈에서 export하고 다른 파일이
  `import { X } from "@/lib/.../file"`로 가져다 쓰는 방식(중앙 배럴 파일 없음).
- Supabase 테이블 행 타입은 별도 codegen 없이 그때그때 인라인 interface로 직접
  선언하는 경우가 많다(예: `MissionProgressRow`).

## API규약

모든 API는 `app/api/**/route.ts`의 Next.js Route Handler(`export async function GET/POST`)이며
`export const runtime = "nodejs";`를 선언한다. 인증은 각 라우트가 자체적으로
`supabase.auth.getUser()`를 호출해 처리한다(중앙 미들웨어는 `/parent/*`만 보호,
아래 인증인가 절 참고).

**성공 응답 예시** (`app/api/goldkey/balance/route.ts`):
```json
{ "childId": "c97eb161-...", "balance": 22 }
```

**성공 응답 예시 2** (`app/api/play/consume/route.ts`):
```json
{
  "session_id": "7302e88b-...",
  "access_type": "golden_key",
  "golden_key_charged": true,
  "remaining_golden_keys": 19,
  "start_mode": "new",
  "expires_at": "2026-07-24T16:16:17.400106+00:00"
}
```

**성공 응답 예시 3** (`app/api/mission/answer/route.ts`, V2 질문엔진):
```json
{
  "valid": true,
  "reason": null,
  "refused": false,
  "previousState": "pending",
  "questionState": "answered",
  "validAnswerCount": 9,
  "progressPercent": 90,
  "requiredCount": 10,
  "completed": false,
  "newlyCompleted": false,
  "progressStatus": "IN_PROGRESS",
  "engine_version": "v2",
  "questionStates": { "...questionId...": "answered" },
  "rewardStatus": "none"
}
```

**에러 응답 패턴** — 커스텀 에러 클래스 없이, 그때그때 `NextResponse.json({ error: "..." }, { status })`로
직접 반환한다:
```json
{ "error": "Unauthorized" }         // 401 - 로그인 안 됨
{ "error": "Forbidden" }            // 403 - 권한 없음(다른 가족 아이 접근 등)
{ "error": "childId required" }     // 400 - 필수 파라미터 누락
{ "error": "insufficient_balance", "reason": "insufficient_balance" }  // 402 - 놀이/열쇠 부족
{ "error": "Database error" }       // 500 - DB 쿼리 실패
{ "error": "Mission is already completed or safety paused", "status": "SAFETY_PAUSED" }  // 423
```
- 상태 코드 관례: `401` 미인증, `403` 권한 없음, `400` 잘못된 요청, `402` 재화(황금열쇠) 부족,
  `404` 리소스 없음, `423` 이미 완료/잠김 상태라 처리 불가, `500` 서버/DB 오류.
- 일부 응답에는 `error`와 별도로 판별용 `reason` 필드가 함께 온다(클라이언트가 사유별로
  분기 처리할 때 사용).

## 네이밍컨벤션

- **파일명**: 컴포넌트/훅 파일은 PascalCase/camelCase 혼용 관찰됨
  (`TestModeCDRunner.tsx`, `useVoiceChat.ts`, `ConnectionQualityIndicator.tsx`,
  `personalizedReaction.ts`) — 컴포넌트는 PascalCase, 순수 로직/훅 파일은 camelCase가
  일반적 패턴으로 보이나 예외 존재(엄격히 강제되지는 않음).
- **함수명**: camelCase(`fetchPersonalizedReaction`, `resolveChildForUser`, `getBalance`).
- **DB 테이블/컬럼**: snake_case(`gold_key_ledger`, `child_profiles`, `valid_answer_count`,
  `required_valid_count`). 테이블명은 복수형이 아니라 단수/도메인명 혼용
  (`gold_key_ledger`, `mission_progress`, `chat_sessions`, `child_profiles` — 후자는
  복수형).
- **마이그레이션 파일명**: `YYYYMMDDHHMMSS_짧은_설명.sql`(타임스탬프 접두어 + snake_case
  설명), 예: `20260741000000_gold_key_ledger_admin_adjustment_reason.sql`. 롤백 파일은
  `supabase/migrations/rollback/`에 동일 이름으로 둔다.
- **상수**: SCREAMING_SNAKE_CASE(`REQUIRED_COUNT_V2`, `MAX_ACTIVE_BALANCE`,
  `RESERVE_TARGET_COUNT`).

## 에러처리

- **중앙 에러 클래스 계층 없음.** 각 API 라우트가 자체적으로 `try/catch`로 감싸고
  실패 시 `console.error`로 로그를 남긴 뒤 `NextResponse.json({ error: ... }, { status })`를
  즉시 반환한다.
- 서버 로그는 `console.error`/`console.log`에 컨텍스트 객체를 함께 남기는 패턴이
  일관적이다: `console.error("[mission/answer] Failed to ...:", { sessionId, questionId, err })`.
  대괄호 접두어(`[모듈/파일명]`)로 로그 출처를 표시하는 관례가 전역적으로 관찰됨.
- 특정 실패는 명시적 태그로 로그를 남겨 나중에 grep하기 쉽게 한다(예:
  `MISSION_QUESTION_POOL_EXHAUSTED`).
- DB 트랜잭션이 필요한 복잡한 원자적 연산(잔액 차감, 미션 답변 기록 등)은 TS 레이어가
  아니라 **Postgres RPC 함수**(`consume_gold_keys`, `record_v2_mission_answer`,
  `consume_play_access` 등)로 구현되어 있다 — TS 코드는 `service.rpc(...)`로 호출하고
  RPC의 `reason`/`success` 필드를 해석해 분기한다.

## 상태관리

- **전역 상태 관리 라이브러리 없음**(Redux/Zustand/Context API 기반 전역 스토어 미발견).
  각 페이지 컴포넌트가 로컬 `useState`/`useEffect`/`useRef`로 자체 상태를 관리한다
  (`app/child/play/page.tsx`, `app/child/home/page.tsx`, `app/child/missions/page.tsx`
  전부 이 패턴).
- 여러 화면에 걸친 로직은 **커스텀 훅**으로 추출한다(`hooks/useVoiceChat.ts`,
  `hooks/useGeminiLive.ts`, `hooks/usePipelineConnectionQuality.ts`) — 훅이 콜백
  옵션(`onTurnComplete`, `onSttResult` 등)을 받아 호출부(페이지)에 결과를 위임하는
  패턴이 일관적으로 쓰인다.
- `lib/store.ts`는 예외적으로 `localStorage` 기반의 데모/레거시 스토어이며 파일 자체
  주석에 "SUPABASE_SWITCH: 각 write 헬퍼 상단 TODO 주석 위치에서 Supabase API 호출로
  교체" 라고 명시돼 있다 — 신규 기능에서 이 패턴을 그대로 따라 하면 안 된다(레거시로
  간주).
- 세션/식별자 일부는 `localStorage`에 직접 저장(`k_child_id` 등).

## 스타일링

- **Tailwind CSS 유틸리티 클래스가 기본.** 정적인 스타일(레이아웃, 여백, flex 등)은
  `className`에 Tailwind 클래스로, **동적/계산된 값**(색상 hex 코드, 계산된 퍼센트,
  조건부 배경색 등)은 `style={{ ... }}` 인라인으로 처리하는 혼합 패턴이 전역적으로
  관찰됨(예: `style={{ background: game.bg }}`, `style={{ width: `${progressPercent}%` }}`).
- 브랜드 컬러가 하드코딩된 hex 값으로 반복 사용됨(`#1a6b5a`, `#e8845a`, `#2d9f8f` 등) —
  Tailwind 커스텀 테마/CSS 변수로 추출돼 있지 않음(디자인 토큰 시스템 미확인).
- 다크모드 대응 여부: 미확인.

## 데이터접근

- 서버 컴포넌트/라우트에서는 `createServiceClient()`(service role, RLS 우회) 또는
  `createClient()`(현재 로그인 사용자 세션 기반, RLS 적용) 둘 다 씀 — 인증 확인은
  `createClient()`로, 실제 데이터 읽기/쓰기는 `createServiceClient()`로 하는 조합이
  일반적(예: `lib/goldkey/ledger.ts`, `app/api/mission/answer/route.ts`).
- 클라이언트(브라우저) 쪽에서 Supabase에 직접 쿼리하는 코드는 이번 스캔에서
  발견되지 않음 — 전부 `fetch("/api/...")`로 서버 라우트를 거친다.
- 원자적 연산(잔액 차감, 답변 기록 등)은 Postgres RPC로 구현(위 에러처리 절 참고).
- RLS: 마이그레이션 파일에서 확인됨 — `service_role`은 전체 접근, 일반 사용자는
  가족 멤버십 기준으로 자신의 가족 데이터만 SELECT 가능하도록 정책이 설정돼 있다
  (`gold_key_ledger_select` 정책 예시 참고).

## 인증인가

- **미들웨어**(`middleware.ts`)는 `/parent/:path*` 경로에만 적용되며, 미인증 시
  `/api/*`는 401 JSON, 그 외는 `/login` 리다이렉트.
- **아이/일반 API 라우트는 미들웨어 보호 대상이 아니며, 각 라우트가 직접**
  `const { data: { user } } = await supabase.auth.getUser();`로 인증을 재검증한다.
- **가족 소유권 검증**은 `lib/auth/requireChildAccess(supabase, userId, childId)` 헬퍼로
  통일 — `family_members`(사용자의 멤버십) + `child_profiles`(대상 아이의 family_id)를
  조회해 같은 가족인지, role이 parent/owner_parent인지 확인 후 `{ allowed, role }`을
  반환한다. 아이 본인 계정 로그인(`resolveChildForUser`/`resolveTestChild`,
  `lib/child/testAccount.ts`)은 `family_members(user_id, role='child')` →
  `child_profiles(member_id)` 체인으로 별도 처리.
- 관리자(대표님) 인증은 `ADMIN_EMAILS` 환경변수 화이트리스트(`lib/admin/isAdminEmail.ts`)로
  판정 — role 기반이 아니라 이메일 화이트리스트 방식.
- 아이 로그인 계정 2종류가 공존한다: ① `member_accounts` 테이블 기반(아이디/비번
  로그인, `username@kbestie.local`이라는 내부 합성 이메일 사용 — 사용자에게 절대
  노출 금지), ② `family_members`+`child_profiles` 기반(부모 계정 아래 프로필,
  Supabase Auth 실제 유저). 두 체계가 혼재하므로 신규 코드 작성 시 어느 쪽 아이
  계정을 다루는지 반드시 확인해야 한다.

## 환경변수

- `NEXT_PUBLIC_` 접두어 = 브라우저 노출 허용(공개 가능한 값만). 서버 전용 비밀키는
  **절대** 이 접두어를 붙이지 않는다(`.env.local.example`에 명시적 경고 주석 존재).
- Dev/Production이 **같은 코드베이스, 다른 Supabase 프로젝트**를 씀 —
  `NEXT_PUBLIC_SUPABASE_DEV_URL`/`SUPABASE_DEV_SERVICE_ROLE_KEY`(Dev 전용) vs
  `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`(Production) 별도 변수쌍 존재.
  `NEXT_PUBLIC_SUPABASE_TARGET`으로 어느 쪽을 쓸지 스위칭하는 것으로 추정(정확한
  스위칭 로직 파일은 이번 스캔에서 미확인 — `lib/supabase/` 하위 파일 상세 미스캔).
  DB 마이그레이션 적용 스크립트(`scripts/apply-migration.js`)는 `--target=dev`(기본값)
  /`--target=prod`(`--confirm=PRODUCTION` 플래그 필수)로 명시적으로 분리.
- AI 관련 키(Vertex/Gemini/GCP STT·TTS)는 전부 서버 전용, `NEXT_PUBLIC_` 없음.
- `scripts/validate-env-separation.js`가 `prebuild`에서 실행됨 — Dev/Prod 환경변수가
  섞이지 않았는지 빌드 전에 검증하는 것으로 추정(파일 상세 미스캔).
- `scripts/verify-client-bundle-env.js`/`verify-no-client-secrets.js`가 `postbuild`에서
  실행 — 클라이언트 번들에 서버 전용 비밀키가 노출되지 않았는지 사후 검증.

## 공유파일목록

여러 기능/모듈이 공통으로 건드릴 가능성이 높은 파일(수정 시 다른 작업과 충돌
가능성 높음 — `requests/` 큐 처리 시 이런 파일은 지시서에 명시된 경우에만 단독
순차 처리):

- `package.json` / `package-lock.json` — 의존성 추가/스크립트 변경 시
- `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` — 프로젝트 규칙 문서
- `middleware.ts` — 전역 인증 미들웨어
- `next.config.ts` — 빌드/배포 설정
- `.env.local` / `.env.local.example` — 환경변수(실제 `.env.local`은 git 미추적,
  로컬/배포 환경별 존재)
- `.gitignore`
- `lib/auth/requireChildAccess.ts` — 거의 모든 아이 관련 API가 이 헬퍼를 씀
- `lib/child/testAccount.ts` — `resolveTestChild`/`resolveChildForUser` 인증 헬퍼,
  여러 API 라우트가 공유
- `lib/goldkey/ledger.ts` — 황금열쇠 잔액/적립 관련 여러 기능이 공유
- `lib/mission/selectQuestions.ts` — 미션 질문 선택 로직, 여러 미션 관련 라우트가 공유
- `app/child/missions/page.tsx` — 실서비스 미션 화면(단일 거대 컴포넌트, 여러 기능
  트랙이 동시에 손대는 경우가 많았음 — 이 세션 기록상 가장 충돌 빈도가 높은 파일)
- `supabase/migrations/` 아래 새 파일 추가 자체는 충돌이 적지만, **같은 테이블**을
  건드리는 마이그레이션들은 순서·의존성 주의 필요
- `PROJECT_STATUS.md` — 프로젝트 진행 상황 요약 문서(여러 트랙이 갱신)

## 금지사항

- **`src/` 디렉터리를 새로 만들지 말 것**(`GEMINI.md` 경로 규칙, 프로젝트 전역 컨벤션).
- **서버 전용 비밀키(AI API 키 등)에 `NEXT_PUBLIC_` 접두어를 붙이지 말 것.**
- **Production Supabase 프로젝트(`fetvnhhjicndmxvhrffk`)에 직접 스키마 변경을 적용하지
  말 것** — 명시적 승인 없이는 Dev(`mkrsaaedxqrcrktapaus`)에서만 검증한다
  (`scripts/apply-migration.js`가 `--target=prod`에 `--confirm=PRODUCTION`을 강제하는
  이유).
- **`required_valid_count`(미션 완료 기준) 같은 핵심 정책 상수/컬럼을 코드에서
  동적으로 낮추지 말 것** — 이 저장소의 실제 사고 대응 히스토리에서 명시적으로
  금지된 패턴(완료 기준은 항상 고정, 부족분은 문항 풀 보충으로 해결).
- **테스트/QA 목적의 자동화가 실제 아동 실계정(테스트 계정이 아닌 진짜 사용자
  계정)에 자동으로 로그인·비밀번호 변경·세션 조작을 하지 말 것** — 이 저장소
  운영 히스토리상 반복적으로 강조된 안전 규칙. 자동화용 QA 계정만 사용할 것.
- **`gold_key_ledger`/유사 원장 테이블에 잔액 숫자를 직접 덮어써서 보정하지 말 것** —
  반드시 원장에 개별 행을 추가/차감(감사 가능한 방식)하는 기존 서비스 함수를
  통해서만 조정할 것.
