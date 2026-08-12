# 065 - Production 미수집 데이터 복구 및 `business_date NULL` 재발 방지

## 1. 작업 목적

이번 작업은 아래 두 축을 모두 완료한다.

### 축 1. 기존 장애 데이터 복구
2026-08-03 Production에서 실제 대화는 저장됐지만 Collection 이후 단계가 실행되지 않은 모든 사용자를 찾아 아래 전체 파이프라인을 복구한다.

```text
chat_messages
→ Collection
→ raw_daily_conversations_v3
→ Context Correction
→ corrected_daily_conversations_v3
→ Memory Batch
→ LLM WIKI
→ Daily Report
```

### 축 2. 재발 방지
미션·자유대화 세션의 `business_date`가 NULL로 저장되는 모든 생성 경로를 수정하고, DB와 Collection RPC에 이중 방어를 추가해 다음 날부터 같은 장애가 재발하지 않도록 한다.

단순히 2026-08-03 데이터를 수동 수집한 뒤 종료하지 않는다. 기존 데이터 복구와 구조적 원인 수정이 모두 완료돼야 한다.

---

## 2. 현재 확인된 장애

2026-08-03 Production에서 다음이 확인됐다.

```text
chat_sessions: 19개
chat_messages: 299개
아이 발화: 152개
```

실사용자 세션 다수의 상태:

```text
chat_sessions.business_date = NULL
```

자동 Collection 대상 선정 RPC는 `business_date = 대상 날짜` 조건으로 세션을 조회하기 때문에 NULL 세션이 모두 제외됐다.

```text
대화 저장 성공
→ business_date NULL
→ Collection 대상 선정 실패
→ collection_1·collection_2 Job 미생성
→ Raw 미생성
→ Context Correction 미실행
→ Memory Batch·LLM WIKI 미실행
→ Daily Report 미생성
```

화면에서 `대화수집 X`, `리포트 X`로 확인된 계정에는 TestA뿐 아니라 고나연, 고보강, 박서아, 박서현, 안서아, 안서현, 안예원, 윤도건, 윤도원 등이 포함된다. 이 목록만 하드코딩하지 말고, 2026-08-03 실제 대화가 존재하면서 V3 결과가 누락된 전체 아이를 대상으로 한다.

---

## 3. Claude Code 역할

Claude Code는 다음을 직접 수행한다.

- 관련 코드 수정
- Migration 작성
- Dev 적용 및 검증
- Production 안전 배포
- 기존 NULL 세션 날짜 복구
- 누락 파이프라인 재실행
- 멱등성·데이터 보존 검증
- 최종 결과 보고

Antigravity가 수행한 전체 진단을 다시 반복하지 말고, 필요한 최소 조회 후 바로 수정·복구한다.

---

## 4. 절대 준수사항

1. 기존 `chat_messages` 삭제 금지
2. 사용자에게 대화를 다시 하게 만들지 않음
3. 기존 정상 Raw·Corrected·Memory·Report 삭제 금지
4. 기존 실패 Job 이력 삭제 금지
5. 전체 Production 무차별 재수집 금지
6. 실제 누락된 아이·날짜만 선택 복구
7. 중복 Raw·Fact·Evidence·Embedding·Report 생성 금지
8. Production Memory 전체 초기화 금지
9. Secret·DB 비밀번호·서비스 역할 키 평문 출력 금지
10. 아이 대화 원문 전체 로그 출력 금지
11. 관련 없는 요청 문서·UI 파일 수정 금지
12. 원인 보고만 하고 종료 금지
13. Dev 검증 없이 Production 적용 금지

---

# 축 1. 기존 장애 데이터 복구

## 5. 복구 대상 산출

Production에서 2026-08-03 기준으로 다음 조건의 아이·날짜를 모두 찾는다.

```text
chat_messages 존재
AND (
  Raw 없음 또는 불완전
  OR Corrected 없음 또는 실패
  OR Memory Batch 없음 또는 실패
  OR Daily Report 없음 또는 실패
)
```

아이·날짜별로 다음 표를 만든다.

