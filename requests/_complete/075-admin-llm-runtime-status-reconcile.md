# Request: 관리자 LLM 사용 현황 실제 런타임 기준 전면 정리

## 0. 작업 목적

현재 관리자 `LLM 사용 현황` 화면에 표시되는 모델, 환경변수, 호출 위치, 리전, SDK/API 정보 일부가 실제 Dev/Production 런타임과 다르다.

Antigravity가 프로젝트 전체 소스 코드, Cloud Run Relay, Supabase Edge Functions 및 환경설정을 읽기 전용으로 감사한 결과를 기준으로 관리자 화면을 **실제 런타임 Single Source of Truth와 일치하도록 전면 정리**한다.

이번 작업의 핵심은 아래다.

- 잘못된 STT/TTS 정보 수정
- Premium Live 호출 위치 및 SDK 수정
- 실제 리전 `us-central1` 반영
- Supabase Batch 리포트 API 방식 수정
- 누락된 방학/개학 이벤트 감지 추가
- 누락된 Embedding 모델 추가
- Health Check 전용 모델 행 제거
- Lean/Reaction Fallback을 독립 행으로 만들지 않고 본 기능 행에 표시
- 과거 A/B/C 프로필 명칭 제거
- 실제 서비스 기능 중심의 운영 화면으로 재구성

---

## 1. 최종 표시 행 수

관리자 운영 화면에는 최종적으로 **18개 행**을 표시한다.

### 서비스 기능 17개

1. Mode E Lean 미션
2. Mode E Reaction
3. 일반 미션 대화
4. 미션 기억 안부 인사
5. 자유대화 기억 연계
6. 부모 기억 조회
7. 아이 답변 분류
8. 부모-K 대화
9. 부모 질문 생성
10. Context Correction
11. 일일 리포트
12. 주간 리포트
13. Supabase Batch 리포트
14. 방학/개학 이벤트 감지
15. Premium 실시간 음성 (Live)
16. 아동 음성 전사 (STT)
17. 케이 음성 합성 (TTS)

### AI 인프라 1개

18. LLM Wiki 벡터 검색 (Embedding)

Embedding은 실제 `gemini-embedding-001` 모델을 사용하고 있으며 Production에서 직접 호출되는 실제 AI 기능이므로 별도 인프라 행으로 포함한다.

---

## 2. 제거 대상

관리자 표에서 아래 항목은 제거한다.

### 2.1 Health Check 전용 행

제거:

```text
관리자 텍스트 Health
관리자 Live Health
```

사유:

- 사용자 서비스 기능이 아님
- 관리자 진단용 호출
- 운영 기능 목록을 불필요하게 부풀림
- 실제 서비스 모델 현황과 혼동 발생

Health API 자체는 삭제하지 않는다.

### 2.2 Fallback 독립 행

제거:

```text
Mode E Lean 폴백
Mode E Reaction 폴백
```

Fallback 로직은 유지한다.

대신 본 기능 행 내부에 아래처럼 표시한다.

```text
Primary: gemini-3.5-flash-lite
Fallback: gemini-3.5-flash
```

### 2.3 과거 프로필 명칭

기존:

```text
미션 일반 대화 (A/B)
프리미엄 라이브 음성 (C)
```

변경:

```text
일반 미션 대화
Premium 실시간 음성 (Live)
```

A/B/C 프로필 표기는 제거한다.

---

## 3. 최종 실제 모델 매핑

아래 표를 관리자 화면의 기준으로 사용한다.

