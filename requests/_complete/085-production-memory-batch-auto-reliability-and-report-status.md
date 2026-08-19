# REQUEST #085 — Production Memory Batch 자동화 안정화 + Daily Report 상태 정합성 복구

- 상태: TODO
- 유형: P0 Production 장애 재발 방지 / 자동 배치 안정화
- 우선순위: CRITICAL
- 대상: Memory Batch / V3 Batch Worker / Supabase Edge Function / Pipeline Jobs / Admin Reporting
- 핵심 방향: 단발성 Secret 재설정이 아니라 Memory Batch 실행 경로를 단일화하여 매일 자동 완료되도록 구조적 재발 원인을 제거하고, 실패 백로그를 idempotent 복구하며, 관리자 Report 상태 표시를 실제 canonical 상태와 일치시킨다.
- 비범위: Memory V3 데이터 모델 재설계 / embedding model 변경 / Context Correction 재설계 / Daily Report 생성 로직 재작성 / 관계엔진 / Mission / Free Chat

---

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과

Production에서 매일 사람의 수동 실행 없이 아래 체인이 자동으로 완료되어야 한다.

```text
Collection
→ Context Correction
→ Memory Batch
→ memory_facts
→ memory_evidence
→ gemini-embedding-001
→ Daily Report
```

특히 Memory Batch는 더 이상:

```text
Vercel Worker
→ Supabase Edge Function
→ 별도 BATCH_SECRET 인증
```

이라는 이중 실행 경로 때문에 단독 실패하지 않아야 한다.

정상 완료 기준:

- Scheduler가 자동 실행된다.
- Memory Batch job이 자동으로 claim된다.
- corrected input이 정상 로드된다.
- Memory fact가 생성된다.
- Evidence가 생성된다.
- `gemini-embedding-001` embedding이 생성된다.
- `pipeline_jobs.memory_batch.status = completed`가 된다.
- Daily Report는 Memory 성공/실패와 독립 계약을 유지한다.
- 관리자 화면의 Memory/Report 상태가 최신 canonical job 상태와 일치한다.
- 동일 child/date/version 재실행 시 duplicate fact/evidence/embedding/report = 0이다.
- 2026-08-16 실패 대상 7건이 정상 복구된다.
- 다음 자동 실행에서도 수동 개입 없이 동일 체인이 정상 완료된다.

### 대표님 테스트 정상 프로세스

대표님은 Production 관리자 화면에서 다음만 확인하면 된다.

1. Memory Batch가 `완료`로 표시되는지 확인
2. Report가 실제 생성된 경우 `대기`가 아니라 `완료`로 표시되는지 확인
3. 다음날 자동 배치 후 다시 관리자 화면 확인
4. 수동 실행 버튼을 누르지 않았는데도 Memory Batch와 Report가 자동 완료되어 있으면 PASS

대표님이 직접 Secret, Cron, DB Job을 조작할 필요가 없어야 한다.

---

## 1. 문제 현황

2026-08-17 01:00 KST Production 자동 실행에서 다수 child의 Memory Batch가 동시에 실패했다.

Production Read-only RCA로 다음이 확정됐다.

### Memory 장애

실패 대상 7명:

- TestA
- 고나연
- 박서아
- 안예원
- 안서아
- 안서현
- 김지호

공통 상태:

```text
same execution_id
same worker
same execution time
same error
HTTP 401 Unauthorized
```

실제 실행 경로:

```text
Scheduler
→ Vercel Batch Worker
→ claim_memory_batch_jobs_v3
→ corrected input load
→ Supabase Edge Function /functions/v1/memory-batch
→ checkAuth()
→ HTTP 401 Unauthorized
```

7명 모두:

```text
Memory LLM generation 미도달
memory_facts = 0
memory_evidence = 0
memory_embeddings = 0
```

### 확정 ROOT CAUSE

```text
Vercel Memory Batch Worker가 Supabase Edge Function을 HTTP 호출하면서
Vercel의 BATCH_SECRET/CRON_SECRET 계열 인증값과
Supabase Edge Function의 Deno.env BATCH_SECRET이 불일치하여
Edge Function checkAuth에서 401 발생
```

