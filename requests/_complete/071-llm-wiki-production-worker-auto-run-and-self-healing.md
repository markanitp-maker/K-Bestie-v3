# Request 071 — LLM Wiki Production Worker 자동 실행 및 Self-Healing 완성

## 0. 우선순위

P0 Production 장애.

현재 대표가 매일 아침 관리자 페이지에서 전날 LLM Wiki 파이프라인 실행 여부를 확인하고,
미처리된 아이를 직접 수동 실행하고 있다.

이번 Request의 완료 기준은 단순히 코드 구현이나 Dev QA가 아니다.

최종 완료 기준:

> Production에서 관리자 수동 실행 없이
> Collection → Correction → Memory → Daily Report가 매일 자동 완료되어야 한다.

---

# 1. 현재 확정된 Root Cause

2026-08-08 Production 실데이터 및 코드/RPC 조사 결과 Root Cause는 확정되었다.

```text
ROOT_CAUSE =
WORKER_CLAIM_FAILURE
+
DOWNSTREAM_RECONCILIATION_NOT_DEPLOYED
```

## 정상 동작 중인 부분

Production DB의 scheduler/pg_cron은 정상 동작한다.

### 17:55 KST

```text
enqueue_collection_jobs_v3(phase=1)
→ pipeline_jobs.collection_1 pending 생성
```

2026-08-08 실제:

```text
enqueued_count = 8
```

### 23:55 KST

```text
enqueue_collection_jobs_v3(phase=2)
→ pipeline_jobs.collection_2 pending 생성
```

2026-08-08 실제:

```text
enqueued_count = 10
```

night-only 사용자 candidate 버그를 수정한 migration도 Production에 적용되어 있다.

```text
20260808130000_fix_night_only_pipeline_candidates_and_reconcile.sql
```

Production RPC:

```text
enqueue_collection_jobs_v3
reconcile_pipeline_v3
```

정상 존재 확인 완료.

---

# 2. 실제 장애

문제는 Job 생성 이후다.

Production `pipeline_jobs`에는 Job이 정상적으로 생성되지만:

```text
status = pending
attempt_count = 0
claimed_at = null
```

상태로 계속 남아 있다.

즉:

```text
pg_cron
→ enqueue
→ pipeline_jobs.pending
→ ❌ 아무 Worker도 claim하지 않음
```

현재 Worker 실행은 사실상 관리자 수동 실행 경로에 의존하고 있다.

따라서:

```text
collection_1 pending
collection_2 pending
```

에서 멈추고,

후속:

```text
Context Correction
Memory Batch
Daily Report
```

Job은 생성조차 되지 않는다.

---

# 3. 2026-08-08 실제 피해 대상

Production에서 Source가 있었지만 Worker가 자동 실행되지 않은 대상:

```text
TestA
고나연
박서둥
박서아
안서아
안서현
윤도건
윤도원
이은수
황유빈
```

대표적인 상태:

```text
C1 pending
C2 pending
Correction 없음
Memory 없음
Report 없음
```

일부 night-only 아이는 C1 completed(0) 정규화 이후:

```text
C1 completed(0)
C2 pending
```

상태에서 멈춰 있다.

---

# 4. 확정 Architecture

LLM Wiki의 정상 Production Pipeline은 아래와 같다.

## 17:55 KST

```text
Collection Phase 1
→ mission_1 + free_chat_1
→ Raw V3 누적
```

이 시점에는 절대 실행하지 않는다:

```text
Context Correction
Memory Batch
Daily Report
```

---

## 23:55 KST

```text
Collection Phase 2
→ mission_2 + free_chat_2
→ 같은 child_id + business_date Raw에 추가
→ Raw Daily finalized
```

그 후 하루 한 번:

```text
Context Correction
→ corrected_daily_conversations_v3
→ corrected_daily_conversation_messages_v3
```

이후:

```text
Memory Batch
→ memory_facts
→ memory_evidence
→ memory_embeddings
```

Embedding:

```text
gemini-embedding-001
```

그리고:

```text
Daily Report
```

---

