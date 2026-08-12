# Phase 2A Collection Implementation 최종 완료 보고서

## 1. DB 복구 성공 및 V3 활성화 준비
- **DB Push 성공**: 이전 단계에서 충돌했던 `chat_sessions_mission_phase_check` 제약 조건 중복 문제를 수정(`DROP CONSTRAINT IF EXISTS` 적용)하고 `20260801160000_reconcile_pipeline_v3.sql` 마이그레이션을 Dev 환경에 성공적으로 적용했습니다.
- **RPC 충돌 수정 및 컬럼 보완 (신규)**: 
  - 과거 Phase 1 시점에 추가되었던 `pipeline_jobs` 스키마와 `enqueue_collection_jobs_v3` 다중 오버로딩 버전들이 남아있어 런타임 충돌이 발생한 문제를 확인했습니다.
  - `20260801172000_add_missing_v3_columns.sql` 마이그레이션을 통해 `pipeline_jobs` 테이블에 누락되었던 V3 제어 컬럼(`collection_phase`, `cutoff_at`, `execution_id` 등)을 추가했습니다.
  - `20260801173000_fix_enqueue_rpc.sql` 및 `20260801174000_fix_collect_rpc.sql`, `20260801175000_fix_collect_rpc2.sql`, `20260801180000_fix_collect_rpc3.sql` 마이그레이션을 연속으로 배포하여 RPC 오버로딩 충돌을 제거하고, `s.child_id` 참조 오류 및 `original_content` 컬럼 매핑 오류를 모두 해결했습니다.
- `pipeline_v3_control.enabled = false` 제어가 정확하게 동작하여, 애플리케이션에서 `enqueue_collection_jobs_v3` 호출 시 `V3_DISABLED` (P0001) 에러가 반환되는 것을 확인했습니다 (실제 PGRST202 문제가 해소되고 정상적인 커스텀 에러 반환).

## 2. 애플리케이션 코드 구현 완료
- **`lib/batch/collection.ts`**:
  - `enqueueCollectionJobsV3` 및 `processCollectionJobsV3` 함수를 새로운 DB RPC 시그니처에 맞게 수정했습니다.
  - V3_DISABLED 에러를 명시적으로 포착해 처리하도록 로직을 추가했습니다.
  - Worker 쪽의 `collect_chat_messages_v3` 호출 시 `limit`과 `cutoff`을 서버(RPC) 안에서 직접 통제하도록 단순화된 시그니처에 맞추고, 에러 기록도 `mark_pipeline_job_failed` RPC를 호출하도록 구현했습니다.

## 3. `mission_phase` 전체 경로 구현 및 시간 검증 적용
- **공통 유틸리티 도입**: `app/api/_lib/missionUtils.ts`에 `getMissionPhase()` 함수를 생성하여 KST 기준 10:00~17:50은 Phase 1, 18:00~23:50은 Phase 2로 맵핑하는 규칙을 일원화했습니다. 클라이언트의 `roundType`을 무조건 신뢰하지 않고 서버 시간과 불일치할 경우 생성(403)을 차단합니다.
- **일반 미션 (`app/api/mission/start/route.ts`)**: `getMissionPhase()`를 통해 얻은 Phase를 `chat_sessions`의 `mission_phase` 컬럼에 INSERT 하도록 반영했습니다.
- **테스트 미션 (`app/api/child/test-mission/start/route.ts`)**: 테스트 미션(common 라운드) 생성 시에도 `getMissionPhase('common')`을 호출해 시간에 맞는 Phase를 부여하여 INSERT 하도록 반영했습니다.
- **자유대화 (`session_type = 'free_chat'`)**: `get_or_create_chat_session` RPC에 의해 생성되며, DB의 CHECK 제약 조건에 따라 `mission_phase`가 NULL로 유지되어 요구사항에 부합함을 통합 스크립트로 검증했습니다.

## 4. 파이프라인 E2E 모의 실행 통합 검증 (최종 통과)
- 임시로 V3 Control을 활성화(`enabled=true`)하고 `qa_test_v3.sql` 스크립트를 통해 전체 수집 파이프라인을 모의 실행했습니다.
  - **테스트 1. Enqueue**: Mock 자녀와 세션, 메시지를 생성한 뒤 `enqueue_collection_jobs_v3(1, ...)` 호출 시 정상적으로 `pipeline_jobs`에 1건이 적재됨을 확인했습니다.
  - **테스트 2. Claim**: `claim_pipeline_jobs` 호출 시 대기 중인 Job이 정상적으로 'processing' 상태로 락(lock) 획득됨을 확인했습니다.
  - **테스트 3. Collect**: `collect_chat_messages_v3` 호출 시 해당 Job의 메시지가 `raw_daily_conversation_messages_v3` 정규화 테이블에 적재되고, `raw_daily_conversations_v3` 테이블의 JSONB 배열로 완벽하게 재조립됨을 검증했습니다.

## 5. 최종 데이터 및 이력 무결성
- 기존 Legacy 데이터(v1, v2 테이블 및 세션)의 삭제나 훼손이 발생하지 않았음을 확인했습니다.
- 마이그레이션 이력을 임의로 Repair 하거나 `db reset`으로 손상시키지 않고 안전하게 `db push`만 적용했습니다.
- Production 환경에 대한 조작, 예약된 Cron 등록, `pipeline_v3_control.enabled=true`의 영구 적용 작업은 사용자 규칙에 따라 일절 진행하지 않았습니다.

### 다음 단계 권고
Phase 2A(Collection)의 모든 요구사항 구현과 통합 쿼리 검증이 완벽하게 끝났습니다.
승인해주시면 즉시 **Phase 2B (Correction - 교정 파이프라인)** 작업으로 넘어가겠습니다.
