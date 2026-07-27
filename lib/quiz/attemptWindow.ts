/**
 * 퀴즈 attempt의 유효 시간창.
 *
 * 계획 Phase 7.2에 따라 `lib/quiz/play/route-helpers.ts`에서 이곳으로 옮겼다 —
 * `lib/quiz/play/` 전체가 인앱 중복 구현과 함께 삭제되는데, 이 상수만은
 * `app/api/play/session/route.ts`(이어하기 가능 여부 판정)가 계속 쓰기 때문이다.
 * 삭제 대상 디렉터리에 남겨두면 빌드가 깨진다.
 *
 * 원래 `route-helpers.ts`와 `auth.ts` 두 곳에 중복 정의돼 있었고(계획 Phase 7.2가
 * 지적한 항목), 이제 이 파일이 유일한 정본이다.
 *
 * 주의: `app/api/batch/quiz-handoff-reconcile/route.ts`는 같은 6시간 값을 의도적으로
 * **자체 상수로 복제**해 두었다. 그쪽은 정산 배치라 이 모듈이 향후 어떤 이유로
 * 사라지거나 의미가 바뀌어도 독립적으로 동작해야 하기 때문이다 — 두 값이 갈라지면
 * 안 되는 관계가 아니라, 우연히 같은 값을 쓰는 별개의 정책이다.
 */

/** attempt가 시작된 뒤 이어하기가 허용되는 최대 시간(6시간). */
export const ATTEMPT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