| 구분 | 기능 | 실제 모델 | 환경변수 | 코드 위치 | SDK/API | 리전 |
|---|---|---|---|---|---|---|
| 텍스트 LLM | Mode E Lean 미션 | `gemini-3.5-flash-lite` | `LLM_MODEL_MISSION_LEAN` | `app/api/mission/respond-lean/route.ts` | `@google/genai` | `us-central1` |
| 텍스트 LLM | Mode E Reaction | `gemini-3.5-flash-lite` | `LLM_MODEL_MISSION_REACTION` | `app/api/mission/reaction-lean/route.ts` | `@google/genai` | `us-central1` |
| 텍스트 LLM | 일반 미션 대화 | `gemini-3.5-flash` | `LLM_MODEL_MISSION_GENERAL` | `app/api/mission/respond/route.ts` | `@google/genai` | `us-central1` |
| 텍스트 LLM | 미션 기억 안부 인사 | `gemini-3.5-flash-lite` | `LLM_MODEL_MISSION_MEMORY_GREETING` | `lib/mission/memoryGreeting.ts` | `@google/genai` | `us-central1` |
| 텍스트 LLM | 자유대화 기억 연계 | `gemini-3.5-flash-lite` | `LLM_MODEL_FREECHAT_MEMORY_RECALL` | `lib/freechat/memoryRecallResponder.ts` | `@google/genai` | `us-central1` |
| 텍스트 LLM | 부모 기억 조회 | `gemini-3.5-flash-lite` | `LLM_MODEL_PARENT_MEMORY_QUERY` | `app/api/parent/memory/query/route.ts` | `@google/genai` | `us-central1` |
| 텍스트 LLM | 아이 답변 분류 | `gemini-3.5-flash` | `LLM_MODEL_CHILD_CLASSIFICATION` | `lib/questions/answer-classifier.ts` | `@google/genai` | `us-central1` |
| 텍스트 LLM | 부모-K 대화 | `gemini-3.5-flash-lite` | `LLM_MODEL_PARENT_K_CHAT` | `app/api/parent/k-chat/route.ts` | `@google/genai` | `us-central1` |
| 텍스트 LLM | 부모 질문 생성 | `gemini-3.5-flash` | `LLM_MODEL_PARENT_QUESTION_GENERATION` | `app/api/parent/questions/route.ts` | `@google/genai` | `us-central1` |
| Batch | Context Correction | `gemini-3.5-flash` | `LLM_MODEL_CONTEXT_CORRECTION` | `lib/batch/contextCorrectionV3.ts` | `@google/genai` | `us-central1` |
| Batch | 일일 리포트 | `gemini-3.6-flash` | `LLM_MODEL_DAILY_REPORT` | `lib/batch/dailyReportV3.ts` | `@google/genai` | `us-central1` |
| Batch | 주간 리포트 | `gemini-3.6-flash` | `LLM_MODEL_WEEKLY_REPORT` | `lib/batch/generateWeeklySummary.ts` | `@google/genai` | `us-central1` |
| Batch | Supabase Batch 리포트 | `gemini-3.5-flash` | `LLM_MODEL_BATCH_REPORT` | `supabase/functions/_shared/batch.ts` | REST / `npm:@google/genai` Deno | `us-central1` |
| 이벤트 감지 | 방학/개학 이벤트 감지 | `gemini-3.5-flash` | `LLM_MODEL_VACATION_EVENT_DETECTION` | `lib/plan/vacationEventDetector.ts` | `@google/genai` | `us-central1` |
| Live 음성 | Premium 실시간 음성 (Live) | `gemini-live-2.5-flash-native-audio` | `LLM_MODEL_PREMIUM_LIVE_VOICE` | `services/vertex-live-relay/src/server.ts` | `@google-cloud/vertexai` | `us-central1` |
| STT | 아동 음성 전사 (STT) | `default` (`ko-KR`) | `GCP_STT_API_KEY` | `app/api/mission/stt/route.ts` | GCP Speech REST | Global |
| TTS | 케이 음성 합성 (TTS) | `ko-KR-Wavenet-A` | `GCP_TTS_API_KEY` | `app/api/voice/tts/route.ts` | GCP TTS REST | Global |
| Embedding | LLM Wiki 벡터 검색 | `gemini-embedding-001` | `LLM_MODEL_EMBEDDING` 또는 실제 공통 설정 확인 | `lib/memory/vectorRetrieval.ts`, `supabase/functions/_shared/batch.ts` | `@google/genai` / `npm:@google/genai` | `us-central1` |

---

## 4. Fallback 표시

Mode E Lean / Reaction은 본 행에 fallback을 함께 표시한다.

### Mode E Lean 미션

```text
Primary
gemini-3.5-flash-lite

Fallback
gemini-3.5-flash
```

환경변수:

```text
LLM_MODEL_MISSION_LEAN
LLM_MODEL_MISSION_LEAN_FALLBACK
```

### Mode E Reaction

```text
Primary
gemini-3.5-flash-lite

Fallback
gemini-3.5-flash
```

환경변수:

```text
LLM_MODEL_MISSION_REACTION
LLM_MODEL_MISSION_REACTION_FALLBACK
```

Fallback은 독립 기능 수에 포함하지 않는다.

---

## 5. 현재 화면에서 확정 수정해야 할 항목

### 5.1 STT

현재 화면의 잘못된 값:

```text
모델: latest_long
환경변수: GCP_VERTEX_SA_KEY_JSON
호출부: app/api/stt/route.ts (추정)
```

실제값:

```text
기능: 아동 음성 전사 (STT)
모델: default
Language: ko-KR
환경변수: GCP_STT_API_KEY
호출부: app/api/mission/stt/route.ts
API: GCP Speech REST
리전: Global
```

`(추정)` 문구 제거.

### 5.2 TTS

현재 화면의 잘못된 값:

```text
모델: ko-KR-Journey-F
환경변수: GCP_VERTEX_SA_KEY_JSON
호출부: app/api/tts/route.ts (추정)
```

실제값:

```text
기능: 케이 음성 합성 (TTS)
모델: ko-KR-Wavenet-A
환경변수: GCP_TTS_API_KEY
호출부: app/api/voice/tts/route.ts
API: GCP TTS REST
리전: Global
```

`(추정)` 문구 제거.

### 5.3 Premium Live

현재 관리자에서 token route를 실제 모델 호출 위치처럼 표시하고 있다면 수정한다.

실제 모델 호출 위치:

```text
services/vertex-live-relay/src/server.ts
```

실제 SDK:

```text
@google-cloud/vertexai
```

실제 리전:

```text
us-central1
```

`app/api/voice/token/route.ts`는 인증/토큰 또는 연결 준비 역할이면 별도 상세 설명으로만 남기고, `호출부` 대표 위치로 사용하지 않는다.

### 5.4 모든 Gemini 텍스트 모델 리전

현재 화면이 `global`로 표시하고 있다면 실제 런타임 기준으로:

```text
us-central1
```

로 수정한다.

### 5.5 Supabase Batch 리포트

실제 실행 환경을 정확히 표시한다.

```text
Runtime: Supabase Edge / Deno
SDK/API: npm:@google/genai 또는 실제 REST 호출 방식
Region: us-central1
```

Vercel Node처럼 잘못 표시하지 않는다.

---

## 6. 새로 추가할 기능

### 6.1 방학/개학 이벤트 감지

실제 Production 활성 기능이므로 반드시 추가한다.

```text
기능명: 방학/개학 이벤트 감지
실제 모델: gemini-3.5-flash
환경변수: LLM_MODEL_VACATION_EVENT_DETECTION
코드: lib/plan/vacationEventDetector.ts
SDK: @google/genai
리전: us-central1
상태: 정상
```

실제 호출 플로우:

```text
미션 답변
→ app/api/mission/answer/route.ts
→ scheduleVacationEventDetection(...)

자유대화 메시지
→ app/api/chat/messages/route.ts
→ processVacationEventDetection(...)
```

사용자 발화의 방학/개학 관련 이벤트를 감지해 `vacation_events`에 기록하는 실제 기능이다.

### 6.2 LLM Wiki 벡터 검색 (Embedding)

실제 AI 모델 사용 기능이므로 인프라 행으로 추가한다.

```text
기능명: LLM Wiki 벡터 검색
모델: gemini-embedding-001
리전: us-central1
```

호출부 2곳:

```text
lib/memory/vectorRetrieval.ts
supabase/functions/_shared/batch.ts
```

표시 방식:

```text
호출부:
Next.js Vector Search
Supabase Memory Batch
```

SDK/API:

```text
@google/genai
npm:@google/genai
```

원문 텍스트나 embedding vector를 관리자 화면에 노출하지 않는다.

---

## 7. 화면 컬럼 구조 개선

현재 컬럼을 다음처럼 정리한다.

