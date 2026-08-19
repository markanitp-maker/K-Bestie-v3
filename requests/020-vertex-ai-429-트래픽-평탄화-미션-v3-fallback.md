# Vertex AI 429 대응 — 배치 트래픽 평탄화 및 Mission V3 다단 Fallback

파일명: `NNN-vertex-ai-429-트래픽-평탄화-미션-v3-fallback.md`

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과

현재 Production에서 발생한 Vertex AI `429 RESOURCE_EXHAUSTED`에 대해 단순 Quota 상향이 아니라 다음 두 가지 구조적 대응을 적용한다.

1. 심야 Batch LLM 트래픽을 시간적으로 분산하고 동시 호출 수를 제한한다.
2. Mission V3의 `gemini-3.5-flash`가 429 또는 일시 장애로 실패할 경우 `gemini-3.5-flash-lite`를 정확히 1회 호출한 뒤, 그것도 실패하면 기존 019의 deterministic next-question fallback으로 즉시 진행한다.

완료 후 다음 상태가 되어야 한다.

```text
실시간 Mission V3
gemini-3.5-flash
    ↓ 429 / timeout / 일시적 5xx
gemini-3.5-flash-lite 1회
    ↓ 실패
019 deterministic next-question
```

```text
심야 Batch

Collection
→ Context Correction
→ Memory Batch
→ Daily Report

각 단계의 시작 시간을 분리하고
동시 LLM 호출 수를 제한하여
실시간 사용자 요청과의 Burst 경합을 줄인다.
```

이번 작업에서 Priority PayGo 또는 Provisioned Throughput을 실제 활성화하지 않는다.

### 대표님 테스트 정상 프로세스

1. Dev에서 정상 Mission V3를 실행한다.
2. 정상 상황에서는 기존 `gemini-3.5-flash` 응답이 사용된다.
3. 테스트 전용 429 주입 시 `gemini-3.5-flash-lite`가 정확히 1회 호출된다.
4. Lite가 성공하면 자연스러운 응답과 다음 질문이 정상 출력된다.
5. Flash와 Lite 모두 실패하도록 테스트하면 기존 019 deterministic next-question이 즉시 출력된다.
6. 어떤 경우에도 `"응, 듣고 있어. 더 얘기해줄래?"`와 같은 동일 답변 재요구 문구가 출력되지 않는다.
7. 별 게이지·미션 진행 상태·답변 저장이 중복되거나 유실되지 않는다.
8. Batch를 Dev 테스트 데이터로 실행하면 Context Correction → Memory → Daily Report 순서가 정상 완료된다.
9. Batch 처리 중에도 불필요한 동시 Vertex AI 호출 Burst가 발생하지 않는다.
10. 기존 부모 리포트 알림 시각 전에 일일 리포트 생성이 완료된다.
11. Dev PASS 후 Production 반영 및 QA 계정으로 동일 검증한다.

### PASS 기준

- Mission V3 Flash → Lite → deterministic fallback 체인 PASS
- Lite fallback 최대 1회
- 무한 retry 0건
- 중복 응답 0건
- 중복 DB 저장 0건
- 별 게이지 회귀 0건
- 금지 재질문 문구 0건
- Batch 단계 간 LLM 트래픽 겹침 최소화
- Batch worker concurrency 제한 적용
- Batch 처리 누락 0건
- 리포트 생성 누락 0건
- 기존 리포트 알림 일정 영향 없음
- BLOCKED 0건
- HIGH 0건
- MEDIUM 0건

---

## 1. 상태 / 우선순위 / 대상

- 상태: 구현 요청
- 우선순위: 긴급 / HIGH
- 대상 프로젝트: K-Bestie-v3
- 개발 주체: Claude Code
- 사전 조사: Antigravity READ-ONLY 진단 완료
- 적용 대상:
  - Dev
  - Dev QA 완료 후 Production
- 주요 대상:
  - Mission V3
  - Context Correction
  - Memory Batch
  - Daily Report
  - Reconcile
- 제외 대상:
  - Premium Gemini Live 구조
  - STT
  - TTS
  - LLM Wiki Embedding
  - Priority PayGo 실제 활성화
  - Provisioned Throughput 구매
  - GCP Quota 상향 신청

