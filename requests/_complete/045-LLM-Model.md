# Dev·Production 전체 LLM 모델 매핑 재점검 및 미적용 항목 수정

## 1. 작업 목적

K-Bestie-v3의 개발(Dev) 환경과 프로덕션(Production) 환경에서 기능별 LLM 모델이 확정 매핑대로 적용되었는지 다시 전수 점검한다.

코드에 모델 이름이 적혀 있는지만 확인하지 말고 다음 설정을 모두 추적하여 각 기능이 런타임에 최종적으로 선택하는 모델을 확인한다.

- 중앙 Model Router
- 기능별 코드 기본값
- Vercel 환경변수
- Supabase Edge Function Secrets
- Supabase Batch·Cron 직접 REST 호출
- Cloud Run Live Relay 환경변수
- 관리자 페이지 테스트 API
- 모델 하드코딩 및 fallback
- Dev·Production 배포별 환경 차이

확정 모델과 다른 모델을 사용하는 항목, 중앙 Model Router를 우회하는 항목, 실제 모델을 확인할 수 없는 항목은 모두 수정하고 검증한다.

---

## 2. 환경별 작업 원칙

### Dev

Dev 환경에서 전체 점검·수정·실제 기능 테스트를 먼저 완료한다.

- Dev Vercel
- Dev Supabase
- Dev Edge Functions
- Dev Cron·Batch
- Dev Cloud Run Live Relay
- Dev 관리자 페이지

Dev에서 모든 검증을 통과한 뒤 Production 반영을 진행한다.

### Production

Dev PASS 후 동일한 수정 사항을 Production 설정과 배포에 반영한다.

- Production Vercel
- Production Supabase
- Production Edge Functions
- Production Cron·Batch
- Production Cloud Run Live Relay
- Production 관리자 페이지

Production에서는 실제 사용자 데이터 대신 QA 테스트 계정 또는 비저장 테스트 경로를 사용한다.

Production DB 스키마나 기존 사용자 데이터는 변경하지 않는다.

---

## 3. 확정 LLM 모델 매핑

| 번호 | 기능 | 기본 모델 | 실패 시 폴백 |
|---:|---|---|---|
| 1 | Premium 실시간 음성 대화 | `gemini-live-2.5-flash-native-audio` | 없음 |
| 2 | 미션 Lean 응답 | `gemini-3.5-flash-lite` | `gemini-3.5-flash` 1회 |
| 3 | 미션 짧은 반응 Reaction | `gemini-3.5-flash-lite` | `gemini-3.5-flash` 1회 |
| 4 | 미션 시작 메모리 인사 | `gemini-3.5-flash-lite` | 없음 |
| 5 | 자유대화 메모리 회상 응답 | `gemini-3.5-flash-lite` | 없음 |
| 6 | 부모의 LLM WIKI·아이 메모리 질의 | `gemini-3.5-flash-lite` | 없음 |
| 7 | 일반 미션 응답·답변 분석 | `gemini-3.5-flash` | 없음 |
| 8 | 아이 답변 유효성·안전성·유형 분류 | `gemini-3.5-flash` | 없음 |
| 9 | 부모-K 대화 | `gemini-3.5-flash-lite` | 없음 |
| 10 | 부모용 질문 생성·변환 | `gemini-3.5-flash` | 없음 |
| 11 | 대화 문맥 보정 | `gemini-3.5-flash` | 없음 |
| 12 | 일일 리포트 생성 | `gemini-3.6-flash` | 없음 |
| 13 | 주간 리포트 생성 | `gemini-3.6-flash` | 없음 |
| 14 | Supabase 배치 리포트 처리 | `gemini-3.5-flash` | 없음 |
| 15 | 관리자 텍스트 LLM 헬스체크 | `gemini-3.5-flash` | 없음 |
| 16 | 관리자 실시간 음성 헬스체크 | `gemini-live-2.5-flash-native-audio` | 없음 |

---

