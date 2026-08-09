# Plan: LLM Wiki Production Worker 자동 실행 (requests/071)

## Root Cause (확정, 조사 완료)

`WORKER_CLAIM_FAILURE` — enqueue와 reconcile은 크론에 등록돼 정상 동작하지만,
실제로 job을 claim해서 처리하는 워커 엔드포인트 4종이 **이미 구현돼 있는데도
vercel.json 크론에 등록되지 않아** 아무도 호출하지 않는다.

이미 존재·동작 확인된 조각(신규 구현 불필요, 재사용만 하면 됨):

| 단계 | 함수 | 파일 | 이미 있는 엔드포인트 |
|---|---|---|---|
| Collection claim+처리 | `processCollectionJobsV3(phase, limit, workerId, executionId?)` | lib/batch/collection.ts | `app/api/batch/v3/collection/worker/route.ts` |
| Context Correction | `runContextCorrectionWorkerV3(limit, workerId?, executionId?)` | lib/batch/contextCorrectionV3.ts | `app/api/batch/v3/context-correction/worker/route.ts` |
| Memory Batch | `runMemoryBatchWorkerV3(limit, workerId?, executionId?)` | lib/batch/memoryV3.ts | `app/api/batch/v3/memory/worker/route.ts` |
| Daily Report | `processDailyReportJobsV3(limit, workerId, executionId?, source)` | lib/batch/dailyReportV3.ts | `app/api/batch/v3/daily-report/worker/route.ts` |
| Reconcile(self-healing) | `reconcilePipelineV3(targetDate, executionId?)` | lib/batch/reconcileV3.ts | `app/api/batch/v3/reconcile/route.ts` (하루 1회만 크론 등록됨) |

`reconcile_pipeline_v3` RPC(supabase/migrations/20260808130000_..._reconcile.sql:242)를
직접 읽어 Case A~D 자기치유 로직이 이미 전부 구현돼 있음을 확인했다:
- C2 없으면 idempotent enqueue (Case A)
- C2 completed + correction 없으면 correction enqueue (Case B)
- correction completed + memory 없으면 memory enqueue (Case C)
- correction completed + report 없으면 report enqueue (Case D, memory와 완전히 독립 — §12/§25 요구사항 이미 충족)

기존 크론 4종은 모두 이 패턴을 씀(`app/api/batch/v3/collection/worker/route.ts` 등):
`BATCH_SECRET`/`CRON_SECRET` Bearer 인증 → `maxIterations=20` 루프로 claim 0이 될 때까지 반복.

## 이번 작업 범위

**새 아키텍처를 만들지 않는다. 기존 4개 워커 + reconcile을 하나의 오케스트레이터로
묶고 10분 크론에 등록하는 배선(wiring) 작업이다.**

### 1. 신규 파일: `app/api/batch/v3/worker/route.ts`

§8 요구 순서 그대로 구현(요청서 원문):
```
1. reconcile_pipeline_v3
2-3. collection claim+처리 (processCollectionJobsV3, phase 1과 2 둘 다)
4. reconcile
5-6. correction claim+처리 (runContextCorrectionWorkerV3)
7. reconcile
8-9. memory claim+처리 (runMemoryBatchWorkerV3)
10-11. daily report claim+처리 (processDailyReportJobsV3)
12. final reconcile
```

- 대상 businessDate: `previousKstBusinessDate()`(lib/batch/reconcileV3.ts에 이미 있음, KST 기준 전날).
- 인증: 기존 4개 워커와 동일한 `BATCH_SECRET`/`CRON_SECRET` Bearer 패턴 재사용(§16 요구사항 충족).
- Bounded: 각 단계는 이미 자체적으로 `maxIterations=20`이 있으므로, 오케스트레이터 레벨에서는
  전체 하나의 pass만 수행(요청서 §9 "한 invocation에서 모든 backlog를 반드시 끝낼 필요는 없다").
  Serverless timeout(Vercel Fluid Compute 기본 300초) 안에서 끝나도록, 각 stage 호출에
  `Promise` 타임박스는 걸지 않되(내부 claim이 이미 bounded) 전체 stage 6개(reconcile×3 +
  collection×2phase + correction + memory + report)가 순차 실행되는 정도로 유지한다.
