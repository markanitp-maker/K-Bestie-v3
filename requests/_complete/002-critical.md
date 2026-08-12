# Production V3 파이프라인 전체 정상화 및 기존 누적 데이터 복구 요청

## 작업 목표

Antigravity의 Production 원인 분석 결과를 기준으로, 다음 두 가지를 모두 완료한다.

1. Production에 이미 쌓인 `chat_messages`를 기반으로 누락되거나 실패한 데이터 수집·Context Correction·Memory Batch·LLM Wiki·Daily Report를 정상 복구한다.
2. 2026-08-03부터 매일 자동 파이프라인이 정상 실행되도록 Production 배포·스케줄·오케스트레이션을 완성한다.

이번 작업은 전체 상태를 처음부터 다시 감사하는 작업이 아니다. Antigravity가 확인한 원인을 기준으로 바로 코드 수정·배포·누락 데이터 복구·자동화 검증을 진행한다.

---

## 확정 파이프라인

```text
아이와 케이의 미션·자유대화
        ↓
chat_messages 실시간 저장
        ↓
17:55 Collection Phase 1
        ↓
mission_1 + free_chat_1 수집
        ↓
raw_daily_conversations_v3에 1차 누적
        ↓
보정 작업 없이 종료
        ↓
23:55 Collection Phase 2
        ↓
mission_2 + free_chat_2 수집
        ↓
동일 child_id + business_date의 Raw에 2차 누적
        ↓
1차 + 2차가 합쳐진 하루 전체 Raw 완성
        ↓
Context Correction 정확히 1회
        ↓
corrected_daily_conversations_v3 생성
        ↓
Memory Batch
        ↓
memory_facts / memory_evidence / memory_embeddings
        ↓
Daily Report
        ↓
daily_reports
        ↓
다음 미션·자유대화에서 Retrieval
        ↓
관련 LLM Wiki 기억을 Gemini Prompt에 주입
```

정상 흐름에서는 Memory Batch 이후 Daily Report를 처리한다. 단, Memory Batch 자체가 실패하더라도 실패 상태를 기록한 뒤 Daily Report는 계속 생성할 수 있어야 한다.

---

# 1. Antigravity가 확정한 Production 장애 원인

다음 원인은 이미 확인됐으므로 동일한 전체 감사 작업을 반복하지 않는다.

## 1.1 과거 메시지 수집 제외

Production의 `pipeline_v3_control.cutover_at`이 다음 시각으로 설정돼 있었다.

```text
2026-08-01 20:46:53 UTC
2026-08-02 05:46:53 KST
```

해당 시점 이전 메시지가 V3 Collection 대상에서 제외됐다.

주요 영향:

```text
안서아: 2026-07-29 ~ 2026-08-01
안서현: 2026-07-29 ~ 2026-08-01
```

`cutover_at`을 과거로 변경하여 모든 데이터를 무차별 재처리하지 말고, 실제 `chat_messages`가 존재하면서 결과물이 누락된 아이·날짜만 선택 복구한다.

## 1.2 관리자 수동 실행 오케스트레이션 오류

관리자 화면의 `collect_and_generate` 실행에서 다음 문제가 확인됐다.

- Collection 이후 Context Correction·Memory Batch·Daily Report가 이어서 Enqueue되지 않음
- Raw 또는 Corrected가 없는 상태에서 Daily Report만 단독 실행됨
- 기존 실패 Job 때문에 새 재처리가 정상 시작되지 않음
- 완료된 단계와 실패한 단계를 구분하지 않고 처리함

## 1.3 대량 메시지 Context Correction 실패

윤도원 2026-08-02 데이터에서 확인됐다.

```text
Raw 메시지: 약 68개
Collection: 완료
Context Correction: MESSAGE_COUNT_MISMATCH
결과: PERMANENT_ERROR
Memory Batch: 후속 실패
Daily Report: 후속 실패
```

