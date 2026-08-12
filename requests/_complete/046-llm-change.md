# 전체 LLM 모델 V3 전환 및 기능별 라우팅 구현

## 1. 작업 목적

K-Bestie-v3 Dev 환경에서 현재 사용 중인 Vertex AI Gemini 모델을 기능별 확정 모델로 전환한다.

단순 모델 문자열 일괄 치환이 아니라 다음 항목을 함께 구현한다.

- 기능별 중앙 모델 라우팅
- 미션 Lean·Reaction의 Lite → Flash 1회 폴백
- 모델별 Thinking·출력 토큰·구조화 JSON 설정
- Next.js·Supabase Batch·관리자 페이지의 모델 매핑 통일
- 기존 모델로 즉시 복구할 수 있는 롤백 구조
- Dev 실제 호출 및 대표 사용자 시나리오 검증

사전 cURL·SDK 검증에서 아래 모델이 현재 `k-bestie3` Vertex AI 프로젝트에서 정상 호출되는 것을 확인했다.

- `gemini-3.5-flash-lite`
- `gemini-3.5-flash`
- `gemini-3.6-flash`
- `gemini-live-2.5-flash-native-audio`

추가 GCP 프로젝트·서비스 계정·IAM·Allowlist 생성 작업은 하지 않는다.

---

## 2. 작업 환경 및 제한

### 작업 대상

- K-Bestie-v3 Dev 환경
- Dev Vercel
- Dev Supabase
- Dev Cloud Run Live Relay
- 관리자 Dev 페이지

### 변경 금지

다음 항목은 이번 작업에서 변경하지 않는다.

- Production 환경변수
- Production Vercel 배포
- Production Supabase DB·Edge Function·Cron
- Production Cloud Run
- 기존 서비스 계정과 IAM
- 실제 사용자 데이터
- 기존 DB 스키마 및 테이블 구조
- 미션 질문 순환 및 완료 정책
- 리포트 저장 데이터 계약

모든 Dev 검증이 PASS되기 전에는 Production 작업을 진행하지 않는다.

---

## 3. 확정 모델 매핑

| 번호 | 기능 | 기본 모델 | 폴백 모델 |
|---|---|---|---|
| 1 | Premium 실시간 음성 대화 | `gemini-live-2.5-flash-native-audio` | 없음 |
| 2 | 미션 Lean 응답 | `gemini-3.5-flash-lite` | `gemini-3.5-flash` |
| 3 | 미션 짧은 반응 Reaction | `gemini-3.5-flash-lite` | `gemini-3.5-flash` |
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

## 4. 중앙 Model Router 구현

각 기능 파일에서 모델 ID를 직접 하드코딩하지 않도록 중앙 모델 설정 모듈을 구현한다.

예시 역할 키:

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

실제 파일명과 구조는 기존 프로젝트 규칙에 맞추되 다음 조건을 충족해야 한다.

- 기능 코드는 역할 키를 통해 모델을 가져온다.
- 기존 하드코딩 모델 ID를 제거한다.
- 환경변수로 역할별 모델을 덮어쓸 수 있도록 한다.
- 환경변수가 없으면 위 확정 모델을 기본값으로 사용한다.
- Dev에서 기존 모델로 즉시 복구할 수 있는 롤백 설정을 제공한다.
- 브라우저 클라이언트에 서비스 계정·내부 엔드포인트·비밀정보를 노출하지 않는다.

---

## 5. Vertex AI 호출 방식

### 일반 텍스트 모델

일반 텍스트·JSON·리포트 호출은 최신 `@google/genai`의 Vertex AI 모드를 사용한다.

기본 설정:

```text
vertexai=true
project=k-bestie3
location=global
```

환경별 프로젝트 값은 기존 보안 환경변수에서 가져온다. 프로젝트 ID를 여러 호출 파일에 중복 하드코딩하지 않는다.

### 실시간 음성 모델

`gemini-live-2.5-flash-native-audio`는 기존 Cloud Run Bidi WebSocket 경로를 유지한다.

다음과 합치거나 변경하지 않는다.

- 일반 `generateContent`
- 일반 REST 텍스트 호출
- Supabase 배치 호출
- 텍스트 Health Check

Live 경로에서 기존 기능을 유지한다.