| 아이 | child_id | Source 메시지 | Raw | Corrected | Memory | Report | 시작 단계 |
|---|---|---:|---|---|---|---|---|

처리 기준:

```text
Source 있음 + Raw 없음
→ Collection부터

Raw 있음 + Corrected 없음
→ Context Correction부터

Corrected 있음 + Memory 없음
→ Memory Batch부터

Corrected 있음 + Report 없음
→ Daily Report만 실행

전체 완료
→ 재처리 금지
```

---

## 6. 기존 NULL 세션의 날짜 복구

2026-08-03에 생성된 `business_date IS NULL` 세션만 KST 기준으로 복구한다.

기준:

```sql
(started_at AT TIME ZONE 'Asia/Seoul')::date
```

필수 원칙:

- KST 기준 `started_at` 날짜 사용
- UTC 날짜 문자열을 그대로 사용하지 않음
- 다른 날짜 세션을 8월 3일로 일괄 변경 금지
- 이미 `business_date`가 있는 세션 변경 금지
- 변경 전 대상 세션 수와 ID 기록
- 변경 후 NULL 잔여 수 확인
- Rollback SQL 또는 복구 방법 작성

---

## 7. Collection 복구

날짜 복구 후 실제 대화가 있는 아이만 Collection을 실행한다.

정책:

```text
Phase 1
→ mission_1 + free_chat_1

Phase 2
→ mission_2 + free_chat_2
→ 같은 child_id + business_date Raw에 병합
```

과거 날짜 복구 시 실제 메시지 생성 시각·세션 유형·미션 Phase를 기준으로 Section을 정확히 분류한다.

PASS 기준:

```text
Raw record count = 아이·날짜당 1건
Source 메시지 누락 = 0
source_message_id 중복 = 0
다른 아이 메시지 혼입 = 0
```

기존 Raw가 일부 있으면 삭제·재생성하지 말고 누락 메시지만 추가한다.

---

## 8. Context Correction 복구

Raw가 완성된 아이만 실행한다.

PASS 기준:

```text
Raw 메시지 수 = Corrected 메시지 수
중복 Corrected 메시지 = 0
누락 메시지 = 0
MESSAGE_COUNT_MISMATCH = 없음
```

메시지가 많으면 기존 Chunk 처리와 `source_message_id` 병합을 사용한다. Gemini 반환 누락은 원문 Fallback으로 처리한다.

기존 실패 Job은 보존하고 새 `execution_id`로 재처리한다.

---

## 9. Memory Batch 및 LLM WIKI 복구

Corrected 데이터가 정상인 아이만 실행한다.

대상:

```text
memory_facts
memory_evidence
memory_embeddings
memory_entities
memory_relations
```

필수 조건:

```text
Embedding model = gemini-embedding-001
Fact child_id 정확
Fact별 Evidence 연결
검색 대상 Fact별 Embedding 연결
고아 Evidence = 0
고아 Embedding = 0
동일 Fact 중복 = 0
```

기억할 내용이 없으면:

```text
Memory Job completed + Fact 0건
→ NORMAL_ZERO_FACT
```

실패와 정상 0건을 구분한다.

---

## 10. Daily Report 복구

Corrected 데이터가 정상인 아이·날짜에 Daily Report를 생성한다.

PASS 기준:

```text
child_id 정확
report_date = 2026-08-03
아이·날짜별 Report 1건
중복 Report 0건
부모 화면에서 조회 가능
```

Memory Batch 실패가 있더라도 Corrected가 정상이면 Report는 독립적으로 생성되도록 기존 정책을 유지한다.

---

## 11. 관리자 화면 반영

복구 후 2026-08-03 관리자 화면에서 실제 DB 상태와 표시가 일치해야 한다.

정상 예:

```text
대화수집: O
리포트: 생성 시각 및 버전 표시
N/8: 실제 결과 표시
```

DB는 정상인데 화면이 계속 `X`면 조회 API 또는 표시 로직도 수정한다.

---

# 축 2. `business_date NULL` 재발 방지

## 12. 모든 세션 생성 경로 조사

`chat_sessions`를 INSERT/UPSERT하는 모든 경로를 찾아 수정한다.

