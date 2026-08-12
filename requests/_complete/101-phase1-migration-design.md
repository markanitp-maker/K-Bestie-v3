# Phase 1: DB 마이그레이션 설계 및 영향 분석 (v3 격리 모델)

## 1. 개요
현재 Dev DB는 새로운 파이프라인(Collection/Correction/Memory/Report)의 데이터 요구사항(1일 1행, JSONB 4영역)과 기존 구조(1메시지 1행)가 심각하게 충돌합니다. 실제로 `raw_daily_conversations` 테이블에는 특정 아이의 하루치 데이터가 최대 23행까지 중복 저장되어 있습니다.

이에 따라 기존 테이블을 변경·강제 덮어쓰기·자동삭제하지 않고, 완전히 분리된 **신규 파이프라인 전용 v3 테이블(`raw_daily_conversations_v3`, `corrected_daily_conversations_v3`)**을 생성하는 Additive Migration(추가형 마이그레이션) 방식을 채택합니다.

---

## 2. v3 전용 신규 스키마 설계

### A. 미션 I/II 분류를 위한 `mission_phase` 도입 (대표님 승인 반영)
- 기존의 시간(`created_at`) 기반 추론을 폐기하고, `chat_sessions` 테이블에 `mission_phase INT CHECK (mission_phase IN (1, 2))` 컬럼을 추가합니다.
- 미션 세션 시작 API(검증된 서버 경로)에서 KST 유효 시간을 검증하여 1 또는 2를 확정 기록합니다.
- 자유 대화(free_chat) 세션인 경우 `mission_phase`는 NULL을 유지합니다.
- 클라이언트나 일반 사용자가 이를 임의 변경할 수 없도록, RLS 정책 및 DB 레벨 권한 설정을 준수합니다.

### B. `raw_daily_conversations_v3`
- `child_id` + `business_date` 기준 **UNIQUE(1일 1건) 저장 구조**를 강제합니다.
- 컬럼 구조:
  - `id`: UUID PRIMARY KEY
  - `child_id`: UUID FK (auth.users) ON DELETE CASCADE
  - `business_date`: DATE
  - `mission_1`, `free_chat_1`, `mission_2`, `free_chat_2`: JSONB (DEFAULT '[]'::jsonb)
  - `collection_1_status`, `collection_2_status`: ENUM ('pending', 'completed', 'failed')
  - `collection_1_cutoff`, `collection_2_cutoff`: TIMESTAMPTZ (수집 마감 시각 기록용)
  - `created_at`, `updated_at`: TIMESTAMPTZ

### C. JSONB 내부 중복 방지 및 정렬 보장 방식 검토 (딥 인터뷰 질문 포함)
DB 트랜잭션 단위로 완벽한 유일성과 원자성을 보장하기 위해 두 가지 방안을 검토했습니다.

- **옵션 A (JSONB RPC 병합)**: 신규 수집 시 Postgres RPC 내부에서 기존 JSONB 배열을 해제(`jsonb_array_elements`)하고 신규 메시지와 합친 뒤, `message_id` 기준으로 중복을 제거하고 `created_at`으로 정렬 후 다시 JSONB 배열(`jsonb_agg`)로 묶어 저장하는 방식입니다. 
  - 장점: 설계된 JSONB 스키마 구조(v3 테이블 1건)를 정확히 유지합니다.
  - 단점: RPC 로직이 다소 복잡해집니다.
- **옵션 B (정규화 연결 테이블 신설)**: `raw_daily_conversation_messages_v3` 라는 보조 테이블을 하나 더 만들어 `raw_v3_id`와 `message_id`를 UNIQUE로 강제(100% 중복 원천 차단)한 뒤, 조회 시 배열로 합쳐서 쓰는 방식입니다.
  - 장점: RDBMS의 정통적인 방식으로 가장 안전하게 무결성과 정렬을 강제할 수 있습니다.
  - 단점: **현재 "4영역 JSONB"로 확정된 구조 설계와 정면 충돌**하여 스키마가 크게 변경됩니다.
- **현재 권장안 및 질문**: 정합성을 가장 우선한다면 옵션 B(정규화 연결 테이블 추가)가 RDBMS상 가장 이상적입니다. 기존 확정 설계(JSONB)를 파기하고 옵션 B로 스키마를 변경할지, 아니면 옵션 A(RPC 기반 JSONB 병합)를 사용하여 기존 설계를 유지할지 대표님 결정이 필요합니다.

### D. `corrected_daily_conversations_v3`
- 컬럼 구조:
  - `id`: UUID PRIMARY KEY
  - `raw_daily_conversation_v3_id`: UUID FK ON DELETE CASCADE
  - `child_id`: UUID FK (auth.users) ON DELETE CASCADE
  - `business_date`: DATE
  - `mission_1`, `free_chat_1`, `mission_2`, `free_chat_2`: JSONB
  - `correction_status`: ENUM ('pending', 'processing', 'completed', 'failed')
  - `attempt_count`: INT, `last_error_code`: TEXT
  - `started_at`, `completed_at`, `created_at`, `updated_at`: TIMESTAMPTZ
  - UNIQUE(child_id, business_date)

### E. `pipeline_jobs` (작업 큐 및 분산 제어)
- **생성 순서 보장**: FK 의존성을 위해 `chat_messages` 컬럼 추가(ALTER) 이전에 생성되도록 DDL 순서를 조정했습니다.
- 컬럼 구조:
  - `job_type`, `child_id`, `business_date`, `source_record_id`
  - `status` ('pending', 'claimed', 'completed', 'failed')
  - `idempotency_key` (UNIQUE) - 중복 생성 원천 차단
  - `next_retry_at`, `claimed_at`, `claimed_by`, `attempt_count`