- Stateful WebSocket
- `setupComplete`
- PCM 16kHz 오디오 입력
- PCM 24kHz 오디오 출력
- VAD
- barge-in
- 세션 종료
- 재연결
- 오류 처리

---

## 6. Lite → Flash 폴백 구현

다음 두 기능에만 폴백을 구현한다.

- 미션 Lean 응답
- 미션 Reaction

### 폴백 조건

다음 조건에서만 `gemini-3.5-flash`를 정확히 1회 호출한다.

- 네트워크 timeout
- HTTP 429
- HTTP 5xx
- 모델의 정상 응답 본문이 비어 있음
- 필수 구조화 출력 파싱 실패
- 필수 응답 필드 누락
- SDK의 재시도 가능한 일시적 오류

### 폴백 금지 조건

다음 조건에서는 Flash 폴백을 실행하지 않는다.

- 잘못된 요청으로 인한 HTTP 400
- 인증·권한 오류 401·403
- 존재하지 않는 모델·잘못된 경로 404
- 안전 정책에 의한 차단
- 사용자 입력 검증 실패
- 프롬프트 또는 스키마 자체 오류
- 이미 폴백을 한 번 실행한 요청

### 중복 방지

폴백 전후 동일한 요청 식별자를 유지한다.

- 동일 `turn_id`
- 동일 mission/session 식별자
- 동일 idempotency key
- DB 저장은 최종 성공 응답에 대해 한 번만 수행
- 사용자 응답 전송은 한 번만 수행
- 이벤트·로그·분석 데이터 중복 기록 금지
- 무한 재시도 금지
- Lite 실패와 Flash 성공 여부는 구분하여 기록

---

## 7. 모델별 생성 설정 정리

기존 코드에 분산된 다음 설정을 전수 확인한다.

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
- multi-turn history
- thought signature

모델별 공통 설정 계층을 만들되 기존 기능의 출력 계약을 변경하지 않는다.

### 권장 Thinking 수준

| 기능 | 권장 Thinking |
|---|---|
| Lean·Reaction·메모리 인사·단순 회상 | `MINIMAL` |
| 일반 미션·유효성·유형 분류 | `LOW` |
| 부모 질문·문맥 보정 | `LOW` 또는 `MEDIUM` |
| 일일·주간 리포트 | `MEDIUM` |
| 단순 Health Check | `MINIMAL` |

현재 SDK가 `thinkingBudget`만 지원하거나 기존 동작에 의존한다면 무조건 삭제하지 말고 실제 모델 호출 결과와 타입 지원 여부를 확인한 후 `thinkingLevel`로 전환한다.

### 출력 토큰

Thinking 토큰 때문에 실제 텍스트가 생성되기 전에 `MAX_TOKENS`로 종료되지 않도록 기능별 `maxOutputTokens`를 설정한다.

특히 다음 위치를 점검한다.

- 관리자 텍스트 Health Check
- Lean 응답
- Reaction
- 구조화 JSON 분류
- 일일·주간 리포트

Health Check는 실제 응답 문자열을 확인할 수 있을 만큼 출력 토큰을 확보한다. `maxOutputTokens: 1`처럼 실제 모델 응답을 차단할 수 있는 설정은 사용하지 않는다.

---

## 8. 구조화 JSON 및 출력 계약

다음 기능은 기존 JSON 스키마를 그대로 유지한다.

- 아이 답변 유효성 판정
- 안전성·유형 분류
- 답변 분석
- 부모 질문 생성
- 대화 문맥 보정
- 일일 리포트
- 주간 리포트
- Supabase 배치 결과

검증 항목:

- `responseMimeType: application/json`
- `responseSchema`
- 필수 필드 존재
- enum 값 호환
- null 허용 여부
- 문자열·배열·객체 타입
- JSON 외부 설명 문장 혼입 여부
- 빈 응답 처리
- 잘린 JSON 처리
- 파싱 실패 시 오류 처리
- DB 저장 전 스키마 검증

기존 DB 컬럼·리포트 UI·관리자 UI가 기대하는 데이터 계약을 변경하지 않는다.

---

## 9. 기능별 적용 요구사항

### 9.1 미션 Lean 응답

- 기본 모델: `gemini-3.5-flash-lite`
- 실패 시 `gemini-3.5-flash` 1회 폴백
- 기존 Lean 응답 프롬프트와 한 턴 제어 유지
- 지나치게 긴 답변 금지
- 기존 저장 순서와 `turn_id` 유지