### 구조적 재발 원인

Context Correction과 Daily Report는 Vercel batch worker 런타임에서 직접 처리되지만 Memory Batch만 별도로 Supabase Edge Function으로 다시 HTTP 위임한다.

즉 Memory만 다음 이중 의존성을 가진다.

```text
Vercel Runtime
  ↓
Bearer Secret
  ↓
Supabase Edge Runtime
  ↓
BATCH_SECRET 검증
```

이 구조는 두 환경의 Secret 동기화가 어긋나면 Memory만 단독 실패할 수 있다.

이번 Request의 목적은 단순히 Secret 값을 다시 맞추는 것이 아니다.

---

## 2. 목표

### 목표 A — Memory Batch 실행 경로 단일화

Memory Batch를 Context Correction / Daily Report와 같은 Vercel V3 batch worker 실행 경로로 통합한다.

목표 구조:

```text
Scheduler
   ↓
Vercel V3 Batch Worker
   ├─ Collection
   ├─ Context Correction
   ├─ Memory Batch
   │    ├─ Memory LLM
   │    ├─ memory_facts
   │    ├─ memory_evidence
   │    └─ gemini-embedding-001
   └─ Daily Report
```

Memory Batch를 처리하기 위해 다시 Supabase Edge Function으로 HTTP 호출하고 별도의 Secret 검증을 통과해야 하는 구조를 제거한다.

### 목표 B — 기존 Memory V3 계약 유지

실행 위치만 통합하고 Memory V3 데이터 모델/품질 계약은 변경하지 않는다.

유지:

- Memory fact 생성
- Evidence 관계
- embedding
- `gemini-embedding-001`
- child/date/version idempotency
- 기존 Retrieval V3
- legacy fallback 정책
- duplicate 방지

### 목표 C — 실패 백로그 정상 복구

2026-08-16 business date 기준 실패한 7건을 수정된 경로로 재처리한다.

기존 데이터 삭제/재생성 없이 idempotent하게 복구한다.

### 목표 D — 관리자 Report 상태 정합성

실제 `daily_reports` row가 이미 생성 완료됐는데 신규 execution의 pending item 때문에 관리자 화면이 `대기`로 표시되는 문제를 수정한다.

Report 생성 로직 자체를 변경하지 않는다.

관리자 상태 집계가 실제 최신 canonical job 상태와 일치하게 한다.

---

## 3. 절대 경계

```text
Memory 생성 장애
≠ Daily Report 생성 장애

pipeline_execution_items
≠ canonical pipeline_jobs

Secret 재설정
≠ 구조적 재발 방지

관리자 표시 상태
≠ 실제 Report 존재 여부
```

이번 장애의 해결 기준은 `Secret을 다시 맞췄다`가 아니다.

정확한 완료 기준:

```text
자동 Scheduler
→ Memory claim
→ Memory 생성
→ Evidence
→ Embedding
→ completed
→ Daily Report 상태 정합성
→ 다음 자동 실행 재확인
```

---

## 4. 구현 전 필수 Audit

코드 변경 전에 현재 Production/Repository의 실제 실행 구조를 확인한다.

필수 확인:

1. 현재 `/api/batch/v3/worker` stage orchestration
2. `lib/batch/memoryV3.ts`
3. Supabase `functions/v1/memory-batch`
4. `_shared/batch.ts`의 Memory generation 구현
5. `generateMemoryFacts`
6. `generateMemorySummaries`
7. Memory fact/evidence/embedding insert path
8. `claim_memory_batch_jobs_v3` 및 execution-scoped claim RPC
9. complete/fail Memory Batch RPC
10. retry / idempotency 계약
11. current scheduler topology
12. current Vercel/Supabase runtime dependency
13. current `BATCH_SECRET` 사용 위치 전수
14. admin reporting status aggregation
15. `pipeline_execution_items`와 `pipeline_jobs` 관계

중요:

- Edge Function 코드를 무작정 복사해서 새 구현을 만들지 않는다.
- 이미 공유 가능한 서버 모듈이 있으면 추출/재사용한다.
- Memory 생성 로직의 Source of Truth를 2개 만들지 않는다.

---

## 5. Memory Batch 런타임 통합

### 현재

```text
lib/batch/memoryV3.ts
→ HTTP fetch
→ ${SUPABASE_URL}/functions/v1/memory-batch
→ Authorization Bearer
→ Edge checkAuth
→ generateMemory...
```

### 변경 목표

```text
lib/batch/memoryV3.ts
→ 동일 서버 런타임의 공유 Memory processing module 직접 호출
→ generateMemory...
→ DB persist
```

또는 Repository의 현재 구조상 동등한 단일-runtime 구조.

요구사항:

- Memory Batch가 Supabase Edge Function HTTP 인증 성공 여부에 의존하지 않음
- Vercel→Supabase Edge HTTP hop 제거
- Vercel↔Supabase `BATCH_SECRET` 동기화가 Memory 성공 조건이 아니게 함
- 기존 Memory 데이터 처리 결과는 동일하게 유지
- 기존 Edge Function이 다른 운영 경로에서 사용 중이면 바로 삭제하지 않고 사용처 확인 후 deprecate
- 미사용 확인 전 destructive 삭제 금지

---

## 6. 공유 Memory Processing Module

Memory 생성 핵심 로직이 Edge Function 안에만 있다면, 런타임 중립적인 공유 모듈로 추출하는 방향을 우선 검토한다.

개념:

```text
processMemoryBatch(input)
  ↓
load corrected data
  ↓
generate facts
  ↓
persist facts
  ↓
persist evidence
  ↓
generate embedding
  ↓
persist embedding
  ↓
return result
```

Vercel batch worker에서 이를 직접 호출한다.

금지:

- Vercel용 Memory 생성 구현과 Edge용 Memory 생성 구현을 각각 별도 유지
- prompt/model/normalization 로직 복제
- 서로 다른 idempotency 규칙 생성

가능한 경우 하나의 core function을 공유한다.

---

## 7. Memory Model / Embedding

Embedding:

```text
gemini-embedding-001
```

이번 Request에서 변경 금지:

- embedding model
- vector dimension 정책
- embedding store
- retrieval ranking
- Memory fact schema
- Evidence schema

Memory generation model 역시 이번 장애 해결과 무관하면 변경하지 않는다.

---

## 8. Pipeline Job 계약

Memory Batch job lifecycle:

```text
pending
→ claimed
→ processing
→ completed
```

반드시 확인:

- `attempt_count`
- `claimed_at`
- `claimed_by`
- `execution_id`
- `last_error_code`
- `last_error_summary`
- completion outcome

동일 child/date/version을 재처리해도 duplicate를 만들지 않는다.

---

## 9. Execution ID 정합성

이번 RCA에서 Daily Report 관리자 표시 문제와 관련해 execution mismatch가 확인됐다.

확인:

```text
pipeline_jobs.execution_id
pipeline_execution_items.execution_id
```

새 execution이 생성될 때 canonical job이 이전 execution에 남아 있고 신규 execution item만 pending이 되는 상태가 가능한지 확인한다.

Memory 수정 과정에서 execution model 전체를 불필요하게 재설계하지 않는다.

현재 코드상 stale execution item이 최신 상태처럼 선택되는 문제가 있으면 관리자 집계 쪽에서 최소 수정한다.

---

## 10. Daily Report 상태 정합성

확정 사실:

```text
2026-08-16 daily_reports = 7건 정상 존재
```

하지만 관리자 화면은 `대기`를 표시했다.

원인:

```text
신규 execution pipeline_execution_items = pending
canonical report job = 이전 execution에 연결
관리자 aggregate가 pending 신규 item을 대표 상태로 사용
```

요구사항:

- Daily Report 생성 로직 자체는 변경하지 않는다.
- Report를 Memory 성공 prerequisite로 묶지 않는다.
- 실제 report row + canonical job state + current relevant execution을 기준으로 상태를 집계한다.
- 오래된/stale pending execution item이 완료된 실제 report보다 우선하지 않게 한다.
- 이미 완료된 report가 있으면 잘못 `대기`로 표시하지 않는다.

