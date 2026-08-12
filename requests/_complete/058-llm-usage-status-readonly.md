# 관리자 "즉시 모델 전환" 제거 → 읽기 전용 "LLM 사용 현황" 페이지로 교체

## 작업 정보

- 우선순위: 보통
- 선행 작업: 없음 (단, `app/api/_lib/ai.ts`의 `getModelForGroup`/`provider_switch_settings` 구조는 045에서 이미 정리됨 — 이 지시서는 그 기능 자체를 제거하는 후속 작업)
- 병렬 처리: 불가 (관리자 페이지·AI 클라이언트 공통 파일을 폭넓게 건드림)
- 예상 충돌 파일:
  - `app/admin/page.tsx`
  - `app/api/_lib/ai.ts`
  - `lib/llm/modelRouter.ts`

## 배경 (대표님 확인 완료 사항)

045 리뷰 중 발견: 관리자 페이지의 "즉시 모델 전환" 스위치(`provider_switch_settings` 테이블 + `app/api/admin/provider-switch/route.ts`)는 DB 값을 조회는 하지만, 실제 `generateContent` 호출부 12곳 중 어디도 그 조회 결과(`.modelId`)를 쓰지 않는다. 전부 중앙 라우터 `getLlmModel(role)`을 직접 호출한다. 즉 이 스위치는 예전부터 실사용 효과가 전혀 없었다(오늘 새로 생긴 회귀 아님, 현재 라이브 모델 자체는 스펙과 일치해 장애 아님).

대표님 결정: 이 기능을 고쳐서 살리는 대신, **관리자 페이지의 즉시 전환 스위치·드롭다운·저장 버튼·모델 변경 API·DB UPDATE·mutation Server Action을 전부 제거**하고, 메뉴/페이지명을 **"LLM 사용 현황"**으로 바꿔 **읽기 전용**으로 재구성한다.

## 범위

- `app/admin/page.tsx` (또는 별도 `app/admin/llm-status/page.tsx`로 분리해도 무방 — 기존 메뉴 구조에 맞게 판단)
- `app/api/admin/llm-status/route.ts` (신규, 읽기 전용 GET)
- `app/api/admin/provider-switch/route.ts` (제거 또는 읽기 전용으로 대체 — mutation 경로 삭제)
- `app/api/_lib/ai.ts` (조회만 하고 버려지는 `provider_switch_settings` DB 조회 경로 정리 — 실제 서비스가 참조하는 모델 설정값 자체는 삭제 금지, `getLlmModel` 직접 호출 경로만 유지)
- `lib/llm/modelRouter.ts` (필요 시 resolver 함수 추가만, 기존 role→model 매핑 삭제 금지)
- 신규 공통 resolver/registry 파일 (예: `lib/admin/llmStatus.ts`) — 감사 결과를 실제 AI 호출부와 동일한 source of truth로 계산

수정 금지:

- 실제 서비스가 현재 참조하는 모델 설정값(`LLM_MODEL_ROLES`, 각 기능의 `getLlmModel(role)` 호출) 삭제
- Production DB/환경변수 직접 변경 (읽기만)
- API Key, Service Account JSON, Access Token, Refresh Token, Supabase Service Role Key, DB 비밀번호, 인증 Header 노출

## 현재 상태

- `app/api/admin/provider-switch/route.ts`: GET(조회)/POST(DB UPDATE, group A/B/C) 둘 다 존재. POST로 바뀐 값은 `getModelForGroup()`이 조회하지만 그 반환값(`.modelId`)을 쓰는 실제 호출부가 없다.
- `app/admin/page.tsx`: `MODEL_OPTIONS`로 A/B 그룹 드롭다운 + 저장 버튼 UI 존재.
- `app/api/_lib/ai.ts`의 `getModelForGroup(group)`: DB 조회 + 10초 TTL 캐시 + `getLlmModel(roleForGroup(group))` fallback. 이 함수의 반환값을 실제로 쓰는 호출부가 코드베이스에 없음(045 리뷰에서 확인).
- `lib/llm/modelRouter.ts`: `LLM_MODEL_ROLES`(역할→모델ID), `LLM_ENV_KEYS`(역할→env var명), `getLlmModel(role)`(env override, 없으면 정적 기본값), `getEnvValue()`(Node/Deno 겸용) — 실제 서비스가 쓰는 진짜 source of truth.
- Vertex Live 릴레이는 별도 Cloud Run 서비스(`services/vertex-live-relay`)에서 자체 환경변수로 모델을 결정 — 이 저장소 코드가 아니므로 감사 시 "확인 불가"로 표시될 가능성 있음(추측 금지, 있는 그대로 표시).