## 4. 전수 점검 범위

다음 위치에서 Gemini 모델 ID와 모델 결정 로직을 모두 검색한다.

```text
gemini-
gemma-
getLlmModel
modelRouter
LLM_MODEL
GEMINI_MODEL
modelId
generateContent
streamGenerateContent
GoogleGenAI
@google/genai
@google-cloud/vertexai
aiplatform.googleapis.com
global-aiplatform.googleapis.com
us-central1
/v1/
/v1beta1/
thinkingBudget
thinkingLevel
responseSchema
responseMimeType
```

점검 대상 디렉터리와 서비스:

- `app/`
- `app/api/`
- `lib/`
- `services/`
- `supabase/functions/`
- 관리자 페이지
- Vercel Dev·Production 환경변수
- Supabase Dev·Production Secrets
- Cloud Run Dev·Production 환경변수
- Cron 및 Batch 설정
- 배포 스크립트
- 테스트·Health Check API
- 비용 및 사용량 집계 코드

문서·과거 로그·사용하지 않는 테스트 파일에 포함된 모델명과 실제 실행 코드에 포함된 모델명을 구분한다.

---

## 5. 현재 확인된 우선 점검 대상

기존 조사에서 다음 미적용 가능성이 발견됐다. 현재 코드와 배포 상태를 다시 확인하고, 실제로 남아 있으면 수정한다.

### 5.1 리포트 모델

`reportModel.ts` 또는 리포트 모델 선택 코드에서 `gemini-2.5-flash`가 하드코딩되어 있는지 확인한다.

남아 있다면 중앙 Model Router를 사용하도록 변경한다.

- 일일 리포트: `gemini-3.6-flash`
- 주간 리포트: `gemini-3.6-flash`

일일·주간 리포트가 하나의 공통 기본 모델을 무조건 사용하는 구조라면 리포트 유형별 역할 키를 분리한다.

### 5.2 Supabase Batch

`supabase/functions/_shared/batch.ts` 및 관련 Edge Function에서 `gemini-2.5-flash`가 하드코딩되어 있는지 확인한다.

남아 있다면 다음 모델을 사용하도록 변경한다.

```text
gemini-3.5-flash
```

Batch가 독자적인 모델 문자열을 가지지 않도록 공통 설정이나 Supabase용 공유 Model Router를 사용한다.

Next.js의 Node.js 모듈을 Deno Edge Function에서 직접 불러올 수 없다면, 동일한 역할 키와 기본 모델을 공유하는 Deno 호환 설정 파일을 구성한다.

### 5.3 직접 REST 호출

직접 REST를 사용하는 호출부에서 다음 항목을 확인한다.

- 모델 ID
- API 버전
- 호스트
- location
- 인증 방식
- 요청 payload
- 응답 파싱

텍스트 Gemini 3.x 호출은 올바른 Vertex AI global 경로를 사용한다.

```text
https://aiplatform.googleapis.com/{API_VERSION}/projects/{PROJECT_ID}/locations/global/publishers/google/models/{MODEL_ID}:generateContent
```

`global-aiplatform.googleapis.com`은 사용하지 않는다.

`us-central1` fallback이 실제 텍스트 모델 호출에 남아 있다면 제거하거나 명확한 모델별 리전 설정으로 분리한다.

Live API의 지원 리전 설정은 텍스트 모델의 `global` 설정과 분리한다.

### 5.4 관리자 페이지

관리자 화면에 표시되는 모델명이 실제 런타임 모델과 일치하는지 확인한다.

- 텍스트 Health Check 모델
- Live Health Check 모델
- 현재 사용 모델 표시
- 테스트 버튼 대상 모델
- 로그의 모델명
- 비용·토큰 계산에 사용하는 모델 ID
- 오류 메시지

하드코딩된 기존 모델 표시가 남아 있으면 모두 수정한다.

---

## 6. 중앙 Model Router 적용

