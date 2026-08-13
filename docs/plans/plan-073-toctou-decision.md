# Mission v3 TOCTOU 최소 결정안

## 1. 택한 안과 이유

- **(D) 수용**, 단 Production 배포 설정의 `MISSION_SCHEDULE_ENFORCED=true` 확인을 23:30 전 필수 게이트로 둔다.
- 이 조건에서는 00:59:59 신규 요청이 시간 게이트에서 403으로 끝나므로 문제의 INSERT 경로에 도달하지 않는다.
- 23:50 마감과 01:00 cutover 사이가 70분이며, INSERT 직전에도 현재 시각을 다시 검사하므로 잔여 경로는 70분 이상 걸린 단일 DB INSERT뿐이다.
- (A)는 미세 창만 남기고, (B)는 신규 migration 승인·적용이 필요하며 현 CHECK는 post-cutover v2를 막지 않고, (C)는 post-cutover v2 생성을 의도적으로 허용한다.
- 제품 변경이 없어 env 미설정 시 관찰 차이와 기존 v2 회귀가 모두 0이며, 롤백 동작도 바뀌지 않는다.

## 2. 운영시간 게이트 판정 — 실제로 막음

- Production 강제 여부는 `MISSION_SCHEDULE_ENFORCED === "true"`로만 정해진다 (`lib/mission/missionScheduleFlag.ts:8-10`), legacy start가 이를 요청 초기에 읽는다 (`app/api/mission/start/route.ts:52-55`). 따라서 **배포 설정 확인 전에는 (D)가 성립하지 않는다**.
- 기존 당일 세션은 시간 게이트 전에 resume될 수 있지만 신규 INSERT 없이 반환한다 (`app/api/mission/start/route.ts:165-242`). 신규 생성만 `currentRound(..., true)`를 통과해야 하고, 실패하면 즉시 403이다 (`app/api/mission/start/route.ts:244-255`). 강제 창은 09:00 inclusive~23:50 exclusive다 (`lib/mission/missionTimeGate.ts:42-49`). 그러므로 00:59:59 신규 요청의 INSERT 확률은 이 설정 아래 **0**이다.
- 질문 선별 뒤에도 `getMissionPhase`가 새 `Date()`로 현재 KST를 다시 읽어 09:00 미만/23:50 이상이면 `null`을 반환한다 (`app/api/_lib/missionUtils.ts:24-35`); route는 INSERT 직전 이를 403으로 반환한다 (`app/api/mission/start/route.ts:317-324`).
- 정책 판정 뒤 INSERT 전의 지연 작업은 당일 세션 조회와 질문 후보 DB 조회/로컬 선별이다 (`app/api/mission/start/route.ts:135-144`, `app/api/mission/start/route.ts:274-309`, `lib/mission/selectQuestions.ts:595-661`). LLM 인사말은 두 INSERT 이후 호출된다 (`app/api/mission/start/route.ts:402`, `app/api/mission/start/route.ts:701-708`). 따라서 00:59:59 판정 뒤 LLM 지연으로 :324/:402가 cutover를 넘는 경로는 없다.
- 남는 이론 경로는 23:50 전에 두 번째 게이트를 통과한 뒤 :324의 DB INSERT 자체가 70분 이상 지연되어 01:00 이후 commit되는 경우다. 코드만으로 수치 확률은 산정할 수 없지만, 01:00 신규 트래픽과 별개인 장기 미완료 DB 요청 한정이므로 운영 위험은 사실상 0에 가깝다.

## 3. 구현·23:30 완료 조건

- 제품 구현·migration 없음이므로 아래 단위 검증과 설정 확인만으로 23:30 완료 가능하다. (B)는 현재 CHECK가 v2에 `effective_at IS NULL`만 요구해 cutover 이후 v2를 거부하지 않고 (`supabase/migrations/20260810220000_mission_v3_daily_single_policy.sql:77-101`), 신규 DDL의 승인·Production 적용·재리뷰를 오늘 안에 보장할 수 없어 탈락이다.
- 23:30 전 Production 배포 설정에서 `MISSION_SCHEDULE_ENFORCED=true`를 읽기 전용으로 확인한다. 확인 실패/false면 (D)는 즉시 탈락이며 01:00 활성화도 중단한다.
- 롤백은 기존 절차대로 `MISSION_V3_EFFECTIVE_AT`만 unset하고 시간 게이트는 유지한다. 이 문서 결정으로 추가 롤백 대상은 없다.

## 4. 단위 검증 목록

1. `currentRound(0, true, 59) === null`, `08:59 === null`, `09:00` 허용, `23:49` 허용, `23:50 === null`.
2. 강제 플래그 true + 당일 행 없는 00:59:59 요청: 403 `scheduleClosed`, `chat_sessions`/`mission_progress` INSERT 0회.
3. resolver가 v2를 반환한 뒤 첫 시간 판정 시각이 01:00:00: 403, INSERT 0회.
4. 첫 게이트를 23:49:59에 통과하고 질문 조회 뒤 두 번째 게이트가 23:50:00: 403, INSERT 0회.
5. `MISSION_V3_EFFECTIVE_AT` unset: 기존 v2 start/resume 응답과 DB write가 기준 브랜치와 동일.

## 5. 잔여 위험과 사후 감지

- 잔여 위험은 Production 강제 플래그 오설정과 70분 이상 지속된 :324 DB INSERT다. T+5분과 09:05 KST에 아래 읽기 전용 쿼리 결과가 각각 0행인지 확인한다(SQL 실행은 운영 담당).

```sql
-- cutover 이후 생성된 v2 progress
SELECT mp.child_id, mp.session_id, mp.business_date, mp.created_at, cs.started_at
FROM public.mission_progress mp
JOIN public.chat_sessions cs ON cs.id = mp.session_id
WHERE mp.business_date = '2026-08-14'
  AND mp.mission_policy_version = 'v2_dual'
  AND (mp.created_at >= TIMESTAMPTZ '2026-08-14 01:00:00+09'
       OR cs.started_at >= TIMESTAMPTZ '2026-08-14 01:00:00+09');

-- cutover 이후 legacy v2 또는 progress 없는 mission session
SELECT cs.child_id, cs.id AS session_id, cs.business_date, cs.started_at,
       mp.mission_policy_version
FROM public.chat_sessions cs
LEFT JOIN public.mission_progress mp ON mp.session_id = cs.id
WHERE cs.session_type = 'mission'
  AND cs.business_date = '2026-08-14'
  AND cs.started_at >= TIMESTAMPTZ '2026-08-14 01:00:00+09'
  AND (mp.session_id IS NULL OR mp.mission_policy_version = 'v2_dual');

-- 같은 child/business_date의 v2+v3 혼합
SELECT child_id, business_date
FROM public.mission_progress
WHERE business_date = '2026-08-14'
GROUP BY child_id, business_date
HAVING bool_or(mission_policy_version = 'v2_dual')
   AND bool_or(mission_policy_version = 'v3_single_daily');
```
