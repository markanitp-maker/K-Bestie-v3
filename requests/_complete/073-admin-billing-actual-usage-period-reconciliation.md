# Request: 관리자 비용·사용량 대시보드 실측 기준 재설계 및 기간 필터 확장

## 0. 배경

관리자 `나갈 돈·비용 상세` 화면과 Google Cloud Billing의 이번 달 금액이 일치하지 않아 Antigravity로 코드·DB·BigQuery 실측 데이터를 읽기 전용 감사했다.

감사 결과 핵심 원인은 다음과 같다.

1. GCP Billing Export 자체는 정상 연동되고 있다.
2. 관리자 분류 로직 `lib/billing/gcpBilling.ts::classifyBillingRow()`가 Vertex AI SKU를 모델 버전 문자열 `"3.1"`, `"2.5"`로 하드코딩 분류하고 있다.
3. Gemini 3.5 / 3.6 계열과 Vertex Embeddings가 `other`로 빠져 미분류 비용이 과도하게 커졌다.
4. `Agent Platform Model Garden`은 실제 약 1만원대 비용이 발생했지만 관리자에서는 Gemini 3.1 SKU 약 12원만 표시돼 크게 왜곡됐다.
5. 현재 기간 API는 `today | 7d | month`만 지원하고 `지난달`, `사용자 지정 기간`이 없다.
6. 서버 날짜 계산이 KST를 명시적으로 보장하지 않아 Vercel UTC 환경에서 날짜 경계가 틀릴 위험이 있다.
7. 현재 GCP 비용은 Cloud Billing BigQuery Export를 사용하지만, Supabase/Vercel 비용은 실제 Billing API가 아니라 월 고정비 상수를 일할 계산한 추정값이다.
8. 내부 추정 사용량은 `usage_events` 기반이며 STT/TTS는 신뢰도가 높고 LLM/Live는 부분 비교 가능하다. Embeddings, Cloud Run, Cloud Storage는 앱 내부 usage 기록이 없다.

이번 작업은 단순히 숫자 하나를 맞추는 수정이 아니라, 관리자 비용 화면을 **실제 청구 데이터와 실제 사용량을 함께 확인하는 운영 대시보드**로 재설계하는 작업이다.

## 1. 작업 목표

관리자가 아래 질문에 한 화면에서 답할 수 있어야 한다.

- 선택한 기간에 GCP에서 실제로 얼마의 비용이 발생했는가?
- 크레딧/할인 적용 후 실제 청구 예상액은 얼마인가?
- 어떤 서비스와 SKU에서 비용이 발생했는가?
- 내부 서비스 사용량(STT, TTS, Gemini, Live 등)은 얼마나 발생했는가?
- 내부 추정 비용과 GCP 실제 비용의 차이는 어느 영역에서 발생했는가?
- 미분류 비용이 있다면 정확히 어떤 Service/SKU인가?
- 오늘 / 최근 7일 / 이번 달 / 지난달 / 임의 기간의 비용을 동일 기준으로 볼 수 있는가?

## 2. 소스 오브 트루스 확정

### 2.1 GCP 비용

GCP 비용의 source of truth는 기존과 동일하게 **Google Cloud Billing BigQuery Export**로 한다.

사용 필드:

```text
service.description
service.id
sku.description
sku.id
project.id
project.name
usage_start_time
usage_end_time
usage.amount
usage.unit
cost
credits
```

기본 계산:

```text
Gross Cost = SUM(cost)
Credit = SUM(credits.amount)
Net Cost = Gross Cost + Credit
```

Credit는 음수값이다.

### 2.2 외부 고정비

Supabase / Vercel은 실제 Billing API 연동이 아니므로 GCP actual과 섞어서 `실제 비용`으로 표현하지 않는다.

명칭을 아래처럼 구분한다.

```text
GCP 실제 발생 원가
GCP 크레딧·할인
GCP 청구 예상액
외부 인프라 고정비 추정
전체 예상 현금지출
```

Supabase/Vercel은 `pricing.ts`의 월 고정비 기준 일할 계산값이며 반드시 `추정`이라고 표시한다.

## 3. 현재 분류 오류 수정

현재 코드의 버전 하드코딩 분류를 제거한다.

현재 문제 코드 개념:

```ts
if (s.includes("vertex")) {
  if (sku.includes("3.1")) return "agent_platform_model_garden";
  if (sku.includes("2.5")) return "gemini_agent_platform";
  return "other";
}
```

이 방식은 새 모델 버전이 나올 때마다 미분류가 발생하므로 폐기한다.

### 3.1 새 분류 원칙

모델 버전이 아니라 **서비스 종류 + SKU family** 기준으로 분류한다.

권장 상위 카테고리:

```text
Vertex AI - Gemini
Vertex AI - Embeddings
Speech-to-Text
Text-to-Speech
Live / Realtime Audio
Cloud Run
Cloud Storage
Cloud Logging
BigQuery
Artifact Registry
Secret Manager
기타/미분류
```

### Vertex AI - Gemini

다음과 같이 Gemini text/input/output/prediction 계열은 모델 버전에 관계없이 동일 상위 카테고리로 분류한다.

예:

```text
Gemini 2.5 ...
Gemini 3.1 ...
Gemini 3.5 ...
Gemini 3.5 Flash Lite ...
Gemini 3.6 ...
향후 Gemini 4.x ...
```

모델명/버전은 하위 상세 정보로 보존한다.

### Vertex AI - Embeddings

다음 계열은 독립 분류한다.

```text
Large Text Embedding Model - Predictions
Vertex Embeddings
Text Embedding
Embedding Model
```

실제 SKU description을 기준으로 matcher를 작성한다.

### 3.2 UI 명칭

Google Cloud Console의 제품 그룹명은 변경될 수 있으므로 관리자 상위 명칭을 특정 마케팅 명칭에 과도하게 종속시키지 않는다.

기존:

```text
Gemini on Agent Platform
Agent Platform Model Garden
```

권장:

```text
Vertex AI - Gemini
Vertex AI - Embeddings
```

필요하면 상세 행에서 실제 GCP Service/SKU 명칭을 그대로 표시한다.

## 4. 현재 누락 항목 반영

감사 시점 현재 `other`로 빠진 항목:

```text
Gemini 3.5 Flash Global Text Output - Predictions
Gemini 3.5 Flash Global Text Input - Predictions
Gemini 3.6 Flash Global Text Output - Predictions
Gemini 3.6 Flash Global Text Input - Predictions
Gemini 3.5 Flash Lite Global Text Input - Predictions
Gemini 3.5 Flash Lite Global Text Output - Predictions
Large Text Embedding Model - Predictions
Cloud Logging
BigQuery
Artifact Registry
Secret Manager
```

Gemini 3.5/3.6는 `Vertex AI - Gemini`로,
Large Text Embedding은 `Vertex AI - Embeddings`로 분류한다.

Cloud Logging / BigQuery / Artifact Registry / Secret Manager는 각각 독립 인프라 카테고리로 표시한다.

## 5. 미분류 비용 정책

미분류 자체를 숨기지 않는다.

새 SKU가 등장해 matcher가 아직 대응하지 못한 경우 `기타/미분류`에 남겨야 한다.

상세 모달 또는 확장 행에서 아래를 확인 가능하게 한다.

```text
Service Description
Service ID
SKU Description
SKU ID
Gross
Credit
Net
Usage Amount
Usage Unit
```

경고 기준 권장:

```text
미분류 Gross > 전체 GCP Gross의 1%
또는
미분류 Gross >= 100원
```

0원 SKU는 미분류 건수에 포함하더라도 비용 경고 비율 계산에는 영향을 주지 않는다.

## 6. Google Cloud Console과의 비교 기준

Google Cloud Console과 관리자 금액이 같은 시점에도 즉시 1원 단위로 완전히 일치한다고 가정하지 않는다.

Cloud Billing Export 반영 지연을 고려해 화면 상단에 아래를 표시한다.

```text
비용 기준: Google Cloud Billing Export
마지막 Billing 데이터: YYYY-MM-DD HH:mm KST
조회 기간: YYYY-MM-DD HH:mm ~ YYYY-MM-DD HH:mm KST
```

`마지막 Billing 데이터`는 실제 Billing Export 최신 `usage_end_time` 또는 데이터 최신 시각 기준으로 표시한다.