---

## 2. 목표

### 2-1. 문제

Production에서 Vertex AI `429 RESOURCE_EXHAUSTED`가 실제 발생했다.

확인된 특징:

- 일반 텍스트 요청은 이미 `location=global`
- Standard PayGo / DSQ 환경
- 고정 Quota Ceiling에 도달했다는 증거는 확인되지 않음
- 실시간 Mission 요청과 Batch LLM 호출이 같은 프로젝트·Standard PayGo 경로를 공유
- Mission V3 한 턴에서 복수 LLM 호출이 발생
- 429 이후 retry가 추가 요청 Burst를 발생시킴
- 기존에는 이 과정이 12~27초 수준의 사용자 지연과 비정상 fallback 문구로 이어졌음
- 019 핫픽스로 UX 악화는 상당 부분 차단했지만 429 자체와 Burst 구조는 남아 있음

### 2-2. 최종 구조

```text
[사용자 대면]

아이 발화
 ↓
gemini-3.5-flash
 ↓ 성공
정상 응답

 ↓ 429 / timeout / transient 5xx

gemini-3.5-flash-lite
 ↓ 성공
Lite 응답

 ↓ 실패

019 Deterministic Next Question
```

```text
[백그라운드]

Collection
 ↓
Context Correction
 ↓
Memory Batch
 ↓
Daily Report
 ↓
Reconcile / 후속 정리
```

각 Batch 작업이 동시에 대량의 Vertex AI 요청을 발생시키지 않도록 시작 시각과 concurrency를 분리한다.

---

## 3. 요구사항

### 3-1. 019 핫픽스 유지

기존 `019 미션 LLM Fallback 긴급 핫픽스`의 동작을 절대 제거하거나 되돌리지 않는다.

반드시 유지:

- 장시간 retry 대기 제거
- 동일 답변 재요구 금지
- LLM 생성 실패 시 deterministic next-question
- 미션 진행 계속
- 별 게이지와 자연어 응답 생성 실패의 결합 최소화
- 구조화된 429/5xx/TIMEOUT 로그

기존 019 관련 E2E 테스트를 삭제하거나 완화하지 않는다.

---

### 3-2. Mission V3 Flash → Lite Fallback 추가

Mission V3의 기본 응답 모델은 기존과 동일하다.

```text
Primary
gemini-3.5-flash
```

Primary가 다음의 일시적인 오류로 실패할 때만:

```text
Fallback
gemini-3.5-flash-lite
```

를 정확히 1회 호출한다.

#### fallback 허용 조건

- HTTP 429 / `RESOURCE_EXHAUSTED`
- 네트워크 timeout
- HTTP 500
- HTTP 502
- HTTP 503
- HTTP 504
- SDK가 transient/retryable로 명확히 분류한 일시 오류

#### fallback 금지 조건

- HTTP 400
- HTTP 401
- HTTP 403
- HTTP 404
- invalid request
- 잘못된 schema
- 인증 실패
- 권한 실패
- 안전 정책 차단
- 사용자 입력 검증 실패
- 개발 오류
- 이미 Lite fallback을 실행한 요청

---

### 3-3. Model Router 역할 추가

`lib/llm/modelRouter.ts`에 Mission V3 fallback 역할을 명시한다.

예:

```ts
missionGeneral: "gemini-3.5-flash",
missionGeneralFallback: "gemini-3.5-flash-lite",
```

실제 프로젝트 naming convention을 따르되 모델 매핑은 위와 동일해야 한다.

환경변수 override가 필요한 기존 구조라면 동일 구조를 적용한다.

예:

```text
LLM_MODEL_MISSION_GENERAL
LLM_MODEL_MISSION_GENERAL_FALLBACK
```

환경변수가 없을 경우 위 확정 기본값을 사용한다.

---

### 3-4. fallback 실행 위치

Mission V3 자연어 생성의 실제 Source of Truth 호출부에서 fallback을 구현한다.

사전 조사상 주요 후보:

```text
lib/k-conversation/responseGenerator.ts
```

단순 API Route 바깥에서 재시도하지 말고, 실제 LLM 호출과 오류 분류가 이루어지는 공통 레이어에서 처리한다.