# 5. 이번 Request 목표

Production에 실제 자동 Worker Runner를 구축한다.

최종 구조:

```text
pg_cron
   ↓
pipeline_jobs pending 생성
   ↓
Production Worker Scheduler
   ↓
Worker Runner
   ↓
claim_pipeline_jobs
   ↓
Collection Worker
   ↓
reconcile_pipeline_v3
   ↓
Correction Worker
   ↓
reconcile_pipeline_v3
   ↓
Memory Worker
   ↓
Daily Report Worker
   ↓
최종 reconcile
```

사람이 관리자 버튼을 누르는 과정은 없어야 한다.

---

# 6. 기존 코드 우선 조사

새 Worker 로직을 중복 구현하지 말고 기존 코드를 우선 재사용한다.

실제 Repository에서 확인:

```text
lib/batch/collection.ts
lib/batch/contextCorrectionV3.ts
lib/batch/memoryV3.ts
lib/batch/dailyReportV3.ts
app/api/admin/reporting/run/route.ts
```

RPC:

```text
claim_pipeline_jobs
claim_collection_jobs_v3_for_execution
reconcile_pipeline_v3
enqueue_collection_jobs_v3
```

관리자 수동 실행 API가 현재 어떤 순서로:

```text
enqueue
claim
process
reconcile
downstream
```

을 수행하는지 확인하고,
재사용 가능한 공통 service/function으로 분리한다.

중요:

관리자 Route의 HTTP request를 내부에서 다시 호출하는 식으로 구현하지 않는다.

Worker와 Admin Manual Run이 동일한 core pipeline service를 호출하도록 한다.

---

# 7. Production Worker Runner 구현

전용 내부 Worker Endpoint를 만든다.

프로젝트 convention 확인 후 적절한 경로 사용.

예:

```text
POST /api/cron/pipeline-worker
```

또는:

```text
POST /api/internal/pipeline/worker
```

정확한 경로는 기존 코드 convention을 따른다.

---

# 8. Worker 1회 실행 순서

Worker 한 번 호출 시 최소 다음을 수행한다.

```text
1. reconcile_pipeline_v3

2. pending Collection Job claim
3. Collection 처리

4. reconcile_pipeline_v3

5. pending Context Correction claim
6. Context Correction 처리

7. reconcile_pipeline_v3

8. pending Memory Batch claim
9. Memory Batch 처리

10. pending Daily Report claim
11. Daily Report 처리

12. final reconcile_pipeline_v3
```

단순히 collection만 처리하고 종료하면 안 된다.

---

# 9. Bounded Processing

무한 loop 금지.

Serverless timeout과 LLM 실행시간을 고려해 bounded batch 방식으로 구현한다.

예:

```text
MAX_PIPELINE_PASSES
MAX_JOBS_PER_TYPE_PER_PASS
```

정확한 값은 현재 Runtime 제한 및 기존 Worker 비용을 확인해서 결정한다.

한 invocation에서 모든 backlog를 반드시 끝낼 필요는 없다.

남은 pending Job은 다음 scheduled poll에서 이어서 처리한다.

---

# 10. 자동 Scheduler 연결

Worker Endpoint를 Production scheduler가 자동 호출해야 한다.

권장 실행 간격:

```text
10분
```

목적:

```text
pending job claim
missing downstream reconciliation
transient failure recovery
```

현재 Production 배포 환경에서 실제 지원되는 scheduler 방식을 사용한다.

가능한 후보:

```text
Vercel Cron
Supabase pg_cron + HTTP invocation
기존 프로젝트 cron infrastructure
```

중요:

환경/요금제에서 지원 여부를 확인하지 않고 임의로 Vercel Cron을 가정하지 않는다.

현재 Production에서 실제 작동 가능한 방식으로 구현한다.

---

# 11. Pending 없음 = LLM 호출 0

Worker Poll 자체는 10분마다 실행 가능하지만:

```text
pending job = 0
```

이면:

```text
Gemini 호출 = 0
Embedding 호출 = 0
Correction 호출 = 0
Report 생성 = 0
```