## 요구사항

### 1. 기존 기능 제거
- `app/admin/page.tsx`에서 즉시 모델 전환 스위치·드롭다운·저장 버튼 UI 제거.
- `app/api/admin/provider-switch/route.ts`의 POST(mutation) 핸들러 제거. GET을 남길지는 신규 API로 완전히 대체할지 판단해서 처리(중복 방지).
- `app/api/_lib/ai.ts`의 `getModelForGroup()` — DB 조회+캐시 로직 자체를 삭제하고, 실제 호출부가 필요로 하는 `provider`만 정적으로 반환하도록 단순화(또는 호출부를 감사해 애초에 이 함수가 왜 필요한지 재확인 후 정리). **단, `getLlmModel(role)` 기반의 실제 fallback 값 계산 로직은 유지.**

### 2. 전체 저장소 AI 호출 위치 감사
아래 영역의 실제 모델 호출 지점을 전부 찾아 감사한다(grep으로 `generateContent`, `getLlmModel`, `GoogleGenAI`, `ai.models.generate*` 등 검색):
- Gemini/Vertex AI 텍스트 생성 (미션 응답, 자유대화, 부모-케이 대화, 부모 질문지 등)
- Live API (음성 미션)
- STT / TTS
- Context Correction (V3: `lib/batch/contextCorrectionV3.ts`)
- Memory Batch / Daily·Weekly·Monthly Report (V3: `lib/batch/dailyReportV3.ts`, `lib/batch/generateWeeklySummary.ts` 등)
- RAG / Embedding (있다면)
- Supabase Edge Function(`supabase/functions/_shared/batch.ts` 등 Deno 런타임)
- Cron 트리거 경로
- 공통 AI 클라이언트(`app/api/_lib/ai.ts`, `createGenAIClient`)

각 기능마다 다음을 확정한다: 기능명 / 처리 유형 / 플랫폼(Vercel Node / Supabase Edge Function / Cloud Run) / 내부 호출 경로(파일:함수) / 환경변수 키 / 코드 기본값 / 실제 SDK 호출에 전달되는 effective model / fallback / Vertex AI 리전 / 상태.

값을 코드·환경변수로 확인할 수 없으면 추측하지 말고 `미설정` / `설정 불일치` / `확인 불가` / `기본값 사용` / `정상` 중 정확한 상태로 표시한다.

### 3. Resolver 원칙
관리자 화면에 표시할 모델명을 별도로 하드코딩하지 않는다. 실제 AI 호출부와 동일한 공통 model registry(`lib/llm/modelRouter.ts`) 또는 신규 resolver를 사용해 다음 순서로 effective model을 계산한다: **환경변수 지정값 → 기능별 override → 코드 기본값/fallback → 최종 SDK 전달값**.

### 4. 신규 관리자 페이지 UI
- 페이지 상단: 현재 환경(Development/Production/Preview), 배포 커밋, 배포/빌드 시각, 마지막 확인 시각, 등록 기능 수, 정상 수, 미설정 수, 불일치 수.
- 기능별 표: 기능 영역 / 처리 유형 / 플랫폼 / 실제 적용 모델 / 설정 출처 / fallback / 상태.
- 상세 영역(행 클릭 또는 펼치기): 내부 기능 ID, 파일/함수 경로, Edge Function 이름, 환경변수 키, 코드 기본값, 실제 적용값, fallback, 리전, API 방식, 경고 사유.

### 5. 신규 API
- `GET /api/admin/llm-status` (또는 기존 관리자 API 패턴과 동일한 인증 방식의 동등 경로).
- 서버에서 관리자 권한 검증(`requireAdmin()` 등 기존 패턴 재사용).
- `no-store` 캐시 정책 적용.
- **현재 배포 환경의 정보만 반환** — Dev 화면은 Dev Vercel 환경변수·Dev Supabase Secrets·Dev 코드/Edge Function 기준값만, Production 화면은 Production 설정만. 서로 다른 환경의 Secret/설정을 조회하지 않는다.
- Supabase Edge Function의 모델값은 Secret 전체 조회 방식으로 가져오지 않는다. 비밀이 아닌 모델 ID는 공통 registry에서 공유하거나, 관리자 전용 메타데이터 상태 API로 확인한다.