### 9.2 미션 Reaction

- 기본 모델: `gemini-3.5-flash-lite`
- 실패 시 `gemini-3.5-flash` 1회 폴백
- 한 문장 이내의 짧은 반응 유지
- 질문 본문이나 다음 질문과 중복되지 않도록 유지
- Reaction 실패가 전체 미션 진행을 중단시키지 않도록 한다.

### 9.3 미션 시작 메모리 인사

- 모델: `gemini-3.5-flash-lite`
- 아이의 과거 정보를 과도하게 노출하지 않는다.
- 현재 아이와 다른 아이의 메모리가 혼합되지 않도록 한다.
- 메모리 데이터가 없을 때 기존 일반 인사 폴백을 유지한다.

### 9.4 자유대화 메모리 회상

- 모델: `gemini-3.5-flash-lite`
- 최근 대화 턴과 필요한 메모리만 전달한다.
- 오래된 원문 전체를 프롬프트에 넣지 않는다.
- 아이가 하지 않은 말을 사실처럼 생성하지 않는다.

### 9.5 부모의 LLM WIKI·아이 메모리 질의

- 모델: `gemini-3.5-flash-lite`
- 부모에게 허용된 자녀 데이터만 조회한다.
- 자녀·가족 간 데이터 혼선을 방지한다.
- 원문 비공개 정책을 유지한다.

### 9.6 일반 미션 응답·답변 분석

- 모델: `gemini-3.5-flash`
- 아이의 짧고 관련 있는 답변을 유효한 답변으로 인정하는 기존 정책을 유지한다.
- 미션 질문 순환 정책을 변경하지 않는다.
  - 기본 질문 10개
  - 예비 질문 10개
  - 미답변 질문 재순환
  - 종료 멘트

### 9.7 유효성·안전성·유형 분류

- 모델: `gemini-3.5-flash`
- 구조화 JSON 출력
- 짧지만 질문에 관련된 답변
- 무관한 답변
- 침묵·무응답
- 애매한 표현
- 경계선 안전성 표현
- 명확한 위험 표현

위 입력들을 구분해 기존 후속 처리 계약과 일치하는지 검증한다.

### 9.8 부모-K 대화

- 모델: `gemini-3.5-flash-lite`
- 부모 질문에 간결하게 응답한다.
- 아이 원문을 그대로 노출하지 않는다.
- 진단·단정 표현을 생성하지 않는다.
- 리포트와 LLM WIKI에 없는 사실을 만들어내지 않는다.

### 9.9 부모용 질문 생성·변환

- 모델: `gemini-3.5-flash`
- 부모가 실제로 사용할 수 있는 자연스러운 한국어 질문을 생성한다.
- 감시·추궁으로 느껴지는 문장을 피한다.
- 리포트의 아이·날짜·사건 정보가 서로 섞이지 않도록 한다.

### 9.10 대화 문맥 보정

- 모델: `gemini-3.5-flash`
- STT 오인식 문장을 자연스럽게 보정한다.
- 원문의 의미와 아이의 의도를 임의로 바꾸지 않는다.
- 보정 불확실성이 높으면 원문을 과도하게 수정하지 않는다.
- raw와 corrected 데이터의 기존 저장 계약을 유지한다.

### 9.11 일일·주간 리포트

- 모델: `gemini-3.6-flash`
- 기존 필수 JSON 필드 유지
- 아이 ID·리포트 날짜·수집 구간 혼선 금지
- 다른 아이의 데이터 혼합 금지
- 원문 비공개 유지
- 데이터가 부족할 때 사실을 추정하거나 생성하지 않는다.
- 일일·주간 리포트 생성 경로를 각각 독립 검증한다.

### 9.12 Supabase 배치 리포트

- 모델: `gemini-3.5-flash`
- Supabase 배치는 실행 경로일 뿐 독립적인 리포트 모델 정책으로 확장하지 않는다.
- 기존 인증·수집·보정·생성 순서를 유지한다.
- Next.js 호출과 Supabase 호출의 프롬프트·스키마 결과가 충돌하지 않도록 한다.
- Edge Function의 REST 호출이 있다면 `global` 위치와 올바른 Vertex AI URL을 사용한다.
- 실제 서비스 계정 비밀정보를 코드 또는 로그에 출력하지 않는다.