DB 상태 확인만 하고 즉시 종료한다.

비용 원칙을 반드시 지킨다.

---

# 12. Reconciliation / Self-Healing

Worker 실행마다 `reconcile_pipeline_v3`를 사용하여 누락 Job을 스스로 복구한다.

최소 보장:

## Case A

```text
23:55 이후
Source 존재
collection_2 없음
```

→ `collection_2` idempotent enqueue

---

## Case B

```text
collection_2 completed
Raw finalized
context_correction 없음
```

→ Correction enqueue

---

## Case C

```text
context_correction completed
memory_batch 없음
```

→ Memory enqueue

---

## Case D

```text
context_correction completed
daily_report 없음
```

→ Report enqueue

Memory와 Report는 실패 격리한다.

Memory 실패 때문에 Report가 영구 정지하면 안 된다.

Corrected Daily Conversation이 준비되어 있고 Report prerequisite를 충족하면
Report는 독립적으로 진행 가능해야 한다.

---

# 13. Night-only / Phase1-only 회귀 방지

이미 배포된 night-only candidate 정책을 보존한다.

Phase2 candidate는 반드시 두 집합을 모두 포함해야 한다.

```text
A. collection_1 completed child

UNION

B. 아직 수집되지 않은 eligible source message가 있는 child
```

따라서 아래 세 패턴 전부 지원:

### A. Phase1-only

```text
C1 = N
C2 = 0
```

정상:

```text
C1 completed(N)
C2 completed(0)
Raw finalized
Correction
Memory
Report
```

### B. Night-only

```text
C1 = 0
C2 = N
```

정상:

```text
C1 completed(0)
C2 completed(N)
Raw finalized
Correction
Memory
Report
```

### C. Both

```text
C1 = N
C2 = N
```

정상 전체 Pipeline 완료.

---

# 14. Atomic Claim / Concurrency

10분 주기의 Worker가 이전 invocation과 겹쳐도 동일 Job이 중복 실행되면 안 된다.

기존 atomic claim RPC를 사용한다.

가능하면:

```text
claim_pipeline_jobs
```

또는 현재 job type에 맞는 기존 claim RPC를 재사용.

보장:

```text
같은 job을 Worker 두 개가 동시에 처리하지 않음
completed job 재처리 안 함
```

새로운 별도 lock framework를 만들지 않는다.

---

# 15. Job Idempotency

Job 생성 및 처리 중복 방지 기준:

```text
child_id
business_date
job_type
generation_version
```

동일 Worker / reconcile / scheduler가 여러 번 실행돼도:

```text
duplicate pipeline_jobs = 0
duplicate raw messages = 0
duplicate corrected messages = 0
duplicate memory_facts = 0
duplicate memory_evidence = 0
duplicate memory_embeddings = 0
duplicate daily_reports = 0
```

이어야 한다.

---

# 16. Authentication

Worker Endpoint는 Public unauthenticated endpoint로 두지 않는다.

현재 프로젝트 Cron/Internal API 인증 convention을 먼저 확인한다.

없다면 Production Secret 기반 인증 적용.

예:

```text
Authorization: Bearer <CRON_SECRET>
```

금지:

```text
service role key를 response에 출력
secret 로그 출력
admin browser session 의존
```

인증 실패:

```text
401 또는 403
```

---

# 17. Error Isolation

Job 하나가 실패했다고 Worker 전체가 중단되면 안 된다.

각 Job별로 failure isolation.

예:

```text
Child A Correction 실패
→ Child B/C processing 계속
```

Retry 가능한 오류와 permanent failure를 기존 Pipeline 정책에 맞게 구분한다.

로그 최소 필드:

```text
job_id
child_id
business_date
job_type
attempt_count
result
duration
```

로그 금지:

```text
대화 전문
Access Token
Refresh Token
Service Role Key
API Secret
```

---

# 18. Stuck Processing Recovery

`processing` 상태에서 Worker가 종료된 경우 영구 정지하면 안 된다.

현재 `claim_pipeline_jobs`의 lease / claimed_at / retry 정책을 확인한다.