단순 API 조회 시각을 `마지막 동기화`로 표시하지 않는다.

## 7. Production 프로젝트 범위

수정 전에 현재 BigQuery SQL이 `project.id`를 제한하는지 다시 확인한다.

기본 정책:

- 관리자 Production 화면의 GCP 비용은 **내친구 케이 Production 프로젝트** 비용만 계산
- Production GCP project ID는 서버 환경설정 또는 allowlist에서 사용
- Dev 또는 다른 프로젝트 비용이 Production 화면에 섞이지 않게 함
- Billing Account에 프로젝트가 하나뿐이어도 명시적 project filter를 적용
- 실제 project ID를 추측해 하드코딩하지 않음

상단 표시:

```text
환경: Production
GCP 프로젝트: Production
```

## 8. 기간 필터 확장

관리자 비용 화면 상단:

```text
[오늘] [최근 7일] [이번 달] [지난달] [직접 기간]
```

기본 선택:

```text
이번 달
```

### 오늘

```text
오늘 00:00:00.000 KST ~ 현재 시각
```

### 최근 7일

```text
오늘 포함 최근 7개 캘린더 날짜
6일 전 00:00:00.000 KST ~ 현재 시각
```

### 이번 달

```text
이번 달 1일 00:00:00.000 KST ~ 현재 시각
```

### 지난달

```text
지난달 1일 00:00:00.000 KST
~
지난달 마지막 날 23:59:59.999 KST
```

### 직접 기간

```text
시작일 [YYYY-MM-DD]
종료일 [YYYY-MM-DD]
[조회]
```

검증:

- 시작일/종료일 필수
- 시작일 <= 종료일
- 종료일이 오늘이면 현재 시각까지
- 종료일이 과거면 23:59:59.999까지

## 9. KST 날짜 경계 통일

런타임 로컬 타임존에 의존하는 `setHours()` 기반 로직을 제거하고 모든 기간 계산을 명시적으로 `Asia/Seoul` 기준으로 처리한다.

동일 KST 범위를 아래에 적용:

```text
BigQuery Billing Export
usage_events
chat_sessions
기타 비용/사용량 집계
CSV Export
XLSX Export
```

예:

```text
2026-08-01 00:00:00 KST
= 2026-07-31 15:00:00 UTC
```

공통 range utility를 만든다.

## 10. API 변경

현재:

```text
period=today | 7d | month
```

변경:

```text
period=today | 7d | month | last_month | custom
```

custom:

```text
startDate=YYYY-MM-DD
endDate=YYYY-MM-DD
```

대상:

```text
app/api/admin/usage-overview/route.ts
app/api/admin/usage-overview/export/route.ts
```

잘못된 값은 400 반환.

응답에는 실제 적용 range와 timezone을 포함한다.

## 11. 상단 KPI 카드 재설계

권장 KPI:

1. `GCP 실제 발생 원가` = Gross
2. `GCP 크레딧·할인` = Credit
3. `GCP 청구 예상액` = Net
4. `외부 인프라 고정비 추정` = Supabase + Vercel 기간 일할
5. `전체 예상 현금지출` = GCP Net + 외부 인프라 고정비 추정
6. `내부 AI 원가 추정` = usage_events 기반

내부 추정은 실제 Billing과 구분되는 문구로 표시한다.

## 12. 내부 추정 오차 카드 수정

현재 내부 추정에는 모든 GCP 인프라와 Embeddings 등이 포함되지 않는데 전체 GCP Gross와 바로 비교하여 과소추정 경고를 만들고 있다.

변경:

- 내부 추정과 GCP 실제 비용 비교는 **비교 가능한 카테고리만** 대상으로 계산
- 예: STT, TTS, Gemini LLM, Live Audio
- Embeddings는 usage_events 계측 전까지 제외
- Cloud Run, Storage, Logging, BigQuery 등도 제외

카드명:

```text
내부 추정 정확도
```

추가:

```text
비교 가능 비용 커버리지: 72%
```

커버리지가 낮으면 강한 과소추정 경고를 표시하지 않는다.

## 13. 비용 상세 표

기본 표:

| 카테고리 | 사용량 | Gross | Credit | Net | 내부 추정 | 오차 | 전체 비중 |
|---|---:|---:|---:|---:|---:|---:|---:|

상위 카테고리:

```text
Vertex AI - Gemini
Vertex AI - Embeddings
Speech-to-Text
Text-to-Speech
Live / Realtime Audio
Cloud Run
Cloud Storage
Cloud Logging
BigQuery
Artifact Registry
Secret Manager
기타/미분류
Supabase (외부 고정비 추정)
Vercel (외부 고정비 추정)
```

GCP 항목과 외부 고정비는 시각적으로 구분한다.

## 14. Service/SKU 상세 드릴다운

각 GCP 카테고리를 클릭하면 하위 Service/SKU를 펼쳐 표시한다.

컬럼:

```text
Service
SKU
사용량
단위
Gross
Credit
Net
비중
```

향후 신규 모델 SKU가 등장해도 운영자가 실제 비용을 확인할 수 있어야 한다.

## 15. 실제 사용량 섹션

### 앱 내부 계측 사용량

`usage_events` 기준:

```text
STT: 총 초 / 총 분
TTS: 총 문자 수
LLM: input token / output token
Live Audio: 총 사용 시간
```

가능하면 모델별 breakdown 표시.

### GCP Billing usage

Billing Export에 `usage.amount`, `usage.unit`가 있는 서비스는 별도 표시.

앱 내부 사용량과 GCP 과금 사용량의 단위가 다르면 억지로 합치지 말고 아래처럼 분리한다.

```text
앱 내부 사용량
GCP 과금 사용량
```

## 16. Embeddings usage 계측

감사 결과 Embeddings 비용은 발생하지만 `usage_events` 기록이 없다.

실제 embeddings 호출부를 찾아 성공 호출에 usage 이벤트를 추가한다.

최소 필드:

```text
kind = embedding
model
request_count
input_count 또는 SDK에서 확정 가능한 사용량
est_cost_krw (신뢰 가능한 단가가 있을 때만)
occurred_at
environment
```

금지:

- 임베딩 원문 텍스트 저장
- 실패 요청을 성공 usage로 기록
- 추측 token 수 저장
- 재시도 중복 기록

## 17. 외부 고정비 기간 계산

Supabase/Vercel 월 고정비는 기간 필터에 맞춰 일할 계산한다.

월별 실제 일수 사용:

```text
8월 = 31일
2월 = 28/29일
```

custom 기간이 여러 달이면 월별로 분리 계산 후 합산.

항상 `추정` 표시 유지.

## 18. CSV / XLSX 동기화

화면 기간과 Export 기간은 반드시 동일해야 한다.

Export 메타:

```text
환경
조회 기간
Timezone
Billing 기준
마지막 Billing 데이터 시각
Production project scope
```

포함 데이터:

```text
카테고리 요약
Service/SKU 상세
Gross/Credit/Net
사용량/단위
내부 usage 요약
미분류 상세
```

## 19. UI 상단 구조

```text
나갈 돈 · 비용 상세

[오늘] [최근 7일] [이번 달] [지난달] [직접 기간]

직접 기간:
[2026-07-15] ~ [2026-08-05] [조회]

환경: Production
비용 기준: Google Cloud Billing Export
마지막 Billing 데이터: 2026-08-07 22:xx KST

[CSV] [XLSX]
```

## 20. 회귀 테스트 기준

Antigravity 감사 시점 BigQuery Gross 총액은 약 `14,230.69원`이었다.

대표 항목:

```text
Speech-to-Text: 약 1,982.50원
Gemini 2.5 계열: 약 1,338.89원
Gemini 3.5 / 3.6 계열: 약 10,894원대
Vertex Embeddings: 약 1.69원
Cloud Storage: 약 0.83원
```

주의: Billing Export 데이터는 계속 증가할 수 있으므로 원 금액을 테스트에 하드코딩하지 않는다.

동일 시점/동일 기간에서 아래를 검증한다.

```text
SUM(category.gross) == total.gross
SUM(category.credit) == total.credit
SUM(category.net) == total.net
```

## 21. 테스트 요구사항

### 분류 테스트

최소 fixture:

```text
Gemini 2.5
Gemini 3.1
Gemini 3.5
Gemini 3.5 Flash Lite
Gemini 3.6
미래 버전 형태 Gemini 4.x
Large Text Embedding
Speech Recognition
Cloud Storage
Cloud Logging
BigQuery
Artifact Registry
Secret Manager
알 수 없는 신규 SKU
```

알 수 없는 SKU는 `기타/미분류` 유지.

### 기간 테스트

```text
today
7d
month
last_month
custom
```

월말/월초:

```text
7/31 → 8/1
8/31 → 9/1
12/31 → 1/1
```

### custom

- 같은 날짜
- 7일
- 월 경계
- 여러 달
- 종료일 오늘
- 시작일 > 종료일 오류

### Export 정합성

```text
화면 합계 == CSV 합계 == XLSX 합계
```

## 22. Production QA

Production에서는 읽기 전용 비용 조회만 검증한다.

- 오늘
- 최근 7일
- 이번 달
- 지난달
- custom 3개 기간
- CSV
- XLSX
- Service/SKU drilldown
- 미분류 상세
- Billing 최신 데이터 시각

GCP Console과 비교 시 **동일 프로젝트, 동일 기간, 동일 데이터 반영 시점** 기준으로 비교한다.

## 23. 수정 대상 예상 파일

감사 결과 기준 최소 대상:

```text
lib/billing/gcpBilling.ts
app/api/admin/usage-overview/route.ts
app/api/admin/usage-overview/export/route.ts
app/admin/(dashboard)/page.tsx
lib/plan/pricing.ts
```

추가 권장:

```text
lib/billing/periodRange.ts
lib/billing/classification.ts
```

Embeddings usage 계측을 위해 실제 embedding 호출부 추가 수정 가능.

## 24. 완료 조건

- Gemini 3.5/3.6 미분류 제거
- 미래 Gemini 버전에 버전 하드코딩 의존하지 않음
- Vertex Embeddings 독립 분류
- Cloud Logging/BigQuery/Artifact Registry/Secret Manager 식별
- GCP category 합계와 Billing Export total 일치
- Production GCP project 범위 명시
- 오늘/최근7일/이번달/지난달/custom 지원
- 모든 기간 KST 기준
- 카드/표/CSV/XLSX 동일 기간
- Billing Export 최신 데이터 시각 표시
- GCP Gross/Credit/Net 분리
- Supabase/Vercel `추정 고정비` 구분
- 내부 추정 정확도 비교를 비교 가능한 항목으로 제한
- 실제 사용량 섹션 구현
- Embeddings usage 최소 계측
- TypeScript 오류 0건
- Build 성공
- Dev E2E PASS
- Production 배포 완료
- Production 읽기 전용 스모크 테스트 PASS
- 비밀정보 노출 0건

## 25. 완료 보고 형식

1. 기존 불일치 원인 요약
2. 기존/신규 비용 분류 방식
3. 최종 카테고리 목록
4. Production project filter 방식
5. KST 기간 계산 방식
6. today/7d/month/last_month/custom 구현 결과
7. Billing Export 최신 데이터 표시 방식
8. GCP Gross/Credit/Net 결과
9. 외부 인프라 고정비 계산 방식
10. 내부 추정 정확도 비교 기준
11. 실제 사용량 섹션 구현 결과
12. Embeddings usage 계측 결과
13. 동일 기간 category 합계 vs total 검증
14. 미분류 비율 before → after
15. CSV/XLSX 정합성
16. 수정·추가 파일
17. TypeScript/Build/E2E 결과
18. Production 배포 커밋
19. Production Deployment ID / READY 상태
20. Production 스모크 테스트 결과
21. 남은 미분류 SKU 또는 위험사항

## 26. 보안 및 작업 제한

- Billing Account ID 전체값 UI/로그 출력 금지
- GCP Service Account JSON 출력 금지
- Service Role Key 출력 금지
- API Key/Token 출력 금지
- 실제 GCP Billing 데이터 수정 금지
- Production 사용자 데이터 수정 금지
- 가격 단가를 추측해 임의 추가 금지
- GCP Console 제품명만 보고 분류하지 말고 실제 Billing Export Service/SKU를 근거로 구현
- 기존 pending migration 전체 일괄 적용 금지