반드시 확인:

- 미션 자동 마이크
- 미션 수동 마이크
- 자유대화 자동 마이크
- 자유대화 수동 마이크
- 미션 시작
- 자유대화 시작
- 세션 재진입·복원
- Live 세션
- 비Live 세션
- Premium 세션
- 일반 세션
- 관리자·QA 테스트 세션
- 기타 `chat_sessions` 생성 경로

최종 보고서에 실제 파일과 함수 목록을 적는다. 한두 군데만 수정하고 종료하지 않는다.

---

## 13. 애플리케이션 저장 로직 수정

모든 신규 세션 생성 시 `business_date`를 명시적으로 저장한다.

기준:

```text
Asia/Seoul 기준 세션 시작 날짜
```

서버 UTC 시간을 문자열로 잘라 날짜를 만들지 않는다. 반드시 `Asia/Seoul` 변환 후 날짜를 계산한다.

재진입·복원 시:

- 기존 세션은 기존 `business_date` 유지
- 새 세션은 새 세션 시작 시각의 KST 날짜 사용
- 과거 세션을 오늘 날짜로 덮어쓰지 않음

---

## 14. DB 방어 로직

애플리케이션 누락이 재발해도 NULL이 저장되지 않도록 DB 방어를 추가한다.

권장 순서:

```text
1. 기존 NULL 데이터 정리
2. BEFORE INSERT/UPDATE Trigger 또는 동등한 DB 로직
3. 가능한 경우 business_date NOT NULL 제약
```

Trigger 의미:

```text
NEW.business_date가 NULL이면
→ NEW.started_at 또는 NOW()를 Asia/Seoul 기준 날짜로 변환
→ business_date 설정
```

조건:

- `started_at`이 있으면 우선 사용
- 없을 때만 `NOW()` 사용
- 기존 정상 날짜 덮어쓰기 금지
- KST 날짜 경계 검증
- Rollback 작성

---

## 15. `enqueue_collection_jobs_v3` NULL 방어

RPC가 `business_date`만 신뢰하지 않도록 수정한다.

의미상 다음 조건을 포함한다.

```sql
business_date = p_business_date
OR (
  business_date IS NULL
  AND (started_at AT TIME ZONE 'Asia/Seoul')::date = p_business_date
)
```

추가 조건:

- 동일 아이·날짜 Job 중복 생성 금지
- 기존 completed Job 재생성 금지
- NULL Fallback 세션도 올바른 Phase 분류
- `cutover_at` 조건과 충돌 금지
- 다른 날짜 NULL 세션 혼입 금지

이 로직은 과거 데이터 복구용이자 향후 누락에 대한 2차 안전장치다.

---

## 16. NULL 감지 운영 장치

최소한 다음을 감지할 수 있게 한다.

```text
최근 24시간 chat_sessions.business_date IS NULL > 0
→ 오류 로그 또는 관리자 경고
```

조건:

- 대화 원문 로그 금지
- child_id 마스킹
- Secret 출력 금지
- 과도한 모니터링 기능 확장 금지

---

# Dev 검증

## 17. Dev 적용 순서

```text
1. 코드 수정
2. Migration 작성
3. 타입 검사
4. 관련 단위 테스트
5. Dev DB Migration 적용
6. Dev 앱·API·Worker 배포
7. Dev 배포 Commit 확인
```

---

## 18. Dev 신규 미션 세션

기존 QA 계정으로 실제 미션을 시작한다.

확인:

```text
business_date = 오늘 KST 날짜
business_date NULL 아님
session_type 정상
mission_phase 정상
started_at KST 날짜와 business_date 일치
```

자동·수동 마이크가 다른 경로면 각각 확인한다.

---

## 19. Dev 신규 자유대화 세션

기존 QA 계정으로 실제 자유대화를 시작한다.

확인:

```text
business_date = 오늘 KST 날짜
business_date NULL 아님
session_type = free_chat
started_at KST 날짜와 business_date 일치
```

자동·수동 마이크가 다른 경로면 각각 확인한다.

---

## 20. KST 날짜 경계 테스트