이미 구현돼 있다면 그대로 사용.

부족하다면 최소 변경으로:

```text
lease timeout
retryable stale job recovery
max attempts
```

를 보강한다.

중복 LLM 실행 위험이 없도록 idempotency를 유지한다.

---

# 19. Dev Target QA

장기 전체 E2E 금지.

이번 P0에 필요한 Target QA만 수행한다.

## QA-1

```text
pending C1 존재
→ Worker 실행
→ claim
→ completed
```

## QA-2

```text
pending C2 존재
→ Worker
→ completed
→ Raw finalized
→ Correction 자동 enqueue
```

## QA-3

```text
Correction pending
→ completed
→ Memory + Report 자동 enqueue
```

## QA-4

```text
Memory pending
Report pending
→ Worker 자동 처리
```

## QA-5

```text
pending 0
→ Worker 실행 성공
→ LLM 호출 0
```

## QA-6

Worker Endpoint 동시 2회 호출:

```text
동일 Job 중복 claim = 0
중복 처리 = 0
```

## QA-7

Worker invocation 1회 실패 후:

```text
다음 scheduled poll
→ 자동 재처리
```

## QA-8

Night-only:

```text
C1 = 0
C2 = N
→ 자동 완료
```

## QA-9

Phase1-only:

```text
C1 = N
C2 = 0
→ 자동 완료
```

## QA-10

양쪽 모두:

```text
C1 = N
C2 = N
→ 자동 완료
```

Target QA PASS 즉시 Production 진행.

Dev에서 대기하지 않는다.

---

# 20. Production 배포

P0 Production 장애이므로 Dev QA PASS 후 즉시:

```text
latest main 변경 보존
→ 구현 commit
→ main 안전 통합
→ Production deploy
→ Scheduler 등록/반영
→ Worker Endpoint Production 확인
```

Force reset 금지.

관련 없는 기능 수정 금지.

대규모 리팩터링 금지.

---

# 21. 2026-08-08 Pending Job 복구

Production 배포 후 관리자 수동 실행 버튼을 사용하지 않는다.

현재 이미 존재하는 pending Job을
새 Worker Runner가 그대로 claim해서 처리하게 한다.

확인된 대상:

```text
TestA
고나연
박서둥
박서아
안서아
안서현
윤도건
윤도원
이은수
황유빈
```

기존 pending Job 삭제 금지.

새 Job으로 전부 재생성 금지.

기존 pending을 정상 Worker가 이어서 처리한다.

---

# 22. 최근 7일 Production Audit

08/08만 복구하고 종료하지 않는다.

최근 7일의 모든:

```text
child_id × business_date
```

를 검사한다.

확인:

```text
Source
Collection1
Collection2
Raw finalized
Context Correction
Memory Batch
Daily Report
```

찾을 대상:

```text
Source 존재 + Collection 누락
C2 completed + Correction 누락
Correction completed + Memory 누락
Correction completed + Report 누락
processing/pending 장기 stuck
```

발견된 누락은 새 Worker/Reconciliation 로직으로 idempotent 복구한다.

Production 기존 데이터 삭제 금지.

---

# 23. Production Final Verification

최소:

```text
TestA
고나연
박서둥
박서아
안서아
안서현
윤도건
윤도원
이은수
황유빈
```

을 검증한다.

출력:

| child | business_date | C1 | C2 | Raw Finalized | Correction | Memory | Report | Manual Action |
|---|---|---|---|---|---|---|---|---|

정상 대상은:

```text
C1 = completed
C2 = completed
Raw = finalized
Correction = completed
Memory = completed
Report = completed
Manual Action = 0
```

이어야 한다.

---

# 24. 가장 중요한 Acceptance Test — 진짜 자동 실행 증거

개발자가 Worker Endpoint를 수동 curl해서 성공한 것은 Acceptance가 아니다.

반드시 Production Scheduler가 실제로 Worker를 자동 호출한 기록을 확보한다.

최소 증거:

```text
scheduled_at
worker request timestamp
pending_before
claimed_count
completed_count
failed_count
pending_after
```

