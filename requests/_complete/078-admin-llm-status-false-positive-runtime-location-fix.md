# Request: 관리자 LLM 사용 현황 False-Positive 오류 제거 및 실제 런타임 기준 상태 판정 교정

## 0. 배경

Production 관리자 `LLM 사용 현황` 화면에서 등록 기능 18개 중 정상 4개, 오류 14개로 표시되고 있다.

Antigravity 읽기 전용 감사 결과, 이 14건은 실제 서비스 장애가 아니라 **관리자 상태 판정 로직의 잘못된 리전 기대값 비교로 발생한 False-Positive**임이 확인되었다.

핵심 원인은 다음과 같다.

1. Vercel Node.js의 실제 Vertex AI 클라이언트는 `GOOGLE_CLOUD_LOCATION`이 없을 경우 `global`을 사용하며 정상 동작 중이다.
2. 관리자 화면은 `us-central1`을 기대 리전처럼 비교하여 `global`을 오류로 판단한다.
3. Supabase Edge와 Cloud Run Live는 각각 `us-central1`을 사용한다.
4. STT/TTS는 Vertex AI 리전 개념이 아니라 Google Cloud의 Global REST API를 사용한다.
5. Embedding은 실행 위치에 따라 Vercel에서는 `global`, Supabase Edge에서는 `us-central1`을 사용한다.
6. 따라서 이번 작업에서는 실제 런타임 리전을 강제로 변경하지 않고, **관리자 상태 수집·판정·표시 로직을 실제 런타임과 일치시키는 것**이 목적이다.

---

## 1. 절대 변경하지 않을 것

이번 작업에서 아래 런타임 설정은 임의 변경하지 않는다.

```text
Vercel Vertex AI text/embedding runtime → global
Supabase Edge Vertex AI → us-central1
Cloud Run Live → us-central1
STT → Global REST API
TTS → Global REST API
```

특히 아래 작업 금지:

- Vercel `global`을 오류라는 이유로 `us-central1`로 강제 변경
- `app/api/_lib/ai.ts`의 runtime 동작을 단순 UI 오류 해결 목적으로 변경
- Cloud Run Live 리전 변경
- Supabase Edge 리전 변경
- STT/TTS API 변경
- 실제 모델 ID 변경

---

## 2. 관리자 상태 판정 원칙 변경

현재처럼:

```text
expectedRegion === actualRegion
```

문자열 비교로 오류를 판단하지 않는다.

새 상태 판정은 아래 기준을 사용한다.

### 정상

다음이 모두 충족되면 정상:

```text
실제 모델 ID가 유효
필수 인증 설정 존재
실제 runtime/provider 설정이 유효
해당 플랫폼에서 사용하는 location이 허용된 값
필요한 호출부가 존재
```

### 경고

서비스는 정상 동작 가능하지만 운영상 확인이 필요한 경우:

```text
환경별 location이 서로 다름
fallback 사용 중
권장 설정과 실제 설정이 다르지만 정상 지원 범위
```

### 오류

다음과 같은 실제 장애 가능성이 있는 경우만:

```text
필수 모델 ID 없음
필수 API Key/SA credential 없음
지원되지 않는 location
모델 설정 자체가 비어 있음
호출부가 존재하지 않음
실제 클라이언트 생성 실패가 확인됨
```

---

## 3. 플랫폼별 Location 판정 규칙

### 3.1 Vercel Node.js

실제 생성 로직:

```text
process.env[...] || "global"
```

따라서:

```text
global = 정상
```

으로 판정한다.

관리자에서 `global`을 `us-central1` 불일치 오류로 표시하지 않는다.

표시:

```text
Runtime: Vercel Node
Vertex Location: global
상태: 정상
```

### 3.2 Supabase Edge

실제 생성 로직:

```text
Deno.env.get("GOOGLE_CLOUD_LOCATION") || "us-central1"
```

표시:

```text
Runtime: Supabase Edge / Deno
Vertex Location: us-central1
상태: 정상
```

### 3.3 Cloud Run Live

실제 생성 로직:

```text
process.env.GOOGLE_CLOUD_LOCATION || "us-central1"
```

표시:

```text
Runtime: Cloud Run
Vertex Location: us-central1
상태: 정상
```

### 3.4 STT

실제:

```text
GCP Speech-to-Text REST
speech.googleapis.com
GCP_STT_API_KEY
```

표시:

```text
Runtime/API: GCP Speech REST
Endpoint: Global REST API
Vertex Location: 해당 없음
상태: 정상
```

STT에 `us-central1/global` Vertex 비교를 적용하지 않는다.

### 3.5 TTS

실제:

```text
GCP Text-to-Speech REST
texttospeech.googleapis.com
GCP_TTS_API_KEY
```

표시:

```text
Runtime/API: GCP TTS REST
Endpoint: Global REST API
Vertex Location: 해당 없음
상태: 정상
```

TTS에 Vertex location 검증을 적용하지 않는다.

### 3.6 Embedding

실제 `gemini-embedding-001`은 2개 runtime에서 호출된다.

Vercel:

```text
lib/memory/vectorRetrieval.ts
location = global
```

Supabase Edge:

```text
supabase/functions/_shared/batch.ts
location = us-central1
```

관리자 한 행에서 두 runtime을 모두 표시한다.

예:

```text
LLM Wiki 벡터 검색
gemini-embedding-001

Runtime
- Vercel Node → global
- Supabase Edge → us-central1

상태: 정상
```

---

## 4. `lib/admin/llmStatus.ts` 수정

현재 문제:

```text
process.env.GOOGLE_CLOUD_LOCATION
```

만 읽거나 기대 리전과 단순 비교하여 실제 SDK의 effective location과 불일치한다.

수정 방향:

- 각 기능별 runtime/provider를 기준으로 effective location 계산
- Vercel Node는 실제 factory와 동일하게 `env || global`
- Supabase Edge는 실제 코드와 동일하게 `env || us-central1`
- Cloud Run Live는 실제 relay와 동일하게 `env || us-central1`
- STT/TTS는 Vertex location 검증 제외
- Embedding은 복수 runtime location 표시

가능하면 runtime metadata를 공통 registry로 정의하여 UI가 실제 코드와 다시 어긋나지 않도록 한다.

---

## 5. STT/TTS 상태 검증 수정

현재 `lib/admin/llmStatus.ts`에서 STT/TTS 인증 상태를 `GCP_VERTEX_SA_KEY_JSON` 중심으로 검사하는 로직이 있다면 제거/수정한다.

실제 기준:

```text
STT → GCP_STT_API_KEY
TTS → GCP_TTS_API_KEY
```

Secret 값은 절대 화면에 출력하지 않는다.

---

## 6. 관리자 테이블 컬럼 정리

현재 `호출부 / 리전` 같이 의미가 섞인 컬럼을 분리한다.

권장 최종 컬럼:

| 기능명 | 실제 적용 모델 | Fallback | 환경변수 | Runtime / SDK | 호출부 | Endpoint / Location | 상태 |
|---|---|---|---|---|---|---|---|

`Endpoint / Location` 표시 예:

```text
global
us-central1
Global REST API
Vercel: global / Edge: us-central1
```

---

## 7. 상태 메시지 수정

기존 잘못된 메시지:

```text
실제 리전이 us-central1이 아니라 global입니다.
```

이 문구는 Vercel의 정상 global runtime에서 더 이상 표시하지 않는다.

정상 예:

```text
정상
```

경고가 필요한 경우에만:

```text
Runtime별 Location이 다릅니다.
Vercel: global / Edge: us-central1
```

단, 둘 다 정상 지원 범위라면 상태 자체는 `정상`으로 유지한다.

---

## 8. 상단 요약 수정

현재:

```text
등록 기능 수: 18개
정상: 4개
오류: 14개
```

수정 후 실제 runtime 기준으로 다시 계산한다.

요약:

```text
환경: Production
등록 기능 수: 18개
정상: N개
경고: N개
오류: N개
마지막 확인: ...
```

False-Positive 14건이 제거되어야 한다.

---

## 9. 실제 18개 행 유지

이전 075 Request에서 확정한 18개 운영 행은 유지한다.

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
18. LLM Wiki 벡터 검색 (Embedding)