### 6. 보안
API Key, Service Account JSON, Access Token, Refresh Token, Supabase Service Role Key, DB 비밀번호, 인증 Header 등은 화면·API 응답·로그·임시 파일 어디에도 노출하지 않는다. 설정 "여부"만 표시한다(예: `설정됨` / `미설정`).

## 데이터·환경변수·배포

- DB 변경: 없음 (읽기만 — `provider_switch_settings` 테이블 자체는 남겨두되 더 이상 쓰지 않음, 삭제는 이 지시서 범위 밖)
- 마이그레이션: 없음
- 환경변수 변경: 없음
- Dev 배포: 필요
- Production 변경: 대표님 별도 승인 필요 (Dev 검증 통과 후 이어서 Production 배포까지 지시서에 포함되어 있으나, 실제 실행 직전 CLAUDE.md 하드룰7 절차대로 진행)
- 데이터 보정: 없음

## 완료조건

- 위 요구사항을 모두 충족한다.
- `npx tsc --noEmit` 통과, `npx next build` 성공
- 관련 자동테스트 통과 (`npm run test`)
- Dev와 Production 각각에서: 관리자 화면 표시값 / 상태 API 값 / 실제 SDK 호출 직전 resolver 결과가 기능별로 일치하는지 검증
- 관리자 접근 성공, 일반 부모/아이 계정 접근 차단 확인
- 환경 배지, 모바일/PC UI, 로딩/오류/빈 상태 확인
- Secret류 미노출 확인 (응답 body, 로그 grep으로 재확인)
- 기존 Live API/STT/TTS/Collection/Context Correction/Memory Batch/리포트/부모 대화 기능 회귀 없음
- `git diff --stat`으로 허용 범위 밖 변경이 없는지 확인
- Dev 배포 완료 후 Production 배포까지 완료
- 커밋 SHA, Dev/Production URL 보고

## 검증 시나리오

1. 관리자 계정으로 `/admin` 진입 → "LLM 사용 현황" 메뉴 클릭
2. Dev 환경에서 A/B/C 그룹 + STT/TTS/Live/Report/Context Correction 등 전체 기능이 표에 나타나는지 확인
3. 표의 "실제 적용 모델" 값이 실제 라이브 API 호출(`gcai-health` 등 기존 헬스체크)에서 나온 `modelVersion`과 일치하는지 대조
4. 의도적으로 존재하지 않는 환경변수를 가정한 기능이 있다면 `미설정`으로 정확히 표시되는지 확인 (실제로 그런 케이스가 없으면 스킵)
5. 일반 부모/아이 계정으로 API 직접 호출 시 403/401 확인
6. 응답 body와 서버 로그에 Service Account JSON/토큰류가 없는지 grep 확인
7. Production 배포 후 동일하게 Production 전용 값만 표시되는지 확인 (Dev 값이 섞이지 않음)

## 공유파일 수정

- `app/api/_lib/ai.ts`: `getModelForGroup`/`createGenAIClient` 정리(§1 참조) — 실제 fallback 계산 로직(`getLlmModel(roleForGroup(group))`)은 유지, 12개 호출부의 `createGenAIClient(config)` 호출 자체는 깨지지 않게 유지.
- `lib/llm/modelRouter.ts`: 필요 시 resolver 함수 추가만, 기존 role→model 매핑(`LLM_MODEL_ROLES`) 삭제 금지.

## 작업 및 리뷰 방식

- 1차 개발: 안티그래비티 (agy)
- 오케스트레이션·코드 리뷰·통합: 메인 Claude Code
- 정적 리뷰: codex(가용 시) 또는 메인 Claude
- 동적 QA: 별도 agy QA 세션 (Playwright, 관리자 계정 로그인 → LLM 사용 현황 페이지 진입 → 표 데이터 확인, 일반 계정 접근 차단 확인)
- Dev 배포 후 Production까지 이어서 진행 (하드룰7)

## 최종 보고 형식

- 제거한 기능 목록
- 발견한 AI 사용 영역 전체 목록(기능별 effective model / 설정 출처 / fallback / 미설정 또는 불일치 여부)
- 수정 파일 목록
- 테스트 결과
- 검증 결과
- 커밋 SHA
- Dev/Production URL
- 대표님 확인이 필요한 항목
- 남은 문제 또는 차단 사항