| 기능명 | 실제 적용 모델 | Fallback | 환경변수 | Runtime / SDK | 호출부 | 리전 | 상태 |
|---|---|---|---|---|---|---|---|

### 기능명

예:

```text
Mode E Lean 미션
방학/개학 이벤트 감지
LLM Wiki 벡터 검색
```

작은 보조문구:

```text
텍스트 LLM · Vercel Node
Live · Cloud Run
Batch · Supabase Edge
STT · GCP REST
```

### 실제 적용 모델

실제 런타임 모델만 표시한다.

### Fallback

fallback이 있는 기능만 표시.

없으면:

```text
-
```

### 환경변수

실제 모델 선택에 사용되는 환경변수 키만 표시.

Secret 값은 절대 표시하지 않는다.

### Runtime / SDK

예:

```text
Vercel Node
@google/genai
```

```text
Cloud Run
@google-cloud/vertexai
```

```text
Supabase Edge / Deno
npm:@google/genai
```

### 호출부

실제 모델 API를 호출하는 대표 소스 파일 표시.

`(추정)` 금지.

### 리전

실제값:

```text
us-central1
Global
```

### 상태

실제 코드/환경 설정이 일치하면:

```text
정상
```

확인되지 않은 임의 상태값은 표시하지 않는다.

---

## 8. 상단 요약 카드 수정

현재 요약에는 최소 아래만 유지한다.

```text
환경: Production
등록 기능 수: 18개
정상: N개
오류: N개
마지막 확인 시각
```

등록 기능 수는 독립 서비스 기능 + Embedding 인프라 행 기준으로 18개다.

Fallback 2개와 Health Check 2개는 등록 기능 수에 포함하지 않는다.

### 오류 정의

다음에 해당할 때만 오류:

- 실제 모델 선택 실패
- 필수 환경변수 누락
- 등록된 실제 코드 위치가 존재하지 않음
- 모델 resolver와 실제 적용 모델이 불일치
- 런타임 점검에서 실제 오류 확인

단순히 화면 메타데이터가 없다고 오류로 만들지 않는다.

---

## 9. Single Source of Truth

관리자 화면에 별도 모델명을 하드코딩하지 않는다.

가능한 한 아래 실제 설정 소스를 재사용한다.

```text
lib/llm/modelRouter.ts
실제 각 기능의 환경변수
실제 호출부 코드
```

단, STT/TTS/Embedding/Live처럼 `modelRouter.ts` 외부에 있는 기능은 각 실제 호출부의 확정 설정을 읽는 공통 registry로 정리할 수 있다.

권장 구조:

```text
lib/admin/aiRuntimeRegistry.ts
```

또는 기존 `lib/admin/llmStatus.ts`가 있으면 해당 파일을 확장한다.

목표:

```text
실제 런타임 설정
= 관리자 표시 설정
```

동일한 모델 ID를 두 군데에 중복 하드코딩하지 않는다.

---

## 10. 구형 주석 정리

Antigravity에서 확인된 구형 주석도 함께 정리한다.

대상:

```text
lib/plan/pricing.ts
GEMINI.md
```

현재 런타임과 관계없는 구형 모델 표기:

```text
gemma-4-31b-it
gemini-2.5-flash
Gemma 고정 관련 주석
```

실제 정책에 맞는 현재 모델 설명으로 갱신하거나 더 이상 의미가 없으면 제거한다.

주의:

- 실행 로직 변경 금지
- 주석/문서만 현재 실제 구조에 맞게 정리
- 정책 문서를 임의로 새 모델 정책으로 바꾸지 말고 실제 현재 코드 기준으로 수정

---

## 11. Dev / Production 기준

Antigravity 감사 결과 현재 Dev/Production은 같은 모델 routing 구조를 사용한다.

관리자 화면은 환경에 따라 실제 현재 배포 환경 값을 표시한다.

```text
환경: Development
환경: Production
```

Production 화면에서 Dev 값이 섞이지 않게 한다.

환경변수의 실제 Secret 값은 표시하지 않고 키 이름과 적용 모델만 표시한다.

---

## 12. 검증 요구사항

### 12.1 정확성

최종 관리자 표의 18개 행이 실제 코드와 1:1 일치해야 한다.

각 행에 대해 검증:

```text
기능명
실제 모델
환경변수 키
대표 호출부
SDK/API
리전
Runtime
Fallback
```

### 12.2 STT

화면:

```text
default
GCP_STT_API_KEY
app/api/mission/stt/route.ts
```

실제 코드와 일치해야 함.

### 12.3 TTS

화면:

```text
ko-KR-Wavenet-A
GCP_TTS_API_KEY
app/api/voice/tts/route.ts
```

실제 코드와 일치해야 함.

### 12.4 Live

화면 대표 호출부:

```text
services/vertex-live-relay/src/server.ts
```

SDK:

```text
@google-cloud/vertexai
```

리전:

```text
us-central1
```

### 12.5 방학 이벤트

관리자 표에 행 존재.

```text
방학/개학 이벤트 감지
gemini-3.5-flash
```

### 12.6 Embedding

관리자 표에 행 존재.

```text
LLM Wiki 벡터 검색
gemini-embedding-001
```

호출부 2곳이 상세에 표시돼야 한다.

### 12.7 Fallback

Lean / Reaction에만 fallback이 본 행에 표시.

독립 fallback 행 0개.

### 12.8 Health

관리자 텍스트 Health / Live Health 독립 행 0개.

Health API 실제 기능은 그대로 유지.

---

## 13. UI 회귀 테스트

확인:

- 기존 관리자 LLM 페이지 정상 로딩
- 좌측 독립 스크롤 구조 유지
- 표 세로/가로 스크롤 정상
- 상태 배지 깨짐 없음
- 긴 코드 위치 말줄임/툴팁 정상
- 모바일에서 표 또는 카드형 정상 표시
- 비밀정보 노출 없음

---

## 14. 완료 조건

아래를 모두 만족해야 완료다.

- 최종 관리자 AI 기능 18개 행 표시
- STT 실제값으로 수정
- TTS 실제값으로 수정
- Premium Live 호출부/SDK/리전 수정
- 모든 Gemini 텍스트 리전 `us-central1` 정합성 확인
- Supabase Batch Runtime/API 수정
- 방학/개학 이벤트 감지 추가
- LLM Wiki Embedding 추가
- Health Check 2종 독립 행 제거
- Fallback 2종 독립 행 제거
- Lean/Reaction fallback 본 행 표시
- A/B/C 명칭 제거
- `추정` 호출부 0건
- 관리자 모델 정보 중복 하드코딩 최소화
- 구형 Gemma/Gemini 주석 정리
- TypeScript 오류 0건
- Build 성공
- Dev E2E PASS
- Production 배포 완료
- Production 실제 화면과 런타임 매핑 검증 PASS
- Secret/API Key/Token 값 노출 0건

---

## 15. 완료 보고 형식

1. 기존 관리자 화면과 실제 런타임 차이 목록
2. 제거한 행 목록
3. 수정한 행 목록
4. 새로 추가한 행 목록
5. 최종 18개 행 전체 목록
6. STT before → after
7. TTS before → after
8. Live before → after
9. Fallback 표시 방식
10. Embedding 표시 방식
11. 방학/개학 이벤트 표시 방식
12. Single Source of Truth 구현 방식
13. 수정·추가한 파일
14. 구형 주석 정리 결과
15. TypeScript/Build 결과
16. Dev E2E 결과
17. Production 배포 커밋
18. Production Deployment ID / READY 상태
19. Production 스모크 테스트 결과
20. 남은 불일치 또는 위험

---

## 16. 보안 및 작업 제한

- API Key 실제 값 출력 금지
- Service Account JSON 출력 금지
- Token 출력 금지
- Secret 값 관리자 화면 노출 금지
- Health API 삭제 금지
- 실제 모델 runtime을 이번 작업에서 임의 변경 금지
- STT를 `latest_long`으로 변경하지 말고 현재 실제값 `default`를 표시
- TTS를 `Journey-F`로 변경하지 말고 현재 실제값 `ko-KR-Wavenet-A`를 표시
- 모델 이름을 관리자용으로 별도 하드코딩해 실제 코드와 다시 어긋나게 만들지 말 것