동일 기능이 여러 Route에서 중복 fallback되지 않도록 한다.

---

### 3-5. 최대 시도 횟수 제한

한 Mission V3 응답 생성에 대해:

```text
Flash 최대 1회 정상 호출
+
필요한 경우 Lite 최대 1회
+
Deterministic fallback
```

를 기본 원칙으로 한다.

019에서 남아 있는 retry 정책이 있다면 이번 fallback과 합쳐 전체 호출 횟수를 다시 계산하고, `429 → 동일 Flash 3회 → Lite`처럼 Burst를 재증폭하는 구조를 만들지 않는다.

429 상황에서는 빠른 실패를 우선한다.

---

### 3-6. timeout 정책

기존 019의 latency 개선을 훼손하지 않는다.

다음 원칙을 적용한다.

- Flash timeout과 Lite timeout을 각각 명시
- 두 모델을 합친 최대 대기시간에 상한 존재
- timeout 후 추가 sleep을 길게 넣지 않음
- deterministic fallback은 LLM 호출 없이 즉시 생성

Antigravity 보고의 `0.6~1.2초`를 고정 SLA로 사용하지 않는다.

실제 Dev 실측값을 기준으로 최종 timeout을 결정한다.

완료 보고에는 다음을 포함한다.

```text
Primary timeout:
Fallback timeout:
최대 총 LLM 대기 budget:
Dev p50:
Dev p95:
Dev max:
```

---

### 3-7. 별 게이지 / Goal 판정 보호

429가 발생해도 다음 데이터 계약이 깨지지 않아야 한다.

- 아이 답변 저장
- mission_progress
- mission_question_history
- answer_evidence
- Goal 판정 결과
- 별 게이지
- 현재 질문 index
- 다음 질문 결정

자연어 Response Generator 실패 때문에 이미 성공한 상태 업데이트가 취소되거나 중복 수행되면 안 된다.

Goal 판정 자체가 429로 실패하는 경우 현재 019 정책과 실제 fallback 경로를 확인하고 안전한 기존 동작을 유지한다.

이번 범위를 넘는 Goal 알고리즘 변경은 금지한다.

---

### 3-8. 중복 방지

Flash 실패 → Lite 성공 시:

- 아이 응답 저장 1회
- 케이 응답 저장 1회
- 다음 질문 전환 1회
- 별 게이지 반영 1회
- 이벤트 기록 1회

만 허용한다.

동일 `turn_id`, session ID 및 기존 idempotency 기준을 유지한다.

Flash의 늦은 응답이 Lite 또는 deterministic 응답 이후 도착해 사용자에게 추가 출력되지 않도록 abort/cancel 또는 결과 폐기 처리를 확인한다.

---

### 3-9. Batch 스케줄 분산

현재 사전 조사 기준:

```text
23:59 Collection Phase 2
00:10 Context Correction
00:20 Memory Batch
00:30 Daily Report
00:10 Reconcile
```

LLM Batch를 다음 방향으로 분리한다.

```text
00:00 전후 Collection
01:00 Context Correction
02:00 Memory Batch
03:00 Daily Report
```

Collection은 LLM을 사용하지 않는 경우 기존 정책과 충돌하지 않는 범위에서 유지 가능하다.

Reconcile은 실제 역할과 downstream 의존성을 재확인해 LLM 주요 Batch와 동시에 대량 Job을 생성하지 않는 시각으로 이동한다.

권장 후보:

```text
03:30 Reconcile
```

단, Reconcile이 특정 Batch 실패 복구를 더 일찍 수행해야 하는 현재 정책이 있다면 그 의존성을 우선하며 임의 변경하지 않는다.

---

### 3-10. Batch Concurrency 제한

현재 동시 child worker 수가 8 수준이라면 LLM 기반 Batch의 concurrency를 낮춘다.

대상:

- Context Correction
- Memory Batch
- Daily Report

기본 목표:

```text
Concurrency: 2~3
```

구현 시 하나의 값을 명시적으로 확정하고 설정화한다.

권장 기본값:

```text
3
```

단, Dev 부하 테스트에서 리포트 완료시간이 정책을 위반하면 2~4 범위에서 조정 가능하다.