최소 다음 케이스를 단위 테스트 또는 함수 테스트로 검증한다.

```text
KST 00:00 직후
KST 23:59 근처
UTC 날짜와 KST 날짜가 다른 시간대
```

PASS:

```text
business_date는 항상 Asia/Seoul 기준 날짜
```

---

## 21. Dev 수동 E2E

기존 QA 계정으로 다음 전체 흐름을 실행한다.

```text
실제 미션 또는 자유대화
→ business_date 확인
→ 관리자 수집 후 리포트 즉시 생성
→ Collection
→ Raw
→ Corrected
→ Memory Batch
→ LLM WIKI
→ Daily Report
```

PASS:

```text
신규 세션 business_date NULL = 0
Collection Job 생성
Raw 생성
Corrected 생성
Memory 완료 또는 NORMAL_ZERO_FACT
Daily Report 생성
관리자 화면 대화수집 O
관리자 화면 리포트 표시
```

---

# Production 적용

## 22. Production 배포 전 스냅샷

기록:

```text
2026-08-03 business_date NULL 세션 수
2026-08-03 대화가 있는 아이 수
기존 Raw 수
기존 Corrected 수
기존 memory_facts 수
기존 memory_evidence 수
기존 memory_embeddings 수
기존 daily_reports 수
```

기존 ID 목록 또는 해시를 보관한다.

---

## 23. Production 적용 순서

```text
1. 백업 또는 복구 지점 확인
2. Migration 적용
3. 기존 NULL 세션 날짜 선택 복구
4. 앱·API·Worker 배포
5. enqueue_collection_jobs_v3 적용 확인
6. 2026-08-03 복구 대상 산출
7. 누락 단계부터 파이프라인 재실행
8. 관리자 화면 결과 확인
9. 기존 데이터 보존·중복 검증
10. 신규 세션 business_date 검증
```

---

## 24. Production 복구 PASS 기준

2026-08-03 실제 대화가 있는 모든 아이에 대해 다음 표를 작성한다.

| 아이 | Source | business_date | Raw | Corrected | Memory | Report | 결과 |
|---|---:|---|---|---|---|---|---|

PASS:

```text
Source가 있는 아이 전부 business_date 정상
누락 Raw 복구
누락 Corrected 복구
Memory 완료 또는 NORMAL_ZERO_FACT
Daily Report 생성
중복 0
기존 데이터 삭제 0
```

---

## 25. 신규 Production 세션 확인

배포 후 새로 생성되는 첫 미션·자유대화 세션을 확인한다.

```text
business_date NULL 아님
KST 날짜 정확
Collection 대상 포함 가능
```

일반 사용자에게 강제로 테스트 대화를 생성하지 않는다. 안전한 Production QA 계정 또는 실제 신규 사용 데이터를 읽기 전용으로 확인한다.

---

## 26. Cron 확인

직접 원인은 `business_date NULL`이지만 자동 운영 검증을 위해 다음을 분리해 확인한다.

```text
Cron 호출 자체
RPC 대상 아이 선정
Job 생성
```

확인:

- 17:55 Phase 1 호출
- 23:55 Phase 2 호출
- HTTP 상태
- 인증 성공
- 대상 아이 수
- 생성 Job 수

Job 0건만 보고 Cron 미실행이라고 단정하지 않는다. Cron 성공만 보고 Collection 정상이라고도 단정하지 않는다.

---

# 멱등성 및 데이터 보존

## 27. 동일 대상 재실행

동일 아이·날짜를 다시 실행해도 다음 증가가 없어야 한다.

```text
Raw 중복 증가 = 0
Corrected 중복 증가 = 0
Fact 중복 증가 = 0
Evidence 중복 증가 = 0
Embedding 중복 증가 = 0
Report 중복 증가 = 0
```

기존 정상 데이터 보존:

```text
기존 Raw 삭제 = 0
기존 Corrected 삭제 = 0
기존 Fact 삭제 = 0
기존 Evidence 삭제 = 0
기존 Embedding 삭제 = 0
기존 Report 삭제 = 0
```

---

# 28. 금지사항