Gemini가 전체 메시지를 한 번에 처리하면서 일부 결과가 누락되거나 JSON 결과가 잘렸고, 입력 개수와 반환 개수를 엄격하게 비교하는 코드 때문에 전체 Job이 영구 실패했다.

## 1.4 정상 비교 대상

윤도건 2026-08-02 데이터는 약 30개 메시지로 전체 파이프라인을 정상 통과했다.

윤도건의 기존 결과는 재처리하거나 중복 생성하지 않는다.

---

# 2. 작업 범위

## 2.1 코드 수정

- 대량 메시지 Context Correction 안정화
- 메시지 ID 기반 보정 결과 병합
- 누락 메시지 원문 Fallback
- 관리자 수동 실행 전체 오케스트레이션 수정
- 실패 단계부터 재개하는 재처리 기능
- Memory Batch 실패와 Daily Report 실패 분리
- Production 자동 Cron 활성화
- Legacy와 V3 중복 실행 방지
- Retrieval 및 Prompt 주입 Production 적용 확인

## 2.2 기존 데이터 복구

2026-07-29부터 2026-08-02까지 Production에 존재하는 모든 `chat_messages`를 기준으로 아이·날짜별 누락 단계를 복구한다.

특히 다음 계정을 반드시 포함한다.

```text
안서아
안서현
윤도원
윤도건
```

단, 특정 4명만 하드코딩하지 않는다. 같은 기간에 실제 `chat_messages`가 존재하고 V3 결과물이 누락되거나 실패한 다른 Production 아이도 동일 기준으로 복구한다.

## 2.3 오늘 이후 자동 운영

2026-08-03부터 다음 자동 실행을 Production에서 정상화한다.

```text
매일 17:55 KST
→ Collection Phase 1
→ mission_1 + free_chat_1만 Raw에 누적
→ 종료

매일 23:55 KST
→ Collection Phase 2
→ mission_2 + free_chat_2를 동일 Raw에 누적
→ Context Correction 1회
→ Memory Batch
→ Daily Report
```

---

# 3. 절대 준수사항

1. 기존 Production 데이터를 삭제하거나 전체 초기화하지 않는다.
2. 기존 완료 결과는 재생성하지 않는다.
3. 누락되거나 실패한 단계만 이어서 처리한다.
4. 기존 실패 Job 이력은 삭제하지 않는다.
5. 재처리는 새로운 `execution_id`로 수행한다.
6. 동일 아이·날짜 재실행 시 중복 결과를 생성하지 않는다.
7. `cutover_at`을 과거로 돌려 전체 메시지를 무차별 재수집하지 않는다.
8. Production 기존 Memory 데이터를 삭제·재생성하지 않는다.
9. 윤도건 2026-08-02 정상 결과는 재처리하지 않는다.
10. Production 일반 사용자 대화 원문을 로그에 출력하지 않는다.
11. Secret, 서비스 역할 키, DB 비밀번호를 코드·스크립트·명령어·로그에 평문으로 남기지 않는다.
12. Antigravity가 완료한 전체 상태 점검을 Claude Code가 처음부터 반복하지 않는다.
13. 적용 전 데이터 보존 확인과 적용 후 결과 검증에 필요한 최소 조회만 수행한다.

---

# 4. Context Correction 대량 메시지 처리 개선

대상:

```text
lib/batch/contextCorrectionV3.ts
```

실제 Worker가 다른 파일에 구현돼 있다면 해당 파일도 함께 수정한다.

## 4.1 Chunk 처리

하루 전체 보정은 하나의 논리 Job으로 유지하되, 내부 Gemini 호출은 메시지 수 또는 토큰 예산에 따라 나눈다.

권장 흐름:

```text
하루 전체 Raw
→ 전체 메시지 순서 및 source_message_id 고정
→ 20~30개 또는 안전한 토큰 예산 단위 Chunk
→ Chunk별 Gemini Context Correction
→ source_message_id 기준 결과 병합
→ 누락 메시지 원문 Fallback
→ 하루 Corrected 최종본 1건 저장
```