---

### 3-11. Batch Throttle / Jitter

동시에 여러 worker가 같은 순간 Vertex AI 요청을 시작하지 않도록 job 또는 chunk 시작 사이에 짧은 throttle/jitter를 적용한다.

기본 목표:

```text
약 300~500ms
```

고정 500ms를 모든 코드에 복붙하지 않는다.

공통 helper 또는 기존 worker orchestration 구조에서 관리한다.

Throttle 때문에 전체 Batch가 부모 리포트 알림 시각을 넘기면 안 된다.

---

### 3-12. Batch Retry 정리

429가 발생했다고 같은 모델을 즉시 반복 호출하여 Burst를 키우지 않는다.

Batch는 실시간 요청과 달리 즉시 응답할 필요가 없으므로:

- exponential backoff
- bounded retry
- 다음 worker cycle 이관

중 기존 파이프라인에 가장 맞는 방식을 사용한다.

실시간 Mission retry와 Batch retry 정책을 동일하게 만들지 않는다.

---

### 3-13. 처리 순서 의존성 유지

다음 데이터 의존성을 깨뜨리지 않는다.

```text
Collection
→ Context Correction
→ Memory
→ Daily Report
```

앞 단계가 미완료인 child에 대해 다음 단계가 잘못 실행되지 않도록 기존 eligibility 조건을 유지한다.

시간만 분산하고 pipeline semantic은 변경하지 않는다.

---

### 3-14. 리포트 완료 정책 보호

일일 리포트는 기존 서비스 정책상 부모가 확인·알림을 받기 전에 생성 완료되어야 한다.

100명 수준의 테스트 시나리오를 포함하여 다음을 측정한다.

- Context Correction 완료 시각
- Memory 완료 시각
- Daily Report 완료 시각
- 실패 Job 수
- retry Job 수

기존 부모 리포트 알림 시각 이전에 충분한 안전 마진으로 완료되어야 한다.

알림 시각 자체는 이번 Request에서 변경하지 않는다.

---

### 3-15. Standard PayGo 유지

이번 변경에서는 기존 Standard PayGo를 유지한다.

변경 금지:

- Priority PayGo 실제 활성화
- Provisioned Throughput 구매
- Quota 상향 신청
- 별도 GCP 프로젝트 생성

현재 429가 DSQ shared-capacity 성격을 포함하므로 먼저 트래픽 구조를 개선하고 이후 운영 지표로 다음 단계를 판단한다.

---

### 3-16. 향후 Priority 적용을 막지 않는 구조

이번 작업에서 Priority PayGo를 켜지는 않는다.

다만 `createGenAIClient()` 또는 공통 LLM 호출 레이어를 변경할 경우 향후 다음처럼 트래픽 클래스를 구분할 수 있는 확장성을 훼손하지 않는다.

```text
interactive
batch
```

이번 Request 때문에 실제 billing mode나 Priority header를 넣을 필요는 없다.

YAGNI 원칙을 지키며 과도한 사전 구현은 금지한다.

---

### 3-17. 429 관측성

수정 이후 최소 다음 값을 구조화 로그로 확인할 수 있어야 한다.

```text
feature
model
fallbackModel
primaryResult
fallbackResult
errorCode
latencyMs
fallbackUsed
turnId / jobId
```

금지:

- 아이 실제 대화 원문 로그
- 부모 실제 질문 원문 로그
- 서비스 계정
- OAuth token
- API key
- Secret

---

## 4. 기존 구조 확인

구현 전 실제 현재 파일과 호출 흐름을 다시 확인하고 그 구조를 기준으로 수정한다.

사전 조사에서 확인된 주요 파일:

```text
app/api/_lib/ai.ts
lib/llm/modelRouter.ts
lib/k-conversation/responseGenerator.ts
lib/k-conversation/goalAssessor.ts
app/api/mission/v3/turn/route.ts

lib/batch/contextCorrectionV3.ts
lib/batch/memoryV3.ts 또는 실제 Memory Batch 구현 파일
lib/batch/dailyReportV3.ts
lib/batch/generateWeeklySummary.ts
Reconcile 실제 구현 파일

supabase pg_cron 설정
Vercel Cron 설정
```