- 2026-08-03 전체 세션 무조건 UPDATE
- KST 변환 없이 UTC 날짜 저장
- 특정 사용자만 하드코딩
- TestA만 복구
- Raw만 생성하고 종료
- Memory Batch·LLM WIKI·Report 생략
- 기존 Job 이력 삭제
- 기존 Memory 초기화
- 전체 날짜 무차별 Backfill
- 정상 결과 재생성
- 앱 코드 한 군데만 수정
- RPC만 수정하고 생성 모듈 방치
- 생성 모듈만 수정하고 과거 NULL 미복구
- Dev 검증 없이 Production 적용
- Secret 평문 출력
- 대화 원문 전체 로그 출력

---

# 29. 완료 기준

## 축 1 — 기존 장애 데이터 복구

```text
2026-08-03 실제 대화 사용자 전수 확인
기존 NULL 세션 KST 날짜 복구
Collection 완료
Raw 완료
Context Correction 완료
Memory 완료 또는 NORMAL_ZERO_FACT
LLM WIKI Fact/Evidence/Embedding 정상
Daily Report 완료
관리자 화면 반영
중복 0
기존 데이터 삭제 0
```

## 축 2 — 재발 방지

```text
모든 세션 생성 경로 business_date 저장
DB NULL 방어
가능한 경우 NOT NULL 제약
enqueue_collection_jobs_v3 NULL Fallback
Dev 신규 미션 PASS
Dev 신규 자유대화 PASS
KST 날짜 경계 PASS
Dev 수동 E2E PASS
Production 배포 PASS
Production 신규 세션 NULL 0
Cron과 Job 생성 분리 검증
```

두 축이 모두 PASS해야 완료다.

---

# 30. 최종 보고 형식

## 최종 판정

```text
축 1 기존 데이터 복구: PASS / FAIL
축 2 NULL 재발 방지: PASS / FAIL
Production 전체 결과: PASS / FAIL
```

## 원인

```text
직접 원인:
영향 범위:
데이터 유실 여부:
최초 장애 단계:
```

## 변경 파일

| 파일 | 변경 내용 | Dev 배포 | Production 배포 |
|---|---|---|---|

## Migration

```text
Migration 파일:
기존 NULL 복구 SQL:
Trigger/Default:
NOT NULL:
RPC 변경:
Rollback:
```

## 세션 생성 경로

| 기능 | 생성 파일/함수 | business_date 적용 | 검증 |
|---|---|---|---|
| 미션 자동 마이크 | | | |
| 미션 수동 마이크 | | | |
| 자유대화 자동 마이크 | | | |
| 자유대화 수동 마이크 | | | |
| 세션 재진입·복원 | | | |
| Live | | | |
| 비Live | | | |
| QA/관리자 | | | |

## Production 복구 결과

| 아이 | 날짜 | Source | business_date | Raw | Corrected | Memory | Report | 결과 |
|---|---|---:|---|---|---|---|---|---|

## 복구 숫자

```text
복구 전 NULL 세션:
복구 후 NULL 세션:
복구 대상 아이:
Collection 완료:
Corrected 완료:
Memory 완료:
NORMAL_ZERO_FACT:
Report 완료:
실패:
```

## 데이터 무결성

```text
Raw 중복:
Corrected 중복:
Fact 중복:
Evidence 중복:
Embedding 중복:
Report 중복:
고아 Evidence:
고아 Embedding:
기존 데이터 삭제:
```

## Dev 검증

```text
신규 미션 business_date:
신규 자유대화 business_date:
자동 마이크:
수동 마이크:
KST 날짜 경계:
관리자 수동 E2E:
```

## Production 자동 운영

```text
17:55 Cron 호출:
Phase 1 Job 생성:
23:55 Cron 호출:
Phase 2 Job 생성:
Context Correction:
Memory Batch:
Daily Report:
```

## 남은 문제

없으면:

```text
남은 문제 없음
```

문제가 남으면:

```text
최초 실패 단계:
확정 원인:
영향 사용자:
영향 날짜:
관련 Job:
관련 로그:
수정 대상:
다음 조치:
```