각 기능 코드가 모델 문자열을 직접 가지지 않도록 중앙 모델 역할을 사용한다.

최소한 다음 역할 키를 제공한다.

```ts
export const LLM_MODEL_ROLES = {
  premiumLiveVoice: "gemini-live-2.5-flash-native-audio",

  missionLean: "gemini-3.5-flash-lite",
  missionLeanFallback: "gemini-3.5-flash",

  missionReaction: "gemini-3.5-flash-lite",
  missionReactionFallback: "gemini-3.5-flash",

  missionMemoryGreeting: "gemini-3.5-flash-lite",
  freechatMemoryRecall: "gemini-3.5-flash-lite",
  parentMemoryQuery: "gemini-3.5-flash-lite",

  missionGeneral: "gemini-3.5-flash",
  childAnswerClassification: "gemini-3.5-flash",

  parentKChat: "gemini-3.5-flash-lite",
  parentQuestionGeneration: "gemini-3.5-flash",

  contextCorrection: "gemini-3.5-flash",

  dailyReport: "gemini-3.6-flash",
  weeklyReport: "gemini-3.6-flash",

  supabaseBatchReport: "gemini-3.5-flash",

  adminTextHealth: "gemini-3.5-flash",
  adminLiveHealth: "gemini-live-2.5-flash-native-audio",
} as const;
```

기존 구조와 이름이 다르면 프로젝트 규칙에 맞게 조정하되 역할과 매핑은 변경하지 않는다.

---

## 7. 환경변수 점검 및 반영

Dev와 Production을 각각 독립적으로 확인한다.

### Dev

- Vercel Development·Preview 환경변수
- Dev Supabase Secrets
- Dev Cloud Run 환경변수

### Production

- Vercel Production 환경변수
- Production Supabase Secrets
- Production Cloud Run 환경변수

각 환경에서 다음을 확인한다.

- 중앙 기본값을 환경변수가 구형 모델로 덮어쓰지 않는지
- 존재하지 않는 모델 ID가 설정되지 않았는지
- 공백·따옴표·오타가 없는지
- Dev 값과 Production 값이 의도치 않게 다른지
- 텍스트 모델 location이 `global`인지
- Live 모델 location이 기존 지원 리전인지

기능별 모델 환경변수가 없고 코드 기본값을 사용하는 경우에도 실제 배포 런타임에서 해당 기본값이 선택되는지 확인한다.

---

## 8. Lite → Flash 폴백

다음 두 기능은 기본 모델 실패 시 Flash를 정확히 한 번만 호출한다.

- 미션 Lean
- 미션 Reaction

### 폴백 허용

- timeout
- HTTP 429
- HTTP 5xx
- 빈 응답
- 필수 응답 필드 누락
- 필수 JSON 파싱 실패
- 일시적인 SDK·네트워크 오류

### 폴백 금지

- HTTP 400
- HTTP 401
- HTTP 403
- HTTP 404
- 안전 정책 차단
- 사용자 입력 검증 실패
- 잘못된 프롬프트·스키마
- 이미 폴백을 실행한 요청

다음을 보장한다.

- Flash 호출은 최대 1회
- 동일 `turn_id` 유지
- 사용자 응답 1회
- DB 저장 1회
- 이벤트 기록 1회
- 무한 재시도 없음
- 폴백 사용 여부를 로그에서 구분 가능
- 비밀정보와 실제 아이 대화 원문은 로그에 출력하지 않음

---

## 9. 모델별 호환 설정

각 기능에서 다음 설정을 점검하고 Gemini 3.x 모델에 맞게 정리한다.

- `thinkingBudget`
- `thinkingLevel`
- `maxOutputTokens`
- `temperature`
- `topP`
- `topK`
- `frequencyPenalty`
- `presencePenalty`
- `responseMimeType`
- `responseSchema`
- function calling
- 멀티턴 history
- thought signature

기존 출력 형식과 DB 저장 계약은 변경하지 않는다.