### 현재 Source of Truth 확인

다음을 보고한다.

- Vertex client Source of Truth
- 모델 선택 Source of Truth
- Mission V3 응답 생성 Source of Truth
- Mission retry Source of Truth
- Batch concurrency Source of Truth
- pg_cron Source of Truth
- Reconcile schedule Source of Truth

동일 설정이 여러 파일에 중복되어 있으면 이번 범위 내에서 안전하게 단일화 가능한 부분만 정리한다.

---

## 5. 금지사항

- 019 핫픽스 롤백 금지
- 미션 질문 정책 변경 금지
- Goal 정의 변경 금지
- 별 지급 정책 변경 금지
- DB Schema 변경 금지
- 실제 아이·부모 데이터 삭제 금지
- Production에서 임의 부하 테스트 금지
- 무한 retry 금지
- 429에 동일 Flash 모델을 장시간 반복 호출 금지
- Flash→Lite→Flash 순환 금지
- Lite 실패 후 다른 신규 모델 추가 금지
- Priority PayGo 활성화 금지
- Provisioned Throughput 구매 금지
- Quota 상향 신청 금지
- global endpoint 변경 금지
- Live API location 변경 금지
- 부모 알림 시각 임의 변경 금지
- 근거 없는 성공률·무중단률·비용 절감률을 완료 보고에 사용 금지

---

## 6. 모호성 처리

구현 중 다음 사항이 기존 조사 결과와 다르면 임의로 결정하지 말고 현재 코드의 실제 Source of Truth를 우선한다.

- Batch 현재 스케줄
- Memory Batch 구현 파일
- Reconcile 의존성
- retry 횟수
- timeout
- concurrency 설정 위치
- 부모 리포트 알림 실제 시각

다만 변경 목적은 유지한다.

```text
실시간 요청 Burst 최소화
+
Batch LLM Burst 평탄화
+
Mission V3 429 사용자 영향 최소화
```

---

## 7. QA

### 7-1. Mission 정상 시나리오

- Flash 정상 성공
- Lite 미호출
- deterministic fallback 미호출
- 기존 응답 품질 유지
- 다음 질문 정상 진행
- 별 게이지 정상

PASS:

```text
fallbackUsed=false
응답 1회
저장 1회
```

---

### 7-2. Primary 429 → Lite 성공

테스트 전용 fault injection 또는 mock으로:

```text
gemini-3.5-flash → 429
gemini-3.5-flash-lite → 성공
```

검증:

- Lite 정확히 1회
- 자연어 응답 정상
- 다음 질문 정상
- deterministic 미사용
- 중복 저장 없음
- 별 게이지 정상

---

### 7-3. Primary 429 → Lite 429

```text
Flash → 429
Lite → 429
Deterministic → 성공
```

검증:

- 장시간 기다림 없음
- `"더 얘기해줄래?"` 계열 금지 문구 0건
- 다음 질문 정상
- DB 저장 정상
- 별 게이지 상태 보존
- retry loop 없음

---

### 7-4. Timeout

각각:

- Flash timeout
- Lite timeout

을 강제로 재현한다.

최대 전체 대기 budget을 초과하지 않는지 확인한다.

---

### 7-5. 400/401/403/404

해당 오류에서는 Lite fallback이 실행되지 않아야 한다.

PASS:

```text
fallback count = 0
```

---

### 7-6. 늦게 도착한 Primary 응답

Primary timeout 이후 Lite 또는 deterministic 응답이 이미 완료된 상태에서 Primary 결과가 늦게 도착해도:

- 사용자에게 출력되지 않음
- DB에 저장되지 않음
- 이벤트가 중복되지 않음

을 확인한다.

---

### 7-7. 별 게이지 회귀

최소 10개 대표 Mission turn으로 확인한다.

- 유효 답변
- 애매한 답변
- 무응답
- Flash 정상
- Flash 429 / Lite 성공
- Flash+Lite 실패

모든 경우 기존 별 게이지 정책과 일치해야 한다.

---

### 7-8. Batch 20 child Dev QA

Dev 테스트 계정 20개 또는 이에 준하는 비민감 fixture로:

```text
Collection
Context Correction
Memory
Daily Report
```