Chunk 크기는 모델 응답 한도와 실제 프롬프트 크기를 기준으로 결정한다. 메시지 개수만 고정하지 말고 토큰 예산 초과도 방지한다.

## 4.2 메시지 병합

필수 조건:

- 배열 위치가 아닌 `source_message_id` 기준으로 매핑
- Gemini가 반환하지 않은 메시지는 원문 유지
- 케이 메시지와 아이 메시지 모두 최종 결과에 유지
- Raw의 원래 `display_sequence` 유지
- 존재하지 않는 ID 반환 시 무시하고 마스킹 경고 기록
- 같은 ID 중복 반환 시 한 건만 사용
- Chunk 간 중복 저장 금지
- 최종 Corrected 메시지 수와 Raw 메시지 수 일치
- 동일 Job 재실행 시 중복 Corrected 메시지 생성 금지

## 4.3 오류 처리

다음 동작을 제거한다.

```text
전체 입력 메시지 수 != Gemini 반환 메시지 수
→ 즉시 PERMANENT_ERROR
```

다음 방식으로 변경한다.

```text
정상 반환 메시지
→ 보정 결과 사용

Gemini 반환 누락
→ 원문 Fallback

Chunk JSON 파싱 실패
→ 해당 Chunk 제한 재시도

재시도 후에도 실패
→ 해당 Chunk 원문 Fallback 또는 명시적 실패 처리
```

단순 반환 개수 불일치는 복구 가능한 오류로 처리하고, 무조건 영구 실패로 확정하지 않는다.

---

# 5. 관리자 수동 실행 오케스트레이션 개선

대상:

```text
즉시 대화 수집
즉시 리포트 생성
수집 후 리포트 즉시 생성
```

특히 `collect_and_generate`를 다음처럼 수정한다.

```text
기존 chat_messages 확인
        ↓
누락된 Collection 실행
        ↓
Raw 하루 데이터 완성 확인
        ↓
Context Correction 실행 또는 기존 완료 결과 사용
        ↓
Memory Batch 실행 또는 기존 완료 결과 사용
        ↓
Daily Report 실행 또는 기존 완료 결과 사용
```

## 5.1 단계별 재사용

```text
Collection 완료
→ 재수집하지 않고 다음 단계 진행

Raw 존재
→ Raw를 삭제하거나 다시 만들지 않음

Context Correction 완료
→ Corrected 결과 재사용

Memory Batch 완료
→ 기존 Memory 재사용

Daily Report 완료
→ 중복 Report 생성 금지
```

## 5.2 실패 단계 재처리

관리자 수동 실행에서 기존 `PERMANENT_ERROR`를 그대로 반환하고 종료하지 않는다.

- 새로운 `execution_id` 생성
- 기존 완료 단계 재사용
- 최초 실패 단계부터 재처리
- 기존 실패 이력 보존
- 재처리 횟수 기록
- 같은 Job 중복 생성 방지

## 5.3 잘못된 단독 실행 방지

다음 상태에서는 Daily Report만 단독으로 실행하지 않는다.

```text
Raw 없음
Corrected 없음
Context Correction 실패
```

관리자 화면에는 실제 상태를 구분해 표시한다.

```text
수집: 완료
수집보정: 실패
메모리: 대기 — 수집보정 실패
리포트: 대기 — 수집보정 실패
```

---

# 6. 단계별 Job 전이 정상화

정상 전이:

```text
Collection Phase 2 완료
→ Context Correction Enqueue

Context Correction 완료
→ Memory Batch Enqueue
→ Daily Report 실행 준비

Memory Batch 완료
→ Daily Report 실행

Memory Batch 실패
→ Memory 실패 기록
→ Daily Report는 계속 실행

Context Correction 실패
→ Memory Batch와 Daily Report는 blocked 상태
```

Context Correction 실패 때문에 실행하지도 않은 Memory와 Report를 모두 `PERMANENT_ERROR`로 기록하지 않는다.

