# 요청 제목
17:55 중간 수집 제거 및 23:55 하루 마감 수집 단일화

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과

현재 Production V3 리포팅 파이프라인은 아래 구조로 동작한다.

```text
17:55 collection_1 중간 수집
23:55 collection_2 하루 마감 수집
→ Context Correction
→ Memory Batch
→ Daily Report
```

이번 작업 완료 후에는 **17:55 중간 수집 기능을 완전히 제거하고, 데이터 수집은 매일 23:55 KST 하루 1회만 실행**되어야 한다.

최종 자동 파이프라인:

```text
23:55 하루 마감 수집
→ Context Correction
→ Memory Batch
→ Daily Report
→ 익일 부모 알림
```

중요:

- 17:55 자동 Cron 제거
- `collection_1` 신규 실행 중단
- 관리자 화면의 `레거시 중간 수집` 컬럼 제거
- 23:55 `collection_2`는 정상 유지
- 23:55 수집 완료 후 기존 Forward Chaining 유지
- `reconcile`은 실패/누락 복구용으로만 유지
- 과거 `collection_1` 이력 데이터는 삭제하지 않음

### 대표님 테스트 정상 프로세스

1. 관리자 `리포팅 수동 실행` 화면 진입
2. `레거시 중간 수집` 컬럼이 더 이상 표시되지 않는지 확인
3. 오후 17:55 전후에 신규 `collection_1` job이 생성되지 않는지 확인
4. 밤 23:55 KST에 `하루 마감 수집`이 자동 실행되는지 확인
5. 23:55 수집 완료 후 `보정 → Memory Batch → 리포트`가 자동으로 이어지는지 확인
6. 익일 부모 리포트/알림이 기존대로 정상 생성·발송되는지 확인

PASS 기준:

```text
- 17:55 자동 수집 0건
- collection_1 신규 job 생성 0건
- 관리자 화면에서 레거시 중간 수집 제거
- 23:55 collection_2 정상 실행
- collection_2 → context_correction → memory_batch → daily_report 정상 체이닝
- 기존 당일 대화 누락 없음
- 익일 리포트 정상 생성
- reconcile 복구 로직 정상 유지
```

---

## 1. 상태 / 우선순위 / 대상

- 상태: 구현 요청
- 우선순위: P1
- 대상 프로젝트: K-Bestie-v3
- 개발 주체: Claude Code
- 적용 대상:
  - `vercel.json` Vercel Cron
  - V3 Collection Pipeline
  - `collection_1`
  - `collection_2`
  - 관리자 `리포팅 수동 실행` / 파이프라인 현황 UI
  - 관련 관리자 API
  - 관련 테스트/E2E
- 적용 환경:
  - Dev
  - Production
- 제외 대상:
  - 과거 `pipeline_jobs` 기록 삭제
  - 23:55 `collection_2` 제거
  - Context Correction
  - Memory Batch
  - Daily Report
  - Weekly Report
  - 부모 리포트 알림
  - 실패 복구용 `reconcile`

---

## 2. 목표

현재 실제 Production 자동 스케줄은 Antigravity READ-ONLY 감사로 아래와 같이 확인됐다.

```text
17:55 KST
/api/batch/v3/collection/enqueue?phase=1
→ collection_1

23:55 KST
/api/batch/v3/collection/enqueue?phase=2
→ collection_2

collection_2 완료
→ context_correction
→ memory_batch
→ daily_report
```

이번 정책 변경:

```text
Before
17:55 중간 수집
+
23:55 마감 수집

After
23:55 마감 수집 단독
```

목표는 **하루의 대화 데이터를 23:55에 한 번만 확정 수집하고, 이후 파이프라인을 단일 체인으로 단순화**하는 것이다.

---

## 3. 요구사항

### 3-1. 17:55 Vercel Cron 제거

현재 `vercel.json`에서 확인된:

```text
/api/batch/v3/collection/enqueue?phase=1
55 8 * * *
```

즉 KST 17:55 Cron을 제거한다.

Production 배포 후 Vercel Cron 목록에서도 더 이상 17:55 phase=1 스케줄이 존재하지 않아야 한다.

---

### 3-2. `collection_1` 자동 실행 중단

17:55 Cron 제거 후 자동으로 신규:

```text
pipeline_jobs.job_type = collection_1
```

이 생성되지 않아야 한다.

과거 `collection_1` 기록은 운영 감사 이력이므로 삭제하지 않는다.

---

### 3-3. 23:55 `collection_2` 유지

현재:

```text
/api/batch/v3/collection/enqueue?phase=2
55 14 * * *
```

KST 23:55 자동 실행은 그대로 유지한다.

이 작업이 당일 대화의 **유일한 정규 자동 수집 Source of Truth**가 되어야 한다.

---

### 3-4. 23:55 수집 범위 검증

기존 `collection_1` 제거로 인해 23:55 `collection_2`가 중간 수집 이후의 증분만 가져오는 구조라면 데이터가 누락될 수 있다.