전체 pipeline을 검증한다.

확인:

- 동시 worker 수
- 호출 간격
- 총 처리시간
- 실패 Job
- retry Job
- duplicate Job
- 최종 리포트 생성

---

### 7-9. 100 child 용량 검증

실제 사용자 100명의 Production 데이터를 사용하지 않는다.

fixture 또는 안전한 Dev job으로 처리량을 측정하거나, 실측 가능한 단위 테스트 결과를 기반으로 계산한다.

확인:

- 기존 리포트 완료 정책 내 완료 가능 여부
- 부모 알림 이전 완료 여부
- concurrency 3이 충분한지

부족하면 2~4 사이에서 최소 조정한다.

---

### 7-10. Batch와 실시간 Mission 동시 QA

Dev에서 Batch를 실행하는 동안 Mission을 동시에 실행한다.

확인:

- Mission 응답 실패율
- p50
- p95
- max latency
- Batch 실패율
- 429 발생 수

AS-IS와 TO-BE를 동일 조건으로 비교한다.

근거 없이 “75% 개선”, “100% 무중단” 등으로 보고하지 않는다.

---

### 7-11. Cron 검증

변경 후 각 worker가 정확한 시간에 1회 실행되는지 확인한다.

- 중복 Cron 없음
- 기존 Cron 잔존 없음
- timezone 오류 없음
- KST ↔ UTC 변환 정확
- 다음 단계가 이전 단계보다 먼저 실행되지 않음

---

### 7-12. Production 배포 후 QA

Dev 전체 PASS 후 Production에 적용한다.

Production에서는:

- QA 계정으로 Mission 정상 호출
- 구조화 로그에서 Flash 모델 확인
- 안전한 fault injection 경로가 있는 경우에만 fallback 확인
- Production 실제 사용자에게 인위적 429를 발생시키지 않음
- 첫 Batch 주기 후 Job 처리량·429·지연 확인
- 리포트 생성 및 알림 정상 확인

---

## 8. 완료 조건

다음 조건을 모두 충족해야 완료 처리한다.

### Mission

- Flash Primary 정상
- Lite fallback 구현
- Lite 최대 1회
- deterministic fallback 유지
- 019 기능 전체 유지
- 금지 문구 0건
- 무한 retry 0건
- 중복 응답 0건
- 중복 저장 0건
- 별 게이지 회귀 0건

### Batch

- Context / Memory / Report 시작 시각 분산
- concurrency 명시적 제한
- throttle/jitter 적용
- dependency 유지
- Job 누락 0건
- 중복 Job 0건
- 기존 부모 리포트 알림 영향 없음

### 운영

- Standard PayGo 유지
- global 유지
- Priority PayGo 비활성
- PT 비활성
- Quota 변경 없음
- 429 로그 관측 가능
- Dev QA PASS
- Production QA PASS
- BLOCKED 0
- HIGH 0
- MEDIUM 0

---

## 9. 완료 보고 형식

### 9-1. 변경 파일

| 파일 | 변경 내용 | 영향 |
|---|---|---|

### 9-2. Mission Fallback

| 조건 | Flash | Lite | Deterministic | 총 지연 | 결과 |
|---|---|---|---|---:|---|

### 9-3. Batch

| Worker | 변경 전 시간 | 변경 후 시간 | 변경 전 concurrency | 변경 후 concurrency | 처리시간 | 결과 |
|---|---:|---:|---:|---:|---:|---|

### 9-4. 429

| 구분 | AS-IS | TO-BE |
|---|---:|---:|
| Mission 429 | | |
| Batch 429 | | |
| Retry 호출 수 | | |
| p50 | | |
| p95 | | |
| Max | | |

### 9-5. 회귀

- 별 게이지:
- 미션 진행:
- 질문 순환:
- 답변 저장:
- Context Correction:
- Memory:
- Daily Report:
- 부모 알림:

### 9-6. 잔여 이슈

- BLOCKED:
- HIGH:
- MEDIUM:
- LOW:

### 9-7. 최종 판정

- Dev:
- Production:
- Standard PayGo 유지 여부:
- Priority PayGo 활성화 여부:
- Quota 변경 여부:
- Production 안정화 판정: