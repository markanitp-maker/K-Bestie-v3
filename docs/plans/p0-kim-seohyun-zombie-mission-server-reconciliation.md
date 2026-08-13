# 김서현 DEV zombie Mission 복구 P0 계획

## 대상 파일

- `lib/mission/pendingTurnStore.ts`
- `app/child/missions/page.tsx`
- `app/api/mission/turn/route.ts` 또는 신규 read-only reconciliation API
- 관련 단위 테스트

## 변경 개요

1. `pendingMissionTurn`을 즉시/TTL 만료만으로 삭제하지 않고 서버 영속 상태와 먼저 대조한다.
2. `clientTurnId`가 서버에 commit됐으면 성공으로 수렴하고 local pending만 삭제한다.
3. 미commit이면 local pending과 recovery pause만 정리하고 DB SSOT에서 rehydrate하여 Q2 다음인 Q3부터 재개한다.
4. 불명확하면 같은 `clientTurnId`로 idempotent replay를 최대 1회 수행한 뒤 재조회한다.
5. 기존 DB turn/question/progress 레코드는 reset/update/delete하지 않는다.

## 데이터 흐름

IndexedDB pending → read-only server reconciliation → committed / not_committed / unknown → unknown만 replay 1회 → server reconciliation 재조회 → local cleanup → DB SSOT rehydrate.

## 위험요소

- child turn과 K turn/finalize 사이의 부분 commit을 단순 성공/실패로 오판할 위험
- hydration과 자동 복구 effect의 중복 실행으로 duplicate replay가 발생할 위험
- 레거시 Mission API의 실제 DB 컬럼 및 RPC 반환 구조 불일치 위험

## 작업 분할

1. 현재 pending/retry/hydration 및 DB persistence 경계 추적 (10분)
2. read-only reconciliation 계약 및 서버 조회 구현 (10분)
3. client 복구 상태기계와 TTL 의미 변경 (10분)
4. A/B/C 회귀 단위 테스트 보강 (10분)
5. 타입체크·테스트 및 정적 점검 (10분)

순차 의존: 1 → 2 → 3 → 4 → 5. 병렬 작업 없음.

## QA 인계

- 공통 사전조건: 김서현 DEV 당일 Mission에서 Q2까지 durable commit, Q3 표시 상태.
- A: Q3 child POST가 서버에 도달하기 전에 네트워크 단절. 재연결 후 `다시 시도`, 홈→재진입, 로그아웃→로그인 각각에서 Q3부터 재개되는지 확인.
- B: Q3 child message/mission_turn/mission_progress.question_states 저장 뒤 ACK 또는 K finalize 전에 응답 단절. 세 복구 진입점에서 Q3를 중복 저장하지 않고 다음 질문으로 진행하는지 확인.
- C: Q3 K turn과 mission_turn FINALIZED까지 저장 뒤 응답 수신 전에 단절. 세 복구 진입점에서 같은 child/K turn 중복 없이 다음 질문으로 진행하는지 확인.
- DB 검증: 각 시나리오 전후 `mission_turns.client_turn_id`, `chat_messages.turn_id`, `mission_progress.question_states`를 비교해 duplicate 0, 기존 정상 레코드 손실 0을 확인. 기존 DB 행 reset/update/delete 금지.
- 종료조건: 어떤 네트워크 장애에서도 동일 child의 당일 Mission zombie 영구 차단 0건.