Health Check는 독립 행으로 추가하지 않는다.

Fallback은 독립 행으로 추가하지 않는다.

---

## 10. 실제 Runtime 기준 요약

### Vercel Node

effective location:

```text
global
```

정상.

### Supabase Edge

effective location:

```text
us-central1
```

정상.

### Cloud Run

Premium Live:

```text
us-central1
```

정상.

### REST Global APIs

```text
STT
TTS
```

Vertex location 검증 대상 아님.

---

## 11. 이전 감사와 현재 결과 충돌 정리

관리자 코드/문서에서 `us-central1`을 모든 Vertex 호출의 고정 기대값처럼 표현하지 않는다.

실제 현재 architecture:

```text
Vercel → global
Supabase Edge → us-central1
Cloud Run Live → us-central1
```

이 구조 자체는 현재 정상 동작 중이다.

관리자 화면은 **설계 기대값이 아니라 실제 runtime effective value를 보여주는 화면**이어야 한다.

---

## 12. 변경 대상 파일

Antigravity 감사 기준 최소:

```text
lib/admin/llmStatus.ts
app/admin/(dashboard)/page.tsx
```

필요 시 metadata registry:

```text
lib/admin/aiRuntimeRegistry.ts
```

기존 runtime 코드는 이번 Request에서 원칙적으로 변경하지 않는다.

---

## 13. 테스트 요구사항

### Vercel global

Vercel Node 기반 Gemini 기능:

```text
actual/effective location = global
```

일 때 상태는 `정상`.

### Supabase Edge

```text
effective location = us-central1
```

정상.

### Cloud Run Live

```text
effective location = us-central1
```

정상.

### STT

```text
GCP_STT_API_KEY 설정
Global REST API
```

정상.

### TTS

```text
GCP_TTS_API_KEY 설정
Global REST API
```

정상.

### Embedding

한 행에서:

```text
Vercel Node: global
Supabase Edge: us-central1
```

표시.

상태 정상.

---

## 14. False-Positive 회귀 테스트

기존 오류 문구:

```text
실제 리전이 us-central1이 아니라 global입니다.
```

Production 관리자 페이지에서 정상 Vercel 기능에 대해 0건이어야 한다.

---

## 15. 완료 조건

- Production False-Positive 리전 오류 제거
- Vercel `global` 정상 처리
- Supabase Edge `us-central1` 정상 처리
- Cloud Run Live `us-central1` 정상 처리
- STT/TTS Vertex region 검증 제거
- STT `GCP_STT_API_KEY` 기준 검증
- TTS `GCP_TTS_API_KEY` 기준 검증
- Embedding 복수 runtime location 표시
- `Endpoint / Location` 컬럼으로 의미 명확화
- 실제 runtime 변경 0건
- 등록 기능 18개 유지
- Health 독립 행 0개
- fallback 독립 행 0개
- TypeScript 오류 0건
- Build 성공
- Dev E2E PASS
- Production 배포 완료
- Production 관리자 화면 스모크 테스트 PASS
- 실제 서비스 기능 회귀 오류 0건

---

## 16. 완료 보고 형식

1. 기존 오류 14건 원인
2. 변경한 상태 판정 기준
3. Vercel effective location
4. Supabase Edge effective location
5. Cloud Run Live effective location
6. STT/TTS 판정 변경
7. Embedding 복수 runtime 표현
8. 수정한 파일
9. runtime 코드 변경 여부
10. 변경 전 정상/오류 count
11. 변경 후 정상/경고/오류 count
12. False-Positive 문구 0건 검증
13. TypeScript/Build
14. Dev E2E
15. Production 배포 커밋
16. Production Deployment ID / READY
17. Production 스모크 테스트
18. 남은 실제 경고/오류

---

## 17. 보안 및 제한

- 실제 Runtime Location을 UI 오류 해결 목적으로 변경 금지
- Vercel global → us-central1 강제 전환 금지
- Cloud Run/Supabase 환경변수 변경 금지
- API Key/SA JSON/Token 실제값 출력 금지
- Production Secret 제거 테스트 금지
- 실제 모델 ID 변경 금지
- 실제 정상 기능을 단순 문자열 비교로 오류 처리 금지