낮은 `maxOutputTokens` 때문에 Thinking 토큰만 소비하고 실제 응답이 `MAX_TOKENS`로 종료되지 않도록 기능별 출력 한도를 점검한다.

특히 관리자 Health Check의 출력 한도가 실제 응답 문자열을 받을 수 있는 값인지 확인한다.

---

## 10. 환경별 실제 검증

정적 코드 검사만으로 PASS 처리하지 않는다.

Dev와 Production 각각에서 기능별 실제 런타임 모델을 확인한다.

가능하면 응답 또는 서버 로그에서 다음을 확인한다.

- 요청 역할 키
- 최종 선택 모델 ID
- 실제 `modelVersion`
- HTTP 상태
- 요청 URL
- 프로젝트
- location
- API 버전
- `finishReason`
- 지연시간
- 입력 토큰
- 출력 토큰
- Thinking 토큰
- 폴백 실행 여부

Production은 QA 테스트 계정과 비저장 테스트 경로를 사용한다.

비저장 경로가 없는 기능은 QA 계정 범위에서 실행하고 생성된 QA 테스트 데이터만 정리한다. 일반 사용자 데이터는 사용하거나 수정하지 않는다.

---

## 11. 기능별 검증 항목

Dev와 Production에서 아래 항목을 각각 검증한다.

1. Premium 실시간 음성 연결 및 응답
2. 미션 Lean 기본 모델
3. 미션 Lean Flash 폴백
4. 미션 Reaction 기본 모델
5. 미션 Reaction Flash 폴백
6. 미션 시작 메모리 인사
7. 자유대화 메모리 회상
8. 부모 LLM WIKI·아이 메모리 질의
9. 일반 미션 응답·답변 분석
10. 아이 답변 유효성·안전성·유형 분류
11. 부모-K 대화
12. 부모용 질문 생성·변환
13. 대화 문맥 보정
14. 일일 리포트
15. 주간 리포트
16. Supabase 배치 리포트
17. 관리자 텍스트 Health Check
18. 관리자 Live Health Check

각 기능은 확정 모델과 실제 `modelVersion`이 일치해야 한다.

---

## 12. 회귀 검증

### 미션

- 짧지만 질문에 관련된 답변이 유효 처리된다.
- 기본 질문 10개 → 예비 질문 10개 → 미답변 재순환 정책이 유지된다.
- Lean과 Reaction이 중복 출력되지 않는다.
- 폴백 실행 시 답변과 저장이 중복되지 않는다.
- 다음 질문 진행 상태가 깨지지 않는다.

### 메모리

- 다른 아이의 메모리가 섞이지 않는다.
- 아이가 말하지 않은 내용을 기억처럼 생성하지 않는다.
- 원문 비공개 정책을 유지한다.

### 부모-K

- 확정 모델 `gemini-3.5-flash-lite`가 실제 사용된다.
- 아이 원문을 노출하지 않는다.
- 근거 없는 진단이나 단정이 생성되지 않는다.

### 리포트

- 일일·주간 모두 `gemini-3.6-flash`를 사용한다.
- 기존 JSON 필수 필드를 유지한다.
- 날짜와 `child_id`가 정확하다.
- 다른 아이 데이터가 섞이지 않는다.
- 리포트 UI에서 정상 표시된다.

### Supabase Batch

- `gemini-3.5-flash`를 사용한다.
- Next.js와 다른 구형 모델을 사용하지 않는다.
- 인증→Vertex 호출→JSON 파싱→저장 흐름이 정상이다.
- 동일 Job 중복 처리와 중복 저장이 없다.

### Live

- `gemini-live-2.5-flash-native-audio`를 사용한다.
- `setupComplete`
- 세션 ID
- 오디오 입력·출력
- barge-in
- 종료
- 재연결

기존 동작을 유지한다.

---

## 13. 보안 조건

