# K-Bestie-v3 대화 데이터 파이프라인 전체 설계서

## 1. 목적
아이와 케이의 미션 및 자유대화 원본을 안전하게 수집하고, 하루 단위로 문맥 보정한 뒤 LLM Wiki Memory Batch와 Daily Report를 상호 독립적이고 멱등성 있게 실행하기 위한 전체 데이터 파이프라인 및 백엔드 인프라 설계.

## 2. 확정 요구사항
- **실시간 저장**: 미션 및 자유대화는 `chat_messages`에 한 건씩 저장(`message_id`, `child_id`, `session_id`, `session_type`, `role`, `content`, `created_at`).
- **Collection (17:55, 23:55 KST)**: Gemini 호출이 없는 순수 DB 로직. `collected_at` 마킹과 원본 저장은 원자적 트랜잭션 보장.
- **장애로 늦게 수집된 메시지**: 재처리 날짜가 아니라 메시지가 실제 발생한 KST 날짜의 Raw에 소급 저장하며, 이미 처리된 날짜라면 해당 날짜의 재처리 상태를 생성한다.
- **23:55 이후 자유대화**: 다음 business_date의 `free_chat_1` 대상으로 처리하며, 당일 Daily Report에는 포함하지 않는다.
- **Context Correction (23:55 이후)**: 2차 수집 완료 후 하루 단위 `mission_1`, `free_chat_1`, `mission_2`, `free_chat_2` 전체를 한 번의 Gemini 호출로 보정. 메시지 누락, 변경 등 출력 검증 통과 시에만 저장.
- **분기 작업 격리**: `corrected_daily_conversations` 성공 후 Memory Batch와 Daily Report 작업은 상호 독립적으로 호출되며, 서로의 실패에 영향을 주지 않음.
- **배치 실행 구조**: `pipeline_jobs` 상태 테이블을 사용하여 아이별·날짜별 작업을 작은 Chunk Worker가 claim하여 처리한다 (단일 HTTP 순차 처리 구조 폐기).
- **LLM Wiki 범위 한정**: Corrected 저장 후 Memory Batch 호출 지점과 아이별 작업 상태만 구현하며, 내부 Fact/Evidence/Embedding/Retrieval 구현은 수정하지 않는다.
- **Cleanup 및 Retention**: 수집 성공한(`collected_at` IS NOT NULL) 원본 메시지 삭제. `raw_`, `corrected_` 테이블은 `business_date` 기준 7일 후 파기.
- **미션 시간 강제 종료 (최종 확정)**: 미션 I (10:00~17:49), 미션 II (18:00~23:49). 23:50이 되면 진행 중인 미션에 "미션 시간이 끝났어요" 안내 후 강제 종료. 종료 시각 이전까지 정상 저장된 메시지는 유지하며 23:55 2차 Collection에서 수집.

## 3. 현재 구조와 문제점
- **스키마 불일치 (Drift)**: Dev DB에 신규 4개 영역(mission_1 등) 및 상태 컬럼이 없으며, 마이그레이션이 제약 충돌로 실패함.
- **원자성 상실**: API 내 비동기 쿼리 2번으로 Collection이 분리되어 있어 실패 시 중복 수집 발생 위험.
- **UTC 타임존 버그**: KST 기준 오프셋 없이 날짜를 필터링하여 KST 오전 9시가 하루의 분기점이 되는 치명적 결함.
- **타임아웃 및 멱등성 파괴**: Correction 및 Memory 작업 시 전체 대상을 `for`문으로 동기 루프 처리하여 60초 타임아웃에 노출됨. 에러 복구 시나리오가 없어 수동 재시작 시 팩트 및 리포트가 무한 중복 생성됨.

## 4. 목표 전체 데이터 흐름
`chat_messages` (실시간 단건)
 → 1차(17:55)/2차(23:55) Collection (DB 원자성 보장)
 → `raw_daily_conversations` 누적 적재
 → 2차 완료 후 Context Correction 워커 실행
 → 출력 검증 후 `corrected_daily_conversations` 성공 마킹
 → (독립된 2개 이벤트/Queue 트리거 발생)
     ├── Memory Batch 워커 → `memory_facts`, `memory_embeddings` (LLM Wiki 영역)
     └── Daily Report 워커 → `daily_reports` 생성 (KST 04:00)
 → Cleanup 워커 (01:00 Chunk 처리) → `chat_messages` 단건 파기
 → Retention 워커 → 7일 경과 `raw_`, `corrected_` 파기

## 5. 환경별 Dev/Production 구조
- **Dev**: Vercel `kbestie-dev`, 현재 미커밋 코드와 DB 불일치 상태.
- **Production**: Vercel `k-bestie-v3`, 구버전 파이프라인 및 크론이 구동 중일 것으로 정황 확인. (보안 원칙에 따라 DB 직접 조회 불가하므로 "확인 불가"로 취급).

## 6. DB 스키마 변경안
**마이그레이션 원칙**: 기존 `schema_migrations` 기록을 조작하거나 덮어쓰지 않고, 안전한 Additive Migration(추가 마이그레이션)으로만 해결.