---

## 11. 2026-08-16 실패 대상 복구

구조 수정 및 Target QA 통과 후 Production에서 다음 대상 7건을 복구한다.

- TestA
- 고나연
- 박서아
- 안예원
- 안서아
- 안서현
- 김지호

원칙:

- 기존 failed job/data 삭제 금지
- 기존 corrected data 사용
- 기존 pipeline enqueue/retry/reconcile 계약 사용
- logical job identity 유지
- 직접 `memory_facts` 수동 INSERT 금지
- 실제 Memory pipeline 경로로 재처리

---

## 12. 복구 완료 검증

| child | corrected | memory job | facts | evidence | embeddings | report | duplicate |
|---|---:|---|---:|---:|---:|---|---:|

필수:

```text
memory job = completed
facts/evidence/embedding 정상
duplicate = 0
```

Facts가 0인 경우 실제 input상 0이 정상인지 outcome으로 증명한다.

---

## 13. 다음 자동 실행 검증

수동 복구 성공만으로 완료 처리하지 않는다.

Production 배포 이후 다음 자동 Scheduler 실행 1회를 실제 관찰한다.

```text
scheduler 자동 실행
→ job 생성
→ claim
→ Memory processing
→ completed
→ facts/evidence/embedding
→ Daily Report 정상 상태
```

관리자 수동 실행/API 수동 호출 없이 성공해야 한다.

---

## 14. 자동 장애 감지

과도한 새 모니터링 플랫폼은 만들지 않는다.

다만 기존 telemetry/logging에서 다음은 추적 가능해야 한다.

- Memory auth/error
- claim 0 anomaly
- pending aging
- permanent error
- embedding failure

---

## 15. Secret 정책

구조 수정 후 Memory Batch 성공 여부가 Supabase Edge `BATCH_SECRET`과의 동기화에 의존하지 않아야 한다.

- Secret 값 로그 출력 금지
- 기존 Edge Function의 다른 사용처가 있으면 Secret 즉시 제거 금지
- 완료조건을 “Secret 값 일치”로 정의하지 않음

---

## 16. 실패 처리

Memory generation 오류 시:

- job error 정확히 기록
- 최초 실패 지점 추적 가능
- 실패 job을 completed로 표시 금지
- partial fact/evidence/embedding 상태에서 retry idempotency 보장

Daily Report는 기존 독립 계약 유지.

---

## 17. 데이터 보존

금지:

- Production Memory fact 삭제 후 재생성
- daily_reports 삭제 후 재생성
- raw/corrected data 삭제
- child/date 전체 초기화
- destructive migration

forward-only / idempotent 원칙 유지.

---

## 18. 관리자 UI

관리자 화면 전체 redesign 금지.

수정 범위:

```text
Memory Batch 실제 최신 상태
Daily Report 실제 최신 상태
```

표시 정합성만 수정한다.

---

## 19. 금지

- BATCH_SECRET 값만 맞추고 완료 처리
- Edge HTTP 의존성을 그대로 둔 채 종료
- 새로운 Memory System 생성
- Memory 데이터 이중 저장
- Pipeline 전체 재작성
- 새로운 scheduler 플랫폼 구축
- Production delete/recreate
- 실패 대상 수동 fact INSERT
- 기존 report 삭제
- unrelated refactor
- Mission/Free Chat/Relationship/Play 변경
- Collection 정책 변경
- Context Correction/Daily Report prompt 변경

---

## 20. 모호성 처리

Edge Function이 다른 기능에서도 사용 중이면 바로 제거하지 않는다.

다음만 보고:

1. 실제 사용처
2. 제거 시 영향
3. Memory V3 Worker만 직접 실행으로 전환 가능한지
4. Edge Function deprecation을 별도 Request로 분리해야 하는지

구조적 재발 방지는 계속 진행한다.

---

## 21. QA

