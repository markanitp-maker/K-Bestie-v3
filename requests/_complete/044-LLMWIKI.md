# 044 - LLM Wiki V3 Production 적용 및 Dev·Production 정합화

## 작업 목적

Antigravity의 Production 읽기 전용 점검에서 확인된 미적용 사항을 실제로 수정·배포한다.

이번 작업은 상태를 다시 전면 점검하는 작업이 아니다.
이미 확인된 아래 Gap만 구현·적용하고, 적용 직후 결과를 검증한다.

---

## 확정된 최종 프로세스

```text
아이와 케이의 미션·자유대화
        ↓
chat_messages 실시간 저장
        ↓
17:55 1차 Collection
        ↓
mission_1 + free_chat_1 수집
        ↓
raw_daily_conversations_v3에 1차 누적
        ↓
보정 작업 없음
        ↓
23:55 2차 Collection
        ↓
mission_2 + free_chat_2 수집
        ↓
같은 child_id + business_date의
raw_daily_conversations_v3에 2차 누적
        ↓
1차 + 2차 수집 데이터가 모두 합쳐진
하루 전체 Raw 데이터 완성
        ↓
Context Correction 1회 실행
        ↓
corrected_daily_conversations_v3 생성
        ↓
Memory Batch 실행
        ↓
Daily Report 생성
        ↓
다음 미션·자유대화에서 Retrieval
        ↓
관련 기억을 Gemini Prompt에 주입
        ↓
과거 이야기를 기억하는 케이 응답
```

---

# 1. Antigravity 점검에서 확정된 Production 상태

다음 항목은 이미 점검됐으므로 동일한 전체 감사를 다시 하지 않는다.

## Production 미적용

* V3 최종 Migration 미적용
* `enqueue_collection_jobs_v3` 최종 함수 수정 미적용
* Production Vercel Cron 미적용
* Collection Cron용 GET 핸들러 미배포
* `CRON_SECRET` 인증 미적용 또는 미배포
* 17:55 Phase 1 자동 실행 미적용
* 23:55 Phase 2 자동 실행 미적용
* Context Correction 누락 메시지 Fallback 수정 미배포
* 미션·자유대화 V3 Retrieval 및 Prompt 주입 코드 미배포

## Production 보존 데이터

현재 Production에는 다음 데이터가 정상 보존돼 있다.

```text
memory_facts: 5건
memory_evidence: 7건
memory_embeddings: 7건
embedding model: gemini-embedding-001
```

이 데이터는 삭제·초기화·전체 재생성하지 않는다.

---

# 2. 작업 범위

## 2.1 Dev 변경사항 정식 반영

Antigravity가 Dev에서 수정·검증한 변경사항 중 아직 임시 파일이나 로컬 변경으로 남아 있는 내용을 정식 소스와 Migration으로 정리한다.

대상:

* `app/api/batch/v3/collection/enqueue/route.ts`
* `lib/batch/contextCorrectionV3.ts`
* `lib/batch/collection.ts`
* `lib/batch/memoryV3.ts`
* `lib/batch/dailyReportV3.ts`
* `lib/memory/vectorRetrieval.ts`
* 미션 V3 API
* 자유대화 V3 API
* `vercel.json`
* `supabase/migrations/20260802080000_v3_pipeline_final_fixes.sql`
* 관련 V3 Migration

`scratch/fix_rpc.sql`, 임시 Node 스크립트, 수동 DB 변경에만 존재하는 내용은 정식 Migration과 소스로 이동한다.

임시 테스트 스크립트는 Production 배포 대상에 포함하지 않는다.

---

# 3. Vercel Cron 적용

## 3.1 실행 시간

Vercel Cron은 UTC 기준으로 설정한다.

```text
17:55 KST = 08:55 UTC
23:55 KST = 14:55 UTC
```

`vercel.json`에는 다음 의미의 설정을 적용한다.

```json
{
  "crons": [
    {
      "path": "/api/batch/v3/collection/enqueue?phase=1",
      "schedule": "55 8 * * *"
    },
    {
      "path": "/api/batch/v3/collection/enqueue?phase=2",
      "schedule": "55 14 * * *"
    }
  ]
}
```

기존 API 쿼리 규격이 다르면 실제 구현에 맞게 경로만 조정한다. 실행 시간과 Phase 역할은 변경하지 않는다.

---

## 3.2 Cron 인증

`GET /api/batch/v3/collection/enqueue`를 외부에서 임의 호출할 수 없도록 보호한다.

필수 조건:

* `CRON_SECRET` 사용
* `Authorization: Bearer <CRON_SECRET>` 검증
* Secret 누락 또는 불일치 시 `401`
* Secret 값을 응답·로그에 출력하지 않음
* Dev와 Production은 서로 다른 Secret 사용
* 로컬 개발 편의를 위한 인증 우회 금지
* Production 요청에서만 인증하도록 느슨하게 구현하지 말고 모든 배포 환경에서 동일 원칙 적용

---

# 4. Phase 1과 Phase 2 역할 분리

## 4.1 Phase 1 — 17:55

수집 대상:

```text
mission_1
free_chat_1
```

처리:

```text
chat_messages
→ raw_daily_conversations_v3 1차 누적
→ 종료
```

절대 실행하면 안 되는 작업:

```text
Context Correction
Memory Batch
Daily Report
```

`p_include_downstream` 또는 같은 역할의 값은 Phase 1에서 반드시 `false`여야 한다.

---

## 4.2 Phase 2 — 23:55

수집 대상:

```text
mission_2
free_chat_2
```

처리:

```text
같은 child_id + business_date Raw에 2차 누적
→ 하루 전체 Raw 완성
→ Context Correction 1회
→ Memory Batch
→ Daily Report
```

Phase 2에서 새로운 하루 Raw를 별도로 생성하지 않는다.

같은 아이·같은 날짜에 다음 조건을 보장한다.

* `raw_daily_conversations_v3` 1건
* 메시지 중복 0건
* 메시지 누락 0건
* Context Correction Job 1건
* Memory Batch Job 1건
* Daily Report Job 1건

---

# 5. Production Migration 적용

## 5.1 `enqueue_collection_jobs_v3`

정식 Migration을 통해 다음을 Production에 적용한다.

* 기존 충돌 함수 안전 제거
* 최종 함수 시그니처 생성
* `RETURNS TABLE` 컬럼과 실제 반환 컬럼 일치
* API에서 사용하는 반환 필드명과 일치
* 기존 오버로드가 남아 RPC 호출이 충돌하지 않게 처리
* 동일 Migration 재적용 시 데이터 파괴가 없게 작성

예상 반환 의미:

```text
execution_id
cutoff_at
enqueued_count
existing_count
```

실제 코드가 다른 명칭을 사용한다면 호출 코드와 DB 함수 중 하나를 정리하여 완전히 일치시킨다.

---

## 5.2 `pipeline_v3_control`

Production의 현재 `enabled`와 `cutover_at`을 무조건 테스트 값으로 덮어쓰지 않는다.

적용 원칙:

* `enabled = true`
* `cutover_at`은 Production V3 실제 적용 시점 또는 기존 메시지 수집 정책에 맞는 안전한 값 사용
* Dev 테스트에서 사용한 `2025-01-01T00:00:00Z`를 Production에 그대로 복사하지 않음
* 기존 메시지를 과도하게 재수집하지 않도록 결정
* 이미 `collected_at`이 설정된 메시지를 재수집하지 않음
* 기존 Production 데이터와 신규 V3 처리 경계를 명확히 유지

Migration 안에 임의의 과거 날짜를 하드코딩하지 말고, 안전한 배포 절차 또는 별도 명시적 설정으로 처리한다.

---

# 6. Context Correction 수정 배포

현재 Dev에서 수정된 Tolerant Fallback을 Production에 배포한다.

필수 구현:

* Gemini 반환 결과와 원본 메시지를 안정적인 메시지 ID로 매핑
* 배열 순서만으로 원본과 보정 결과를 연결하지 않음
* `source_message_id` 또는 동등한 고유 식별자 사용
* Gemini가 반환하지 않은 메시지는 원문 유지
* 케이 메시지도 Corrected 데이터에서 누락되지 않음
* 전체 대화 순서 유지
* Raw 메시지 수와 Corrected 메시지 수 일치
* 동일 메시지 중복 저장 방지
* Gemini가 존재하지 않는 ID를 반환하면 해당 항목 무시 및 마스킹 로그 기록
* 같은 ID를 중복 반환하면 중복 제거 또는 Job 오류 처리

다음 방식은 금지한다.

```text
Gemini 반환 배열 0번 → Raw 배열 0번
Gemini 반환 배열 1번 → Raw 배열 1번
```

---

# 7. Memory Batch 적용

Production의 기존 Memory 데이터는 보존한 상태로 신규 V3 데이터부터 처리한다.

필수 조건:

* `memory_facts`
* `memory_evidence`
* `memory_embeddings`
* 필요한 경우 `memory_entities`
* 필요한 경우 `memory_relations`

Embedding 모델:

```text
gemini-embedding-001
```

저장과 검색에서 동일 모델을 사용한다.

동일한 `child_id + business_date + pipeline_version + fact identity` 재실행 시 다음 추가 생성 수가 모두 0이어야 한다.

```text
memory_facts: +0
memory_evidence: +0
memory_embeddings: +0
```