따라서 반드시 현재 collection 로직을 확인하여 `collection_2` 단독 실행만으로 **당일 전체 대상 대화가 누락 없이 수집되는지** 검증한다.

필수 확인:

```text
mission
free_chat
parent question 관련 대화
기타 raw_daily_conversations_v3 입력 대상
```

만약 phase=2가 phase=1 선행을 전제로 증분 수집만 하도록 구현돼 있다면:

```text
23:55 phase=2 단독 실행
→ 당일 전체 미수집 데이터를 모두 수집
```

하도록 최소 수정한다.

중복 수집 방지를 위해 기존 idempotency/unique key 정책을 유지한다.

---

### 3-5. Forward Chaining 유지

23:55 `collection_2` 완료 후 현재 체이닝:

```text
collection_2
→ context_correction
→ memory_batch
→ daily_report
```

을 그대로 유지한다.

중간 수집 제거 때문에 체이닝 시작 조건이 깨지지 않게 한다.

---

### 3-6. `reconcile` 역할 유지

현재 감사 결과:

```text
/api/batch/v3/reconcile
00:10 KST
```

은 실패/누락 복구용이다.

이번 작업에서 `reconcile`을 정규 2차 수집처럼 사용하거나 17:55 대체 수집으로 확장하지 않는다.

정상 상황:

```text
23:55 정규 수집
→ 정상 체이닝
```

실패/누락 상황:

```text
reconcile
→ 복구
```

역할을 유지한다.

---

### 3-7. 관리자 UI `레거시 중간 수집` 제거

현재 `ManualReportingTab.tsx`에 표시되는:

```text
레거시 중간 수집
```

컬럼을 제거한다.

화면에서 더 이상 `collection_1` 상태를 운영 핵심 단계처럼 보여주지 않는다.

최종 주요 컬럼은 현재 구조를 확인해 의미가 겹치지 않도록 정리하되 최소한 아래 흐름이 명확해야 한다.

```text
하루 마감 수집
자유대화
보정
Memory Batch
리포트
```

`레거시 미션1`, `레거시1 저장` 등 실제 현재 V3 운영에 불필요한 레거시 표시가 함께 남아 있다면 이번 변경 범위에서 제거 가능 여부를 확인한다.

단, 별도 기능/QA에 필요하면 임의 삭제하지 말고 완료 보고에 남긴다.

---

### 3-8. 관리자 API에서 `collection_1` 의존 제거

현재 확인된:

```text
/api/admin/reporting/children
```

및 관련 상태 API에서 `collection_1`을 화면용 필수 상태로 계산하는 부분을 제거한다.

단:

- 과거 이력 조회
- 감사 로그
- 기존 데이터 호환

목적으로 읽는 로직까지 불필요하게 삭제하지 않는다.

---

### 3-9. 시간 표시 포맷팅 버그 수정

감사에서 별도 확인된 UI 버그:

```text
formatDateTime(job.completed_at).substring(11, 19)
```

때문에:

```text
오후 5:56:00
→ 오후 5:5
```

로 잘리는 문제가 있다.

이번 작업에서 함께 수정한다.

문자열 인덱스 slicing에 의존하지 말고 KST 시간 포맷터를 사용한다.

예:

```text
오후 11:56
오전 12:08
```

처럼 정상 표시.

---

### 3-10. 과거 데이터 보존

삭제 금지:

```text
과거 collection_1 pipeline_jobs
과거 raw_daily_conversations_v3
과거 report
과거 correction/memory 로그
```

이번 작업은 앞으로의 자동 스케줄 정책 변경이며 과거 이력을 재작성하지 않는다.

---

### 3-11. 수동 실행 기능 영향 확인

관리자 `리포팅 수동 실행`에서 특정 단계 수동 실행 기능이 존재한다면:

- `collection_1` 전용 수동 실행 버튼/옵션이 있는지 확인
- 더 이상 필요 없으면 제거 또는 비활성
- 수동 `하루 마감 수집`은 정상 유지

대표가 수동으로 전체/특정 아이 수집할 때도 23:55 최종 수집과 동일한 최신 V3 수집 경로를 사용하도록 한다.

---

## 4. 기존 구조 확인

Antigravity 감사로 확인된 실제 구현 상태:

### Source of Truth

```text
vercel.json
```

V3 자동 배치 스케줄의 단일 Source of Truth.

Supabase `pg_cron`은 V3 전환 과정에서 중복 방지를 위해 unschedule 상태로 확인됨.

### 현재 실제 시간

```text
17:55 collection_1
23:55 collection_2
23:56~00:05 context_correction
00:05~00:20 memory_batch
00:20~00:40 daily_report
00:10 reconcile
07:00 report_notifications
```

### 관리자 화면

확인 파일:

```text
app/admin/(dashboard)/ManualReportingTab.tsx
```

### 관리자 상태 API

확인 경로:

```text
app/api/admin/reporting/children/route.ts
```

### 문제 경로

현재 정책상 불필요한:

```text
17:55 collection_1
```