### QA 1 — Direct Memory processing
Edge HTTP fetch 없이 Vercel Memory worker가 processing core를 직접 호출.

### QA 2 — Auth independence
Supabase Edge `BATCH_SECRET` 불일치가 신규 Vercel 직접 경로를 깨지 않음을 Dev/unit/integration으로 검증.

### QA 3 — Fact 생성
corrected input → facts/evidence/embedding 정상 생성.

### QA 4 — Empty normal case
fact 0이 정상인 입력은 정상 outcome.

### QA 5 — Idempotency
동일 child/date/version 재실행 시 duplicate facts/evidence/embeddings = 0.

### QA 6 — Partial retry
부분 실패 후 retry에도 duplicate 없이 정상 완료.

### QA 7 — Pipeline lifecycle
`pending → claimed → completed` 확인.

### QA 8 — Failed lifecycle
실패 시 last_error_code/summary 정확히 기록.

### QA 9 — Report independence
Memory 실패 simulation에서도 corrected data가 있으면 Report 독립 처리.

### QA 10 — Admin stale execution
실제 report 완료 상태가 stale pending execution 때문에 `대기`로 오표시되지 않음.

### QA 11 — Backlog recovery
2026-08-16 실패 대상 7건 전원 복구.

### QA 12 — Automatic scheduler
Production 다음 자동 실행에서 수동 개입 없이 Memory Batch completed.

---

## 22. Production 적용 순서

1. Repository Audit
2. 최소 구조 수정 구현
3. Unit/Target QA
4. 독립 정적 리뷰
5. Dev 검증
6. Production 코드 배포
7. 2026-08-16 실패 대상 7건 idempotent 복구
8. DB 결과 검증
9. Admin 상태 검증
10. 다음 자동 Scheduler 실행 관찰
11. 자동 실행 PASS 후 완료

---

## 23. 완료 조건

- Memory Batch가 Supabase Edge Function HTTP hop 없이 Vercel V3 Batch Worker에서 직접 처리
- Vercel↔Supabase Edge BATCH_SECRET 동기화가 Memory 성공 필수조건이 아님
- Memory core logic Source of Truth 이중화 없음
- 기존 Memory V3 schema 유지
- `gemini-embedding-001` 유지
- facts/evidence/embedding 정상
- duplicate 0
- Memory job claim/completed 정상
- retry idempotent
- 2026-08-16 실패 7건 복구
- 기존 데이터 삭제 없음
- Daily Report 독립 계약 유지
- stale execution 때문에 `대기` 오표시 없음
- 다음 Production 자동 Scheduler 1회에서 수동 개입 없이 정상 완료

하나라도 충족되지 않으면 완료 처리하지 않는다.

---

## 24. 완료 보고

1. MEMORY ROOT CAUSE
2. STRUCTURAL ROOT CAUSE
3. 변경 파일
4. Memory Batch 실행 경로 Before / After
5. Edge Function 사용 여부 및 남은 사용처
6. pipeline job lifecycle 검증
7. 2026-08-16 실패 7건 복구 결과
8. facts / evidence / embeddings 결과
9. duplicate 검증
10. Daily Report 실제 상태
11. 관리자 상태 표시 수정 결과
12. 다음 자동 Scheduler 실제 실행 결과
13. QA 결과
14. Production 배포 SHA
15. 남은 위험이 있을 경우만 해당 내용

최종 판정:

```text
PASS
```

또는

```text
BLOCKED
```

---

## 25. 최종 원칙

이번 Request는 “오늘 Memory Batch를 한 번 성공시키는 작업”이 아니다.

목표는:

```text
대표가 매일 관리자에서 실패 여부를 확인하고
수동으로 Memory Batch를 실행해야 하는 운영을 끝내는 것
```

이다.

단발성 Secret 수정이나 수동 재실행을 완료로 인정하지 않는다.

Production에서 매일:

```text
자동 Collection
→ 자동 Correction
→ 자동 Memory Batch
→ 자동 Daily Report
```

가 사람 개입 없이 정상 수행되는 것을 실제 다음 자동 실행으로 증명한 뒤 종료한다.