권장 상태 예:

```text
context_correction: failed
memory_batch: blocked_by_context_correction
daily_report: blocked_by_context_correction
```

Context Correction 재처리 성공 후 차단된 후속 단계를 이어서 실행한다.

---

# 7. 기존 누적 데이터 복구 대상 산출

전체 Production 과거 데이터를 무작정 재처리하지 않는다.

다음 범위에서 아이·날짜별 상태 매트릭스를 만든다.

```text
기간: 2026-07-29 ~ 2026-08-02
기준: 실제 chat_messages가 존재하는 아이·날짜
```

각 아이·날짜별로 다음을 확인한다.

```text
chat_messages
raw_daily_conversations_v3
corrected_daily_conversations_v3
memory_facts / evidence / embeddings
daily_reports
pipeline_jobs
```

결과에 따라 다음처럼 이어서 처리한다.

## Case A: Source만 존재

```text
chat_messages 있음
Raw 없음
→ Collection부터 실행
```

## Case B: Raw까지만 존재

```text
Raw 있음
Corrected 없음
→ Context Correction부터 실행
```

## Case C: Corrected까지만 존재

```text
Corrected 있음
Memory 없음
Report 없음
→ Memory Batch와 Daily Report 실행
```

## Case D: Memory만 누락

```text
Corrected 있음
Report 있음
Memory 없음
→ Memory Batch만 실행
```

## Case E: Report만 누락

```text
Corrected 있음
Memory 있음
Report 없음
→ Daily Report만 실행
```

## Case F: 전체 완료

```text
Raw 있음
Corrected 있음
Memory/정상 0건 판정 있음
Report 있음
→ 재처리하지 않음
```

Memory Fact 0건은 실패와 구분한다.

```text
Memory Batch completed + Fact 0건
→ 정상 0건

Memory Batch failed/not_run + Fact 0건
→ 복구 대상
```

---

# 8. 필수 계정 복구

## 8.1 안서아

기간:

```text
2026-07-29 ~ 2026-08-02
```

실제 대화가 있는 날짜만 처리한다.

- Source 메시지 존재 여부 확인
- 누락 Collection 실행
- Raw 생성 또는 기존 Raw 재사용
- Context Correction
- Memory Batch
- Daily Report

## 8.2 안서현

기간:

```text
2026-07-29 ~ 2026-08-02
```

안서아와 동일 원칙으로 처리한다.

8월 2일 잘못 생성된 정체 Daily Report Job은 이력으로 보존하고, 새 실행에서 올바른 앞단부터 처리한다.

## 8.3 윤도원

날짜:

```text
2026-08-02
```

기존 Raw가 정상이라면 Collection을 다시 하지 않는다.

```text
기존 Raw 약 68개 메시지 검증
→ 개선된 Context Correction 실행
→ Corrected 전체 메시지 저장
→ Memory Batch
→ Daily Report
```

기존 실패 Job은 삭제하지 않는다.

## 8.4 윤도건

날짜:

```text
2026-08-02
```

이미 정상 완료됐으므로 재처리하지 않는다.

기존 결과가 변경되지 않았는지만 확인한다.

---

# 9. Memory Batch 및 LLM Wiki 정상화

입력:

```text
corrected_daily_conversations_v3
```

출력:

```text
memory_facts
memory_evidence
memory_embeddings
memory_entities
memory_relations
```

필수 조건:

- Fact별 Evidence 연결
- Fact별 Embedding 연결
- Embedding 모델 `gemini-embedding-001`
- 해당 `child_id`에 정확히 귀속
- 같은 Fact 중복 생성 금지
- 고아 Evidence 0건
- 고아 Embedding 0건
- 재실행 시 기존 완료 결과 재사용
- 멱등성 키 충돌 또는 누락 방지

기억할 Fact가 없는 날짜는 정상 0건으로 완료 처리한다.

---

# 10. Daily Report 정상화

Daily Report는 Corrected 데이터가 존재하면 생성할 수 있어야 한다.