---

## 10. 관리자 페이지 변경

관리자 페이지에서 다음 항목을 신규 매핑과 일치시킨다.

- 현재 텍스트 모델 표시
- 현재 Live 모델 표시
- 텍스트 Health Check
- Live Health Check
- 모델별 응답 상태
- 호출 지연시간
- 오류 메시지
- 실제 `modelVersion`
- 토큰 사용량
- 비용 계산에 사용하는 모델 단가 식별자
- 로그의 모델명
- 테스트 버튼의 대상 모델

텍스트 Health Check와 Live Health Check를 분리한다.

텍스트 Health Check가 성공했다고 Live도 정상으로 표시하거나, Live만 성공했는데 전체 LLM이 정상으로 표시하지 않는다.

관리자 화면의 하드코딩된 기존 모델명도 모두 변경한다.

---

## 11. 환경변수 및 롤백

기능별 역할 환경변수를 도입하거나 기존 환경변수 체계를 확장한다.

예시:

```env
LLM_MODEL_MISSION_LEAN=gemini-3.5-flash-lite
LLM_MODEL_MISSION_LEAN_FALLBACK=gemini-3.5-flash
LLM_MODEL_MISSION_REACTION=gemini-3.5-flash-lite
LLM_MODEL_MISSION_REACTION_FALLBACK=gemini-3.5-flash
LLM_MODEL_MISSION_GENERAL=gemini-3.5-flash
LLM_MODEL_CHILD_CLASSIFICATION=gemini-3.5-flash
LLM_MODEL_PARENT_K_CHAT=gemini-3.5-flash-lite
LLM_MODEL_CONTEXT_CORRECTION=gemini-3.5-flash
LLM_MODEL_DAILY_REPORT=gemini-3.6-flash
LLM_MODEL_WEEKLY_REPORT=gemini-3.6-flash
LLM_MODEL_BATCH_REPORT=gemini-3.5-flash
LLM_MODEL_LIVE=gemini-live-2.5-flash-native-audio
```

실제 환경변수 이름은 기존 프로젝트 명명 규칙을 따른다.

요구사항:

- 코드 기본값과 Dev 환경변수 값이 동일해야 한다.
- 환경변수 누락 시 조용히 잘못된 모델을 사용하지 않는다.
- 시작 시 유효하지 않은 모델 매핑을 검증한다.
- 롤백 시 중앙 환경변수만 변경해 기존 모델로 복구할 수 있어야 한다.
- 클라이언트 공개 환경변수에 내부 모델 설정과 비밀정보를 넣지 않는다.

---

## 12. 보안 요구사항

- 서비스 계정 JSON 평문 하드코딩 금지
- API 키·토큰·비밀번호 로그 출력 금지
- 임시 파일로 서비스 계정 키 저장 금지
- 기존 Vercel·Supabase·Cloud Run Secret 사용
- 런타임에만 비밀정보 로드
- 로그에서는 인증정보 마스킹
- 실제 아이·부모 대화 원문을 테스트 로그에 출력하지 않음
- 비민감 fixture만 사용
- 테스트 파일과 로그가 Git에 포함되지 않도록 확인

---

## 13. 테스트 및 검증

### 정적 검증

- TypeScript 타입 검사
- ESLint
- Production build가 아닌 Dev build 검증
- 모델 ID 하드코딩 잔여 검색
- 기존 Gemini 2.x 모델 ID 잔여 검색
- 구형 SDK 호출 위치 검색
- 직접 REST URL 검색
- 관리자 UI 하드코딩 검색
- Supabase Edge Function 모델 문자열 검색

### 모델 직접 호출

각 모델에 대해 Dev 서비스 계정으로 실제 Vertex AI 호출을 수행한다.

- HTTP 상태
- 실제 `modelVersion`
- 응답 텍스트
- `finishReason`
- 입력 토큰
- 출력 토큰
- Thinking 토큰
- 총 지연시간
- 구조화 JSON 파싱 여부

### 기능별 Dev 검증

다음 기능을 실제 Dev 경로에서 검증한다.