이 계속 정규 Cron으로 실행되고 관리자 화면에도 별도 단계로 노출됨.

---

## 5. 금지사항

- 23:55 `collection_2` 제거 금지
- `collection_2`가 phase=1 데이터를 전제로 하는지 검증 없이 Cron만 삭제 금지
- 당일 대화 누락 허용 금지
- 과거 `collection_1` 이력 DELETE 금지
- `context_correction`, `memory_batch`, `daily_report` 체이닝 제거 금지
- `reconcile` 제거 금지
- `reconcile`을 정규 수집으로 변경 금지
- 부모 알림 스케줄 임의 변경 금지
- Cron 시간을 로컬/KST 문자열로 직접 잘못 입력 금지
- Production Secret/API Key/Token 출력 금지
- 전체 UUID 출력 금지

---

## 6. 모호성 처리

현재 `collection_2`가:

```text
A. 당일 전체 대화를 독립적으로 수집하는지
B. collection_1 이후 증분만 수집하는지
```

감사 결과만으로는 완전히 확정되지 않았다.

따라서 Claude Code는 실제 collection 구현을 먼저 확인한다.

### A라면

```text
17:55 Cron 및 UI만 제거
```

### B라면

```text
collection_2 단독으로 당일 전체 미수집 데이터를 수집할 수 있도록 최소 수정
```

한다.

어떤 경우에도 23:55 단독 수집으로 데이터 누락이 발생하면 완료 처리하지 않는다.

---

## 7. QA

### 7-1. Cron 구성

Production 배포 후:

```text
17:55 phase=1 Cron 없음
23:55 phase=2 Cron 있음
00:10 reconcile 있음
07:00 report notification 있음
```

확인.

---

### 7-2. 17:55 미실행

KST 17:55 이후:

```text
신규 collection_1 pipeline_job = 0
```

PASS.

---

### 7-3. 23:55 정규 수집

KST 23:55:

```text
collection_2 생성
→ 완료
```

PASS.

---

### 7-4. 전체 데이터 수집 누락 검증

23:55 직전까지 당일 진행한:

```text
미션
자유대화
기타 수집 대상 대화
```

가 `raw_daily_conversations_v3` 또는 현재 V3 Raw Source에 누락 없이 반영되는지 확인.

---

### 7-5. 중복 수집 검증

동일 chat/message가 중복으로 raw 수집되지 않는지 확인.

기존 idempotency 보존.

---

### 7-6. Forward Chaining

```text
collection_2 완료
→ context_correction
→ memory_batch
→ daily_report
```

순차 완료 확인.

---

### 7-7. Reconcile 회귀

정상 완료된 대상에 불필요한 중복 작업을 만들지 않고, 실제 누락/실패 대상만 복구하는지 확인.

---

### 7-8. 관리자 화면

`리포팅 수동 실행` 화면:

```text
레거시 중간 수집 컬럼 없음
하루 마감 수집 정상 표시
보정 정상
Memory Batch 정상
리포트 정상
```

확인.

---

### 7-9. 시간 표시

기존:

```text
오후 5:5
```

같은 잘린 시간 0건.

정상 KST 시각 표시.

---

### 7-10. 리포트/알림 회귀

익일:

```text
일일 리포트 정상 생성
부모 리포트 확인 가능
부모 알림 정상 발송
```

확인.

---

### 7-11. 수동 실행 회귀

관리자에서 특정 아이/전체 수동 수집 및 리포트 실행이 기존 최신 V3 경로로 정상 동작하는지 확인.

---

## 8. 완료 조건

- 17:55 Vercel Cron 제거
- `collection_1` 신규 자동 실행 0건
- 23:55 `collection_2` 유지
- 23:55 단독으로 당일 전체 대상 수집 가능
- 수집 누락 0건
- 중복 수집 0건
- `collection_2 → context_correction → memory_batch → daily_report` 정상
- `reconcile` 정상 유지
- 관리자 `레거시 중간 수집` 제거
- `오후 5:5` 시간 포맷팅 버그 수정
- 과거 pipeline 이력 보존
- TypeScript 오류 0
- Build 성공
- Dev QA PASS
- Production 배포 완료
- Production Smoke PASS

---

## 9. 완료 보고

1. 기존 17:55 Cron 제거 내용
2. 최종 `vercel.json` 자동 스케줄(KST)
3. `collection_2` 단독 수집 가능 여부 및 확인 근거
4. phase=1 의존 코드 수정 여부
5. 관리자 UI 제거 항목
6. 관리자 API 변경 내용
7. 시간 포맷팅 수정 내용
8. 17:55 신규 job 미생성 검증
9. 23:55 collection_2 실행 검증
10. 당일 전체 데이터 수집 누락 검증
11. 중복 수집 검증
12. Context Correction 체이닝
13. Memory Batch 체이닝
14. Daily Report 체이닝
15. Reconcile 회귀 테스트
16. 부모 알림 회귀 테스트
17. TypeScript/Build
18. Dev QA
19. Production Deployment
20. Production Smoke