필수 조건:

- Memory Batch 성공 시 정상 순서대로 실행
- Memory Batch 실패 시에도 별도 실패 기록 후 Report 생성 계속
- 같은 아이·날짜 Report 중복 생성 금지
- 기존 Report가 정상이라면 재생성하지 않음
- 관리자 화면과 DB 상태 일치
- 실패 원인과 실제 최초 실패 단계 표시

---

# 11. 2026-08-03부터 자동 실행 정상화

## 11.1 자동 스케줄

Vercel Cron을 사용한다면 UTC 기준으로 설정한다.

```text
17:55 KST = 08:55 UTC
23:55 KST = 14:55 UTC
```

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

실제 사용 중인 API 규격에 맞춰 경로는 조정할 수 있으나 시간과 Phase 의미는 변경하지 않는다.

## 11.2 Phase 1

```text
mission_1 + free_chat_1 수집
→ Raw에 누적
→ 종료
```

Phase 1에서는 다음을 실행하면 안 된다.

```text
Context Correction
Memory Batch
Daily Report
```

## 11.3 Phase 2

```text
mission_2 + free_chat_2 수집
→ 동일 Raw에 누적
→ Context Correction 1회
→ Memory Batch
→ Daily Report
```

## 11.4 Cron 인증

- `CRON_SECRET` 적용
- `Authorization: Bearer <CRON_SECRET>` 검증
- 인증 실패 시 `401`
- Secret 값 로그 출력 금지
- Production 환경변수로만 관리

## 11.5 Legacy 충돌 방지

기존 Legacy Cron과 신규 V3 Cron이 같은 데이터를 동시에 처리하면 안 된다.

Production 변경 직전에 최소한의 Cron 조회만 수행한다.

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

충돌하는 Legacy Cron만 비활성화한다.

- 삭제 금지
- 기존 설정 기록
- Rollback SQL 작성
- 관련 없는 Cron 변경 금지

---

# 12. Retrieval 정상화

Memory Batch에서 생성한 LLM Wiki가 다음 대화에서 실제 사용돼야 한다.

```text
현재 아이 발화
→ gemini-embedding-001
→ child_id 범위 memory_facts 검색
→ 관련 Fact Top-K
→ Gemini Prompt 내부 기억 컨텍스트 주입
→ 케이 응답
```

적용 대상:

- 미션 대화
- 자유대화
- 자동 마이크
- 수동 마이크

Fallback:

```text
V3 Memory 있음
→ V3 사용

V3 Memory 없음
→ 기존 child_memory Fallback
```

V3와 Legacy Memory를 동시에 중복 주입하지 않는다.

---

# 13. Production 기존 데이터 보존

기존 Production Memory 데이터는 반드시 유지한다.

Antigravity 확인값:

```text
memory_facts: 5건
memory_evidence: 7건
memory_embeddings: 7건
embedding model: gemini-embedding-001
```

작업 후에도 다음을 보장한다.

- 기존 Fact ID 변경 0건
- 기존 Evidence 삭제 0건
- 기존 Embedding 삭제 0건
- 전체 Memory 초기화 금지
- 전체 과거 데이터 무차별 Backfill 금지
- 선택 복구 과정에서 중복 Fact 생성 금지

---

# 14. 배포 순서

```text
1. 확인된 코드 문제 수정
2. 정식 Migration 정리
3. Dev에 변경분 배포
4. 변경분 중심 제한 회귀 테스트
5. Production 기존 데이터 보존값 기록
6. Production DB 백업 또는 복구 지점 확인
7. Production Migration 적용
8. Production 앱·Worker 배포
9. CRON_SECRET 설정
10. V3 Cron 활성화
11. 충돌 Legacy Cron 비활성화
12. 2026-07-29~2026-08-02 누락 데이터 선택 복구
13. 필수 4개 계정 결과 확인
14. 오늘 이후 자동 운영 확인
```