- **Worker Claim 로직 (`FOR UPDATE SKIP LOCKED`)**:
  - `claim_pipeline_jobs` RPC를 통해 다중 워커가 동시에 접근해도 Lock 대기 없이 즉시 가용한 작업을 선점합니다.
  - **보안**: `SECURITY DEFINER`, `SET search_path = public`, 그리고 명시적인 `REVOKE ALL ON FUNCTION ... FROM PUBLIC`을 통해 일반 사용자의 호출을 원천 차단했습니다.

### F. `chat_messages` (기존 구조 호환)
- 기존 컬럼, FK, PK를 전혀 훼손하지 않습니다.
- 추가 컬럼: 
  - `collected_at` (TIMESTAMPTZ)
  - `collection_batch_id` (UUID FK REFERENCES pipeline_jobs(id) ON DELETE SET NULL)
    - 삭제 정책: Job 이력이 삭제되더라도 추적 정보(UUID)만 NULL로 변경될 뿐 메시지 자체는 훼손되지 않습니다.
- 인덱스: `CREATE INDEX idx_chat_messages_uncollected ON chat_messages(created_at) WHERE collected_at IS NULL;`

---

## 3. Legacy (기존) 데이터 처리 및 과거 메시지 백필(Backfill) 배제

### A. 과거 데이터(NULL mission_phase) 현황
- Dev DB 조회 결과, 현재 `chat_messages` 테이블에는 총 **100건**의 메시지가 있으며, 그 중 **78건**이 미션 세션에서 발생했습니다.
- 새로운 `mission_phase` 컬럼이 추가되면 기존의 78건 메시지가 속한 세션의 값은 모두 NULL이 됩니다.

### B. 처리 원칙: 철저한 분리 (Backfill 배제)
- 기존 데이터에 대해 시간 기반의 임의 Backfill을 수행하여 1 또는 2를 채워 넣지 않습니다.
- v3 론칭 시점 이후에 수집기(Collection)가 작동할 때, **`mission_phase`가 NULL인 기존 미션 세션은 아예 무시(처리 대상 제외)**하도록 로직을 설계합니다. 
- 이를 통해 신규 파이프라인(v3)은 오직 완벽한 `mission_phase` 식별자가 달린 새로운 대화만을 적재하게 되어 데이터 정합성이 보장됩니다.
- 기존 Legacy Retention 크론이 동작하지 않고 있음을 확인했으며, 기존 데이터는 구형 대시보드 열람용으로 유지된 채 v3 로직에는 일절 관여하지 않게 됩니다.

---

## 4. 전환(Rollout) 방식 및 마이그레이션 실행 원칙
전환은 기존 애플리케이션 코드를 훼손하지 않으면서 점진적으로 진행됩니다.

1. **DB 마이그레이션 적용 단계**:
   - 기존 `schema_migrations` 테이블을 직접 조작하거나 실패한 마이그레이션 기록을 강제로 덮어쓰지 않습니다.
   - 겹치지 않는 새로운 타임스탬프 파일(`requests/20260801000000_add_pipeline_v3_tables.sql`)을 생성하여 정식 Supabase 마이그레이션 명령으로 Dev에 적용합니다.
   - API와 기존 배치는 여전히 Legacy 테이블을 바라보므로 서비스 중단이 발생하지 않습니다.
2. **코드 배포 단계**:
   - 새로운 Collection v3, Correction v3 코드를 배포합니다.
   - Memory Batch, Daily Report 역시 "v3 데이터"만 파라미터로 받아들여 동작하도록 강제합니다.
3. **전환 실패 시 롤백 (Forward Fix)**:
   - v3 코드 배포 후 치명적 오류 발생 시, 코드만 이전 커밋으로 롤백합니다. DB의 v3 테이블과 `pipeline_jobs`는 방치하더라도 구 버전 앱은 Legacy 테이블을 바라보므로 즉각적인 서비스 정상화가 보장됩니다.
   - 부분 실패가 발생하더라도 마이그레이션 기록을 조작하지 않고 수정 사항만 Forward Fix(새 마이그레이션 파일 추가)로 처리합니다.

---

## 5. 마이그레이션 적용 전/후 검증 쿼리

### 적용 전 검증 (사전 충돌 체크)
```sql
-- 1. chat_messages 총 건수 기록
SELECT COUNT(*) FROM chat_messages;

-- 2. 고아 메시지 및 session_type 누락 확인 (0이어야 함)
SELECT COUNT(*) FROM chat_messages cm
LEFT JOIN chat_sessions cs ON cm.session_id = cs.id
WHERE cs.id IS NULL OR cs.session_type IS NULL;
```

### 적용 후 검증 (정상 적용 체크)
```sql
-- 1. chat_messages 컬럼 유실 없이 건수 동일 확인
SELECT COUNT(*) FROM chat_messages;
SELECT COUNT(*) FROM chat_messages WHERE collected_at IS NOT NULL; -- 초기엔 0이어야 함

-- 2. 신규 컬럼 정상 추가 확인
SELECT mission_phase FROM chat_sessions LIMIT 1; -- (정상적으로 존재하는지 확인)

-- 3. 신규 테이블 및 권한 정상 확인
SELECT COUNT(*) FROM raw_daily_conversations_v3; -- 0이어야 함
SELECT COUNT(*) FROM pipeline_jobs; -- 0이어야 함

-- 4. UNIQUE 제약 테스트 (Unique Violation 에러 발생 시 정상)
INSERT INTO raw_daily_conversations_v3 (child_id, business_date) VALUES ('uuid-1', '2026-07-31');
INSERT INTO raw_daily_conversations_v3 (child_id, business_date) VALUES ('uuid-1', '2026-07-31');
```