그리고 Scheduler 자동 실행으로 실제 Job 하나 이상이:

```text
pending
→ claimed
→ completed
```

로 변경된 증거를 제출한다.

자동 Scheduler 실행 증거가 없으면 Request 미완료다.

---

# 25. Daily Report와 Memory 독립성

확정 정책 유지.

```text
Corrected data
 ├─ Memory Batch
 └─ Daily Report
```

Memory가 실패해도 Report prerequisite가 충족되면 Report가 진행될 수 있어야 한다.

Memory 실패 때문에 전체 Pipeline이 막히는 구조를 만들지 않는다.

---

# 26. 비용 원칙

절대 변경 금지.

```text
Collection = DB 작업
Correction = 하루 1회
Memory = 하루 1회
Report = 하루 1회
```

10분 Worker Poll은 상태 확인/Job claim용이다.

매 Poll마다 LLM을 호출하는 구조 금지.

```text
pending 없음 → LLM 호출 0
```

---

# 27. Production 데이터 보호

절대 금지:

```text
Production 테이블 truncate
기존 Raw 삭제
기존 Corrected 삭제
기존 Memory 삭제
기존 Daily Report 삭제
전체 business_date reset
completed job pending으로 일괄 reset
```

누락된 단계부터만 복구한다.

---

# 28. Deliverables

Claude Code는 완료 시 다음을 제출한다.

## A. Root Cause

확정 Root Cause 재기재:

```text
WORKER_CLAIM_FAILURE
DOWNSTREAM_RECONCILIATION_NOT_DEPLOYED
```

## B. 변경 파일

```text
파일 경로
변경 목적
```

## C. Worker Architecture

```text
Scheduler
→ Endpoint
→ Claim
→ Process
→ Reconcile
→ Downstream
```

## D. QA 결과

QA-1 ~ QA-10 PASS/FAIL.

## E. Production Deploy

```text
commit SHA
main SHA
deployment
scheduler configuration
```

## F. Production Recovery

2026-08-08 및 최근 7일 누락 대상 복구 결과.

## G. 실제 자동 실행 증거

```text
scheduler timestamp
worker timestamp
claimed jobs
completed jobs
```

## H. 최종 Production 상태표

| child | date | C1 | C2 | Raw | Correction | Memory | Report | Manual |
|---|---|---|---|---|---|---|---|---|

---

# 29. Definition of Done

아래 전부 충족되어야 Request 071 완료다.

- [ ] Production pg_cron enqueue 정상
- [ ] Production Worker 자동 호출
- [ ] pending Job 자동 claim
- [ ] Collection 자동 처리
- [ ] Raw Daily 자동 finalize
- [ ] Correction 자동 처리
- [ ] Memory 자동 처리
- [ ] Daily Report 자동 처리
- [ ] Reconciliation 자동 실행
- [ ] Night-only 자동 처리
- [ ] Phase1-only 자동 처리
- [ ] Phase1+Phase2 자동 처리
- [ ] Zero-message Phase2 정상
- [ ] 일시 Worker 실패 후 다음 Poll 자동 복구
- [ ] duplicate Job 0
- [ ] duplicate Fact/Evidence/Embedding 0
- [ ] duplicate Report 0
- [ ] Pending 0일 때 LLM 호출 0
- [ ] 2026-08-08 Production backlog 복구
- [ ] 최근 7일 누락 전수검사 및 복구
- [ ] Production Scheduler 실제 자동 실행 증거 확보
- [ ] Manual Action = 0

최종 목표:

대표가 매일 아침 관리자 페이지에서
전날 배치가 돌았는지 확인하고
수동 실행 버튼을 누르는 운영을 완전히 제거한다.

“코드 구현 완료”가 아니라
“Production에서 사람 개입 없이 실제 자동 완료됨”이 완료 조건이다.
```

이번 Request는 Claude Code가 중간에 “Dev 구현했습니다”에서 멈추지 못하게, Production 자동 호출 증거까지 Definition of Done에 박아둔 버전입니다.