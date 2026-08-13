# Mission v3 cutover 원자성 P0 보강

## 1. 택한 안과 이유

- **A의 cutover 한정형**: `mission_progress`와 함께, 같은 business date에 cutover 전에 생성된 mission `chat_sessions`도 v2 sticky 증거로 본다.
- 세션 INSERT 뒤 progress INSERT 전의 상태가 resolver에서 사라지는 현재 틈을 막아, cutover 뒤에도 legacy start가 403으로 끊기지 않는다 (`app/api/mission/start/route.ts:324`, `app/api/mission/start/route.ts:402`).
- 모든 orphan을 v2로 보면 cutover 뒤 v3 생성 중간 상태도 오판하므로 `started_at < effectiveAt`인 세션만 인정한다.
- B는 완전한 트랜잭션 해법이지만 신규 RPC 마이그레이션 승인·적용·검증이 필요해 오늘 23:30 완료 조건에 맞지 않는다. C는 progress가 session FK를 참조해 불가하고, D는 403을 막지 못한다.

## 2. 정확한 구현 지시

대상은 `lib/mission-v3/policyResolution.ts`와 `lib/mission-v3/policyResolution.test.ts` 두 파일뿐이다.

1. `lib/mission-v3/policyResolution.ts:89-101`의 당일 progress 조회 직후, `resolvedFromEnv.effectiveAt !== null`일 때만 아래 조건으로 `chat_sessions`를 조회한다. 오류는 기존 progress 조회와 같이 throw하여 fail-closed한다.

```ts
const { data: preCutoverSessions, error: sessionError } = resolvedFromEnv.effectiveAt
  ? await input.db
      .from("chat_sessions")
      .select("id")
      .eq("child_id", input.childId)
      .eq("session_type", "mission")
      .eq("business_date", businessDate)
      .lt("started_at", resolvedFromEnv.effectiveAt)
      .limit(1)
  : { data: [], error: null };

if (sessionError) {
  throw new Error(`당일 pre-cutover 미션 세션 조회 실패: ${sessionError.message}`);
}

const hasPreCutoverV2Session = (preCutoverSessions ?? []).length > 0;
```

2. `lib/mission-v3/policyResolution.ts:100-125`에서 `hasV2Progress`와 `hasV3`를 따로 계산한다. `hasV2 = hasV2Progress || hasPreCutoverV2Session`으로 정의한 뒤 기존 mixed fail-closed와 v2 반환 분기에 이 `hasV2`를 그대로 사용한다. v3 progress 판정과 env fallback은 바꾸지 않는다.
3. `lib/mission-v3/policyResolution.test.ts:56-97`의 mock DB가 테이블명별 `mission_progress`/`chat_sessions` 결과와 조회 오류를 반환하도록 최소 확장하고, 아래 케이스만 추가한다. 다른 resolver 계약은 수정하지 않는다.

## 3. 마이그레이션

필요 없다. 기존 `chat_sessions.business_date`, `started_at`, `session_type`만 읽는다 (`supabase/migrations/20260726300000_add_business_date_to_chat_sessions.sql:2`, `supabase/migrations/20260804070000_chat_sessions_business_date_defense.sql:13-29`). 신규 RPC(B)는 오늘 일정상 승인·적용·검증 완료를 보장할 수 없어 제외한다.

## 4. 검증 방법

- progress 없음 + 같은 날짜 mission session의 `started_at`이 cutover 1ms 전 + 현재시각 cutover 후 → `v2_dual`, `isMixed` 아님.
- progress 없음 + session의 `started_at`이 cutover와 같거나 이후 → env 기준 `v3_single_daily`.
- 전날 pre-cutover session만 존재 → 오늘 판정에 영향 없음.
- v3 progress + 같은 날짜 pre-cutover orphan 동시 존재 → `isMixed: true`로 fail-closed.
- `chat_sessions` 조회 오류 → resolver reject; v3 신규 생성 허용 금지.
- env 제거 + 당일 v3 progress → 기존대로 `v3_single_daily`; env 제거 + 당일 v2 progress → 기존대로 `v2_dual`.
- 첫 케이스의 반환값으로 legacy guard 조건(`version === "v3_single_daily" || isMixed`)이 false임을 같은 단위 테스트에서 assert해 403 `MISSION_POLICY_CHANGED` 분기로 가지 않음을 고정한다 (`app/api/mission/start/route.ts:102-119`).

## 5. 회귀와 방지책

- 추가 조회 1회가 생긴다. `child_id + session_type + business_date + started_at`, `limit(1)`로 범위를 고정한다.
- cutover 전 orphan이 있으면 그 business date는 v2로 고정된다. 이는 v3 혼입보다 안전한 의도된 fail-safe이며 다음 KST 날짜에는 자동으로 영향이 사라진다.
- cutover 뒤 v3 orphan을 v2로 오판하지 않도록 반드시 strict `< effectiveAt`을 사용한다. 롤백은 effectiveAt을 미래로 이동하지 말고 env를 제거해 기존 progress sticky만 적용한다.