Dev에서 Antigravity가 이미 검증한 전체 E2E를 처음부터 반복하지 않는다. 이번 변경에 영향을 받은 항목만 회귀 검증한다.

---

# 15. 완료 기준

## 기존 누적 데이터

- 실제 `chat_messages`가 존재하는 2026-07-29~2026-08-02 아이·날짜 전수 처리
- Raw 누락분 복구
- Corrected 누락·실패분 복구
- Memory Batch 누락·실패분 복구
- Daily Report 누락·실패분 복구
- 정상 완료 데이터 재생성 0건
- 중복 Fact·Evidence·Embedding 0건
- 고아 Evidence·Embedding 0건

## 필수 계정

- 안서아: 대화가 있는 날짜 모두 정상
- 안서현: 대화가 있는 날짜 모두 정상
- 윤도원 2026-08-02 정상
- 윤도건 2026-08-02 기존 정상 결과 유지

## 자동 운영

- 17:55 Phase 1 자동 실행
- 23:55 Phase 2 자동 실행
- Phase 1 후 후속 Job 0건
- Phase 2 후 Context Correction 정확히 1회
- Memory Batch 실행
- Daily Report 실행
- 아이별 실패 격리
- 실패 아이만 재시도 가능
- 다른 아이 파이프라인 계속 진행
- 관리자 수동 실행 정상

## Retrieval

- 미션 Retrieval 정상
- 자유대화 Retrieval 정상
- Gemini Prompt 주입 정상
- Legacy 중복 주입 없음

---

# 16. 금지사항

- Antigravity가 수행한 전체 감사 반복 금지
- Production 전체 데이터 삭제 금지
- 전체 Memory 초기화 금지
- 전체 과거 데이터 무차별 재처리 금지
- 정상 완료 날짜 재처리 금지
- 윤도건 2026-08-02 재처리 금지
- 기존 실패 이력 삭제 금지
- Secret 평문 출력 금지
- 일반 사용자 대화 원문 로그 출력 금지
- 문제를 수정하지 않고 원인 보고만 한 뒤 종료 금지

확인된 문제는 실제 코드 수정·Production 배포·기존 데이터 복구·자동 실행 검증까지 완료한다.

---

# 17. 최종 보고 형식

## 1. 최종 판정

```text
기존 누적 데이터 복구: PASS / FAIL
2026-08-03 이후 자동 운영: PASS / FAIL
Production 전체 파이프라인: PASS / FAIL
```

## 2. 변경 파일

- 파일 경로
- 변경 내용

## 3. Migration

- 파일명
- Dev 적용 결과
- Production 적용 결과
- Rollback 방법

## 4. 기존 누적 데이터 복구 결과

| 아이 | 날짜 | Source | Raw | Corrected | Memory | Report | 결과 |
|---|---|---|---|---|---|---|---|

## 5. 필수 계정 결과

### 안서아

```text
대상 날짜:
복구 날짜:
정상 완료 날짜:
실패 날짜:
```

### 안서현

동일 형식.

### 윤도원

```text
2026-08-02 Raw 메시지:
Corrected 메시지:
원문 Fallback:
Memory Facts:
Daily Report:
최종 결과:
```

### 윤도건

```text
기존 결과 유지:
중복 생성:
데이터 변경:
```

## 6. 자동 실행

```text
17:55 Phase 1:
23:55 Phase 2:
Cron 인증:
Legacy 충돌:
최근 실행 결과:
```

## 7. Memory 및 LLM Wiki

```text
신규 Fact:
신규 Evidence:
신규 Embedding:
Embedding 모델:
중복:
고아 데이터:
```

## 8. Daily Report

```text
복구 Report:
신규 자동 Report:
중복 Report:
실패 Report:
```

## 9. 기존 Production 데이터 보존

```text
기존 memory_facts 5건:
기존 memory_evidence 7건:
기존 memory_embeddings 7건:
기존 ID 변경:
```

## 10. 남은 문제

없으면 다음과 같이 작성한다.

```text
남은 문제 없음
```