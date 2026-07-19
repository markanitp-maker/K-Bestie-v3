# 함수 시그니처 및 트랜잭션 경계 설계

## 1. reserve_gold_keys_for_play
- 시그니처: `reserve_gold_keys_for_play(p_child_id UUID, p_play_type TEXT, p_keys_needed INTEGER) RETURNS TABLE(reservation_id UUID, reason TEXT)`
- 트랜잭션 경계: 함수 전체가 단일 트랜잭션(원자적). 
- 동작: 
  - `pg_advisory_xact_lock(hashtext(p_child_id::text))` 획득으로 동시성 제어.
  - `k_play_sessions`에 `status = 'in_progress'`인 세션이 있는지 확인하고 있으면 거부('already_in_progress').
  - `gold_key_ledger`에서 소멸하지 않은 미소비 열쇠를 `earned_at ASC, id ASC` 순으로 `FOR UPDATE` 잠금.
  - 개수가 충족되면 `gold_key_reservations`에 예약 기록 생성 후 `gold_key_ledger`의 `reservation_id` 업데이트.

## 2. confirm_gold_key_reservation
- 시그니처: `confirm_gold_key_reservation(p_reservation_id UUID) RETURNS TABLE(success BOOLEAN, header_id UUID, reason TEXT)`
- 트랜잭션 경계: 원자적 처리.
- 동작:
  - 예약 정보 조회 및 `child_id` 잠금.
  - `gold_key_ledger`의 해당 예약 열쇠들을 `consumed = true`, `consumed_at = now()`로 확정.
  - `gold_key_consumptions`에 소비 이력 헤더 생성.
  - `gold_key_reservations` 상태를 'confirmed'로 변경.

## 3. restore_gold_key_reservation
- 시그니처: `restore_gold_key_reservation(p_reservation_id UUID) RETURNS BOOLEAN`
- 트랜잭션 경계: 원자적 처리.
- 동작:
  - `child_id` 락 획득 후 예약 상태 확인.
  - `gold_key_ledger`에서 해당 `reservation_id`를 `NULL`로 리셋. 열쇠 원본(earned_at, expires_at, consumed=false) 유지.
  - 예약 레코드 상태를 'restored'로 변경.

## 4. start_new_play_session
- 시그니처: `start_new_play_session(p_child_id UUID, p_play_type TEXT, p_new_reservation_id UUID) RETURNS TABLE(session_id UUID, reason TEXT)`
- 트랜잭션 경계: 원자적. 내부적으로 `confirm_gold_key_reservation`의 로직을 포함하거나 호출하여 확정과 세션 초기화를 동시 수행.
- 동작:
  - `child_id` 락 획득.
  - `p_new_reservation_id`에 대한 확인 수행 (실패 시 롤백 및 기존 세션 유지).
  - 기존 세션이 있다면 `progress_state = '{}'`, `started_at = now()`, `resume_expires_at = now() + 6시간` 등으로 리셋 (초기화). 기존 세션이 없다면 새로 INSERT.

*(참고: 1번에서 이미 세션이 있으면 예약을 거부하므로, 4번의 "기존 세션이 있을 때"를 테스트하려면 예외적으로 예약을 허용하는 우회로가 필요하거나 클라이언트가 예약 요청 시 재시작 의도를 알 수 있는 파라미터가 있어야 합니다. 이 마이그레이션에서는 요청된 시그니처를 유지하면서 (1)에서 진행중 세션 여부 체크를 엄격히 수행합니다.)*