- Error Isolation(§17): 각 단계를 try/catch로 감싸 한 단계 실패가 이후 단계를 막지 않게 한다.
  reconcile 실패 → 로그만 남기고 계속. collection 실패 → 로그 남기고 correction/memory/report는
  그대로 진행(어차피 각자 claim 기반이라 서로 blocking 아님).
- 응답 바디에 §24 "실제 자동 실행 증거"에 쓸 구조화된 결과를 담는다:
  `{ businessDate, stages: { reconcile1: {...}, collection_phase1: {claimed,completed,errors}, ... }, startedAt, finishedAt }`.
- 로그 필드(§17): job_id/child_id/business_date/job_type/attempt_count/result/duration만.
  대화 전문·토큰·시크릿 금지(기존 워커들이 이미 이 원칙을 지키고 있음 — 그대로 따름).

### 2. `vercel.json`에 크론 1건 추가

```json
{ "path": "/api/batch/v3/worker", "schedule": "*/10 * * * *" }
```

- 이 프로젝트는 이미 9개의 daily 크론이 등록돼 있음 = Hobby 플랜(크론 2개 제한)이 아니라
  Pro 이상이 확실함(Hobby는 크론 최대 2개). 10분 간격(1일 144회) crons도 Pro 플랬에서 지원됨.
  실제 등록 후 Vercel 대시보드에서 크론 실행 로그로 재확인한다(§24 증거).
- `vercel.json`은 공유 설정 파일 — 이 한 줄만 추가하고 기존 9개 크론 항목은 절대 건드리지 않는다.

### 3. Idempotency / Atomic claim (§14, §15)

이미 기존 claim RPC(`claim_pipeline_jobs` 등)가 원자적 claim을 보장하고, 각 stage 함수가
루프 안에서 claim=0이면 멈추므로 별도 lock framework는 만들지 않는다(요청서 §14 지시와 일치).

### 4. Night-only/Phase1-only(§13)

`reconcile_pipeline_v3`가 이미 두 케이스를 UNION으로 다룬다 — 오케스트레이터가 두 phase의
collection worker를 모두 호출하고 reconcile을 그 뒤에 실행하기만 하면 기존 RPC 로직이
알아서 처리한다. 추가 분기 코드 불필요.

## QA (Dev, Target QA만 — 요청서 §19)

QA-1~QA-10은 요청서 원문 그대로. Dev에서 pipeline_jobs pending 상태를 인위적으로 만들어(테스트
계정 대상) 오케스트레이터 엔드포인트를 curl로 직접 호출해 claim→completed 전이, 동시 2회 호출
시 중복 claim 0건, 실패 후 재시도 등을 확인한다. 장기 전체 E2E는 하지 않는다(요청서 §19 명시).

## Production 배포 후 (§20~§24)

1. main에 커밋(격리 워크트리) → Dev 배포 → QA PASS 확인 즉시 Production 배포(요청서 §20, Dev
   대기 금지 명시).
2. 2026-08-08 pending 대상 10명 + 최근 7일 전수 조사는 **읽기 전용 쿼리로 먼저 현황 확인** 후,
   기존 pending job을 새 워커가 claim하는 것만 확인한다 — 새 job 재생성/기존 job 삭제 금지(§21).
3. §24 "진짜 자동 실행 증거"는 Vercel 크론 실행 로그(Dashboard → Cron Jobs → 실행 이력)에서
   scheduled invocation의 실제 timestamp + 응답 바디(claimed/completed 수)를 캡처해 제출한다.
   개발자가 수동 curl한 결과는 증거로 인정하지 않는다(요청서 §24 명시 — 반드시 스케줄러가
   실제로 호출한 기록이어야 함).

## 리스크 / 대표님 확인 필요할 수 있는 지점

- Vercel 크론 10분 간격이 현재 플랜에서 정말 지원되는지는 실제 등록 후 대시보드에서
  "다음 실행 예정 시각"이 10분 뒤로 잡히는지 확인해야 확정된다(간접 증거는 있지만 100% 확정은 아님).
  만약 플랜 제약으로 10분이 안 되면 가장 가까운 지원 간격으로 낮추고 대표님께 보고한다.
- 최근 7일 전수 감사에서 이번 워커 로직으로 자동 복구되지 않는 이상 패턴(예: RLS 문제로
  claim 자체가 실패하는 case)을 발견하면 임의 스키마 변경 없이 먼저 보고한다.