### Additive Migration 
- **`chat_messages`**: 기존 PK 유지. `session_type`, 미션 식별용 필드, `collected_at`, `collection_batch_id` 추가.
- **`raw_daily_conversations`**: `business_date` + `child_id` UNIQUE 인덱스. `mission_1`, `free_chat_1`, `mission_2`, `free_chat_2` (JSONB) 및 `collection_status`.
- **`corrected_daily_conversations`**: `mission_1`, `free_chat_1`, `mission_2`, `free_chat_2` (JSONB).
- **`pipeline_jobs` (신설)**: 
  - `job_type`, `child_id`, `business_date`, `source_record_id`, `status`
  - `attempt_count`, `next_retry_at`, `claimed_at`, `claimed_by`
  - `started_at`, `completed_at`, `last_error_code`, `idempotency_key`

## 7. Collection 상세 설계
- **시간 컷오프**: 실행 즉시 KST 현재 시각을 추출하고 이를 변수(`$cutoff`)로 고정하여 WHERE 절에 삽입. 
- **Atomic RPC**: `merge_collection_chunk` 등 Postgres 함수를 선언하여 1) 미수집 조회 2) raw_daily 갱신 3) chat_messages 업데이트를 단일 트랜잭션 내에서 처리.
- **중복 방지**: RPC 내에서 `message_id` 배열을 JSONB 배열에 병합 전 검사.

## 8. Context Correction 상세 설계
- **Trigger**: 2차 Collection 성공 완료 마킹 시 워커 대상 큐 편입.
- **단일 처리**: 아이 1명의 전체 Raw를 1회 Gemini 프롬프트로 전송. 모델 설정은 ADC/서버 환경변수 참조(하드코딩 배제).
- **검증 게이트**: 반환된 JSON에서 `message_id` Set을 원본과 비교. 일치하지 않을 경우 `failed` 처리 (Raw 보존).
- **Upsert 안전성**: 재시도 시 충돌 방지를 위해 `status='failed'` 인 Row만 덮어쓰도록 처리.

## 9. Memory Batch 연결 설계
- **호출 규격**: `corrected_daily_conversations`의 `business_date`, `child_id`, JSONB 내용 및 유일한 `idempotency_key`를 큐에 전달.
- **격리 원칙**: HTTP 에러나 타임아웃 발생 시 Memory Job Status만 `failed` 처리.

## 10. Daily Report 연결 설계
- **호출 규격**: `corrected_daily_conversations` 직통 연결. 04:00 크론이 `correction_status='completed'`이고 `report_status='pending'|'failed'`인 아이들만 색인하여 청크 생성.
- **중복 방지**: `child_id` + `business_date` UNIQUE 제약.

## 11. Cleanup 및 Retention 설계
- **청크 기반 Cleanup (01:00)**: `collected_at < $cutoff` 인 로우 1,000건씩 조회. 루프에서 0 반환 시까지 반복. 커서: `id` 또는 `created_at`. 
- **7일 파기 (Retention)**: `business_date <= (now KST - 7 days)` 쿼리로 `raw_`, `corrected_` 삭제. Cleanup과 독립된 크론 잡.

## 12. 미션 시간 및 강제 종료 설계
- **서버 검증 (Time Gate)**: API 단에서 KST 기준 시간 검사 적용.
- **클라이언트 동기화**: 미션 진입 후 서버 시간을 주입받고, 카운트다운 완료 시 강제 웹소켓 연결 해제, "시간 종료" 모달 노출 및 POST 요청 차단. 종료 이후 발화는 저장 거부.

## 13. 상태·재시도·멱등성
상태 컬럼 분리를 채택합니다: `pipeline_jobs` (Queue 패턴). 
이유: 각 테이블에 상태를 두면, Daily Report 실패 시 Corrected 테이블에 Update lock이 잡혀 동시성에 불리하며, 재시도 모니터링이 분산됩니다. 아이별 작업을 Worker가 claim하여 처리합니다.

## 14. Cron·Worker 실행 구조
DB 기반 Queue(`pipeline_jobs`)와 Worker 패턴을 사용합니다. Cron이 아이 목록을 큐에 넣으면, Chunk 단위의 짧은 Worker들이 비동기로 가져가 실행합니다.

---

## 20. 확정된 대표 결정사항 (Deep Interview 종료)
**결정 1. 미션 II 종료 시각과 2차 Collection 시각의 충돌 해결 방안**
- **결과**: **A안 확정 (미션 II 종료 23:50 단축)**. 미션 II 운영 시간을 KST 18:00~23:49로 단축하고 23:50에 강제 종료 후 안내 모달을 띄웁니다. 23:55에 2차 수집이 안전하게 진행됩니다.

## 21. 단계별 구현 체크리스트
- [x] Phase 0. 구현 전 딥 인터뷰 및 설계 확정
- [ ] Phase 1. 현재 변경분 보호 및 Dev DB Additive Migration 설계 (진행 중)
- [ ] Phase 2. Collection 구현 (RPC 원자성)
- [ ] Phase 3. Context Correction 구현 (멱등성 보강)
- [ ] Phase 4. Memory Batch / Daily Report 독립 연결
- [ ] Phase 5. Cleanup 및 7일 Retention
- [ ] Phase 6. 미션 시간 강제 종료 적용
- [ ] Phase 7. Dev Cron/Worker 통합 검증
- [ ] Phase 8. Production 배포 계획서 작성

## 22. 완료 조건
위 체크리스트 및 확정 요구사항이 모두 통과되며, Dev DB에서 100명 Dummy 로드 환경 하에 타임아웃이나 중복/유실 없이 01:00 Cleanup까지 전 사이클이 성공적으로 동작함을 로그로 증명.