---

# 8. Retrieval 및 Prompt 주입 배포

Dev에서 구현된 V3 Retrieval 코드를 Production 미션·자유대화 경로에 배포한다.

적용 대상:

* 미션 대화
* 자유대화
* 자동 마이크
* 수동 마이크

필수 흐름:

```text
현재 아이 발화
→ gemini-embedding-001 Embedding
→ 해당 child_id의 memory_facts 검색
→ 관련 Fact Top-K 선정
→ Gemini Prompt 내부 기억 컨텍스트에 주입
→ 케이 응답 생성
```

Fallback 정책:

```text
V3 Fact 있음
→ V3만 사용

V3 Fact 없음
→ 기존 child_memory 사용
```

V3와 Legacy Memory를 동시에 중복 주입하지 않는다.

개인정보나 전체 원문을 로그에 출력하지 않는다.

---

# 9. Legacy Cron 충돌 방지

Antigravity는 Production `cron.job`을 REST에서 조회하지 못했다.

Claude Code는 전체 재점검을 하지 말고, Production 변경 직전에 필요한 최소 SQL 조회만 수행한다.

확인 대상:

```sql
select
  jobid,
  jobname,
  schedule,
  active,
  command
from cron.job
order by jobid;
```

목적은 다음 하나뿐이다.

```text
기존 Legacy Collection·Correction·Memory·Report Cron과
신규 V3 Vercel Cron의 중복 실행 방지
```

Legacy Cron이 확인되면:

* 즉시 삭제하지 않음
* 먼저 비활성화
* Job ID와 기존 설정 기록
* Rollback SQL 작성
* 신규 V3 Cron과 동일 시간·동일 대상 처리 여부 확인
* 관련 없는 Cron은 변경하지 않음

`cron.job` 조회가 불가능하면 임의 추측으로 기존 Cron을 삭제하지 말고 중단 후 정확한 접근 권한 또는 SQL 실행 방법만 보고한다.

---

# 10. Production 기존 Memory 보존

Production 변경 직전 아래 ID와 건수를 기록한다.

```text
memory_facts: 5건
memory_evidence: 7건
memory_embeddings: 7건
model: gemini-embedding-001
```

Migration과 배포 후 다음을 다시 확인한다.

* 기존 Fact 5건 모두 존재
* 기존 Fact ID 변경 없음
* 기존 Evidence 7건 유지
* 기존 Embedding 7건 유지
* Embedding 모델 유지
* 고아 Evidence 0건
* 고아 Embedding 0건

기존 데이터를 삭제한 뒤 다시 생성하는 방식은 금지한다.

---

# 11. Dev 적용 및 배포

Production 적용 전에 저장소의 최종 변경을 Dev에 먼저 배포한다.

Dev에서는 이미 전체 E2E가 검증됐으므로 같은 대규모 테스트를 처음부터 다시 하지 않는다.

다음 변경분만 회귀 확인한다.

* Cron GET 인증
* Cron UTC 시간
* 정식 Migration 적용
* `source_message_id` 기반 Context Correction 병합
* 미션 Prompt 주입
* 자유대화 Prompt 주입
* 동일 대상 멱등성

모두 PASS하면 Production 적용으로 이동한다.

---

# 12. Production 배포 순서

다음 순서를 지킨다.

```text
1. 기존 Memory ID·건수 기록
2. 기존 Cron 최소 조회
3. DB 백업 또는 복구 지점 확인
4. V3 Migration 적용
5. Production 환경변수 CRON_SECRET 설정
6. 앱 Production 배포
7. Vercel Cron 등록 확인
8. Legacy 충돌 Cron 비활성화
9. Phase 1 테스트 트리거
10. Phase 2 테스트 트리거
11. Memory 보존 재검증
12. Retrieval 검증
```

Production의 실제 17:55·23:55를 기다리지 않고, Cron과 동일한 GET 엔드포인트와 인증 방식으로 테스트 실행할 수 있다.

단, 격리된 Production QA 아이만 사용한다.

일반 사용자 데이터를 테스트에 사용하지 않는다.

---

# 13. Production 검증 기준

## Phase 1 PASS

* 응답 성공
* `mission_1`, `free_chat_1`만 수집
* Raw 1차 누적
* Context Correction 0건
* Memory Batch 0건
* Daily Report 0건

## Phase 2 PASS

* `mission_2`, `free_chat_2` 수집
* 동일 Raw에 병합
* Context Correction 정확히 1건
* Corrected 1건
* Memory Batch 완료
* Daily Report 완료

## Memory PASS

* 신규 Fact 1건 이상
* 모든 Fact에 Evidence 연결
* 모든 Fact에 Embedding 연결
* 모델 `gemini-embedding-001`
* 재실행 시 추가 Fact·Evidence·Embedding 0건
* 기존 Production Fact 5건 보존

## Retrieval PASS

* 미션 API에서 관련 기억 검색
* 자유대화 API에서 관련 기억 검색
* 실제 Gemini Prompt에 기억 주입
* 응답이 해당 기억을 반영
* 원문·Secret 로그 노출 없음

---

# 14. 선택 Backfill

Production 자동 파이프라인 적용과 검증이 모두 완료된 뒤에만 진행한다.

후보 날짜:

```text
2026-07-31
2026-08-01
```

실행 조건:

* 해당 날짜 Corrected 데이터 존재
* Memory Fact가 실제로 누락
* 기존 Fact와 중복되지 않음
* 대상 아이와 날짜를 명시
* 전체 과거 데이터 처리 금지
* 선택 대상만 실행
* 실행 전후 건수 기록

조건을 충족하지 않으면 Backfill하지 않는다.

---

# 15. 보안 조치

작업 기록에 Dev DB 비밀번호가 평문으로 노출된 이력이 있다.

다음 조치를 수행한다.

* Dev Supabase DB 비밀번호 회전
* 환경변수와 연결 설정 갱신
* 코드와 `scratch`에서 기존 비밀번호 문자열 검색
* 임시 SQL·Node 스크립트의 평문 연결 문자열 제거
* Git 추적 여부 확인
* Secret 값 출력 금지
* Production DB 비밀번호는 조회·출력하지 않음

검증 로그에는 다음만 남긴다.

```text
Secret configured: true/false
Authentication test: PASS/FAIL
```

Secret 실제 값은 절대 출력하지 않는다.

---

# 완료 기준

다음 항목이 전부 충족돼야 완료다.

## Dev

* 변경 소스 정식 반영
* Migration 정식 반영
* Cron 시간 정상
* Cron 인증 정상
* 배포 완료
* 제한 회귀 테스트 PASS

## Production

* Migration 적용
* Production 배포
* Vercel Cron 2건 등록 및 활성화
* Legacy 중복 Cron 제거
* Phase 1 PASS
* Phase 2 PASS
* Context Correction 1회 PASS
* Memory Batch PASS
* Daily Report PASS
* 미션 Retrieval PASS
* 자유대화 Retrieval PASS
* 기존 Memory Fact 5건 보존
* 기존 Evidence 7건 보존
* 기존 Embedding 7건 보존
* 고아 데이터 0건
* Rollback 방법 확보

---

# 금지사항

* Antigravity가 끝낸 전체 현황 점검 반복 금지
* Production 전체 테이블 감사 반복 금지
* Production Memory 전체 삭제 금지
* 전체 과거 데이터 Backfill 금지
* 기존 Fact ID 변경 금지
* Legacy Cron 즉시 삭제 금지
* Secret·비밀번호 평문 출력 금지
* Production 일반 사용자 데이터로 테스트 금지
* Dev에서 이미 검증된 내용을 이유 없이 반복 실행 금지
* 문제를 발견하고 보고만 한 뒤 작업 중단 금지

확인된 Gap은 실제로 수정·배포·검증까지 완료한다.

---

# 최종 보고 형식

## 1. 최종 결과

```text
Dev: PASS / FAIL
Production: PASS / FAIL
```

## 2. 변경 파일

* 경로
* 변경 내용

## 3. Migration

* 파일명
* Dev 적용 결과
* Production 적용 결과

## 4. Cron

* Phase 1 경로
* Phase 1 UTC/KST 시간
* Phase 2 경로
* Phase 2 UTC/KST 시간
* 인증 상태
* 활성 상태

## 5. Production 검증

* Phase 1 결과
* Phase 2 결과
* Context Correction 실행 횟수
* Memory Fact 생성 수
* Evidence 생성 수
* Embedding 생성 수
* Daily Report 생성 수
* 멱등성 결과
* 미션 Retrieval 결과
* 자유대화 Retrieval 결과

## 6. 기존 Memory 보존

```text
기존 Fact: 5 / 5
기존 Evidence: 7 / 7
기존 Embedding: 7 / 7
기존 Fact ID 변경: 0
고아 Evidence: 0
고아 Embedding: 0
```

## 7. 비활성화한 Legacy Cron

* Job ID
* Job 이름
* 기존 Schedule
* 비활성화 이유
* Rollback 방법

## 8. 보안 조치

* Dev DB 비밀번호 회전 여부
* 하드코딩 제거 여부
* Secret 로그 노출 여부

## 9. Backfill 결과

실행하지 않았다면 그 이유를 명시한다.

## 10. 남은 문제

없으면 다음과 같이 기록한다.

```text
남은 문제 없음