1. Premium 실시간 음성 연결
2. 미션 Lean 정상 응답
3. 미션 Lean Lite 실패 후 Flash 폴백
4. Reaction 정상 응답
5. Reaction Lite 실패 후 Flash 폴백
6. 미션 시작 메모리 인사
7. 자유대화 메모리 회상
8. 부모 메모리 질의
9. 일반 미션 응답
10. 유효성·안전성·유형 분류
11. 부모-K 대화
12. 부모 질문 생성
13. 문맥 보정
14. 일일 리포트 생성
15. 주간 리포트 생성
16. Supabase 배치 처리
17. 관리자 텍스트 Health Check
18. 관리자 Live Health Check

### 폴백 검증

- Lite timeout
- HTTP 429
- HTTP 5xx
- 빈 응답
- JSON 파싱 실패

각 조건에서 Flash가 정확히 1회 호출되는지 확인한다.

추가 확인:

- 중복 응답 없음
- 중복 저장 없음
- 중복 과금 가능 호출 없음
- 무한 재시도 없음
- Flash까지 실패했을 때 기존 사용자 오류 UX 유지

---

## 14. 대표 시나리오 검증

### 아이 시점

- 짧지만 관련 있는 답변이 무효 처리되지 않는다.
- 케이의 반응이 지나치게 길지 않다.
- 이전 기억을 부자연스럽거나 부담스럽게 언급하지 않는다.
- 아이가 하지 않은 말을 기억처럼 말하지 않는다.
- 대화 속도와 자연스러움이 기존보다 악화되지 않는다.

### 부모 시점

- 부모-K 응답이 아이의 말을 임의로 단정하지 않는다.
- 원문을 공개하지 않는다.
- 대화 조언이 추궁형·감시형 문장이 되지 않는다.
- 일일·주간 리포트가 기존 화면에서 정상 표시된다.
- 다른 아이의 정보가 섞이지 않는다.

### 운영 시점

- 관리자 화면의 모델명이 실제 호출 모델과 일치한다.
- Health Check가 실제 기능 경로의 상태를 반영한다.
- Supabase 배치와 Next.js 경로에서 모델 매핑이 다르지 않다.
- 오류 발생 시 모델·기능·폴백 여부를 구분할 수 있다.

---

## 15. 완료 조건

다음 조건을 모두 충족해야 작업 완료로 판정한다.

- 확정 모델 매핑 전체 적용
- 중앙 Model Router 적용
- 기존 모델 하드코딩 제거
- Lean·Reaction 폴백 정확히 1회 구현
- 텍스트와 Live 호출 경로 분리 유지
- 모델별 Thinking·출력·JSON 설정 적용
- 관리자 모델 표시·Health Check 수정
- Supabase 배치 모델 적용
- 타입 검사 PASS
- 빌드 PASS
- 단위 테스트 PASS
- 18개 기능별 Dev 검증 PASS
- 일일·주간 리포트 JSON 계약 PASS
- 미션 질문 순환 및 유효 답변 정책 PASS
- 중복 저장·중복 응답 없음
- 비밀정보 노출 없음
- 환경변수 기반 롤백 가능
- Production 미변경 확인

BLOCKED·HIGH·MEDIUM 이슈가 남아 있으면 완료 처리하지 않는다.

---

## 16. 작업 결과 보고 형식

작업 완료 후 다음 형식으로 보고한다.

### 변경 파일

| 파일 | 변경 내용 | 적용 모델 | 위험도 |
|---|---|---|---|

### 모델 매핑 결과

| 기능 | 기존 모델 | 신규 모델 | 폴백 | 검증 결과 |
|---|---|---|---|---|

### 테스트 결과

| 시나리오 | HTTP 상태 | modelVersion | 지연시간 | 토큰 | 폴백 | 결과 |
|---|---:|---|---:|---:|---|---|

### 품질 검증

- 아이 짧은 답변 유효성:
- 미션 질문 순환:
- Lean 응답:
- Reaction:
- 메모리 인사:
- 자유대화 회상:
- 부모-K:
- 문맥 보정:
- 일일 리포트:
- 주간 리포트:
- Supabase 배치:
- 텍스트 Health Check:
- Live Health Check:

### 잔여 이슈

- BLOCKED:
- HIGH:
- MEDIUM:
- LOW:

### 최종 판정

- Dev 적용 상태:
- Production 변경 여부:
- 롤백 가능 여부:
- Production 승격 가능 여부:

Production 승격은 별도 승인 전까지 진행하지 않는다.