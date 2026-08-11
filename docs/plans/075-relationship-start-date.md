# 075 Relationship Engine V1 — 관계 시작일

## 조사 근거

- `child_profiles`는 `chat_sessions.child_id`가 직접 참조하는 아이별 프로필 테이블이므로 관계 시작일의 소유 위치로 사용한다.
- 미션 정상 턴은 `mission_turns.child_message_id`와 `mission_turns.k_message_id`가 `FINALIZED` 상태에서 정확한 페어를 이룬다.
- 자유대화에는 공통 pair ID가 없으므로 같은 세션에서 `display_sequence` 순으로 인접한 `child -> k`를 정상 왕복으로 판정한다. `display_sequence` 도입 전 레거시는 `created_at, id` 순서를 사용한다.
- 기존 `relationship_events`, `relationship_started_at`, `calendar_stage` 스키마/소비처는 없다. 다른 075 요구사항은 이번 서브태스크에서 생성하지 않는다.

## 변경 계획

1. `child_profiles`에 nullable 관계 시작일과 fallback 표시 컬럼을 추가한다.
2. 최초 정상 왕복 후보를 찾는 DB 함수와 메시지 저장 트리거를 추가하고, 실제 시작일은 불변으로 보호한다.
3. 기존 행은 과거 정상 왕복의 K 저장 시각으로 backfill하고, 후보가 없는 행만 `created_at` fallback으로 표시한다.
4. W1~W4 계산은 `relationship_started_at`만 입력받는 순수 함수와 경계 테스트로 고정한다.

## 위험과 방어

- CHILD만 저장된 실패 턴과 K 선행 인사말은 인접 `child -> k`가 아니므로 제외한다.
- 신규 정상 턴은 실제값을 덮어쓰지 않으며, migration 당시의 임시 fallback만 최초 실제 턴으로 교체할 수 있다.
- Production에는 적용하지 않는다. Dev 적용 또는 read-only 조회만 허용한다.