- 서비스 계정 키 평문 하드코딩 금지
- Secret 값을 임시 JSON 파일로 저장하지 않음
- API 키·OAuth 토큰·비밀번호 로그 출력 금지
- 실제 아이·부모 원문 로그 출력 금지
- 기존 Vercel·Supabase·Cloud Run Secret 사용
- 로그 값 마스킹
- 테스트 스크립트와 결과 파일을 Git에 포함하지 않음
- Production Secret을 Dev 환경에 복사하지 않음

---

## 14. 적용 순서

1. 전체 모델 사용 위치 재검색
2. Dev 코드·환경변수·서비스 설정 비교
3. Dev 미적용·하드코딩 항목 수정
4. Dev 배포
5. Dev 18개 기능 실제 검증
6. Dev BLOCKED/HIGH/MEDIUM 0건 확인
7. 동일 변경을 Production 설정에 반영
8. Production 배포
9. Production QA 계정으로 18개 기능 실제 검증
10. 관리자 페이지의 모델명·Health Check 확인
11. 구형 모델 및 우회 경로 재검색
12. 최종 환경별 결과 보고

Dev 검증 전에 Production을 먼저 변경하지 않는다.

---

## 15. 완료 조건

다음 조건을 모두 충족해야 완료 처리한다.

- Dev 18개 기능 모델 매핑 PASS
- Production 18개 기능 모델 매핑 PASS
- 일일·주간 리포트 `gemini-3.6-flash` 적용
- Supabase 배치 `gemini-3.5-flash` 적용
- Lean·Reaction Lite → Flash 1회 폴백 PASS
- Premium Live 모델 적용 PASS
- 관리자 표시와 실제 모델 일치
- 구형 `gemini-2.5-flash` 실행 경로 0개
- 기능 코드의 모델 하드코딩 0개
- 환경변수 충돌 0개
- 잘못된 global 호스트 0개
- 텍스트 호출의 잘못된 `us-central1` fallback 0개
- 중복 응답·저장·이벤트 0건
- 타입 검사 PASS
- 테스트 PASS
- 빌드 PASS
- BLOCKED 0건
- HIGH 0건
- MEDIUM 0건
- 비밀정보 노출 0건
- Dev·Production 롤백 가능

---

## 16. 최종 보고 형식

### Dev 결과

| 기능 | 확정 모델 | 코드 모델 | 환경변수 모델 | 실제 modelVersion | 폴백 | 결과 |
|---|---|---|---|---|---|---|

### Production 결과

| 기능 | 확정 모델 | 코드 모델 | 환경변수 모델 | 실제 modelVersion | 폴백 | 결과 |
|---|---|---|---|---|---|---|

### 수정 파일

| 파일 | 수정 전 | 수정 후 | 대상 환경 | 검증 결과 |
|---|---|---|---|---|

### 환경 설정 변경

| 서비스 | 환경 | 환경변수 | 변경 전 | 변경 후 | 반영 결과 |
|---|---|---|---|---|---|

비밀정보 값은 출력하지 않고 모델명·프로젝트 별칭·리전 등 비민감 설정만 표시한다.

### 잔여 검색 결과

- `gemini-2.5-flash` 실제 실행 경로:
- 기타 구형 모델 실제 실행 경로:
- 모델 하드코딩:
- `/v1` 직접 호출:
- `/v1beta1` 직접 호출:
- `us-central1` 텍스트 fallback:
- 잘못된 global 호스트:
- 중앙 Model Router 우회:

### 이슈 집계

- Dev FAIL:
- Production FAIL:
- BLOCKED:
- HIGH:
- MEDIUM:
- LOW:
- 환경변수 충돌:
- 폴백 오류:
- 관리자 표시 불일치:

### 최종 판정

다음 중 하나로 명확히 보고한다.

- Dev·Production 전체 적용 완료
- Dev 완료·Production 미완료
- Dev 미완료·Production 작업 중단
- Dev·Production 모두 미완료

실제 런타임 모델 증거 없이 전체 적용 완료로 보고하지 않는다.