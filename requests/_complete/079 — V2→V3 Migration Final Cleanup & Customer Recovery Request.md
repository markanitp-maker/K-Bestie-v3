# 079 — V2→V3 Migration Final Cleanup & Customer Recovery Request

## 0. 목적

V2 → V3 전환 전수감사에서 발견된 잔여 마이그레이션 누락을 정리하고, 현재 고객 사용성을 완전히 정상화한다.

이번 작업은 새로운 기능 개발이 아니다.

목적은 다음 3가지다.

1. V2 Push/Cron 라운드 개념 제거
2. V3 단일 Mission 정책과 사용자 알림 정합화
3. 과거 V3 completion 장애 고객 복구

이미 검증·수정 완료된 항목은 다시 수정하지 않는다.

---

# 1. 현재 V3 Ground Truth

Mission V3 공식 정책:

- 하루 Mission 1회
- Production 운영시간: 09:00 ~ 23:50 KST
- 질문/Goal 세트: 10개
- SATISFIED 5개 도달 시 COMPLETED
- IN_PROGRESS 재진입 → 동일 Mission resume
- COMPLETED → 당일 신규 Mission 생성 금지
- Mission 완료 → 황금열쇠 +1
- Mission 완료 → Event activity +1
- Free Chat reward는 Mission과 별도 daily reward
- P0 부모 질문은 우선 질문하되 강제 만족 조건은 아님
- 진행 중 네트워크 단절 후 동일 Mission 복구

---

# 2. 이미 CLOSED 된 항목 — 재작업 금지

## 2.1 `force_end_mission_session_if_expired`

기존 V2 legacy:

- `daily_single`이 17:50 cutoff로 처리됨

현재 수정 완료:

- `daily_single` → 23:50 KST
- `round1_day` → 17:50 KST
- `round2_night` → 익일 00:00 KST

완료 상태:

- Dev DB boundary 검증 PASS
- Production DB 적용 PASS
- Git migration commit PASS
- Production Supabase migration ledger 정합 PASS

해당 문제는 CLOSED.

다시 수정하지 않는다.

---

## 2.2 Completion Threshold

공식 정책:

```text
10 Goals
5 SATISFIED
→ COMPLETED
```

실측 검증:

### SATISFIED 4
- IN_PROGRESS 유지
- 황금열쇠 0
- Event 0

### SATISFIED 5
- COMPLETED
- 황금열쇠 +1
- Event +1

### SATISFIED 6 이후 재호출
- 황금열쇠 중복 0
- Event 중복 0

해당 핵심 완료 정책 PASS.

---

## 2.3 Legacy `target: 3`

기존 V3 초기 코드 잔재:

```text
snapshot.progress.target = 3
```

때문에 Ready 화면에서:

```text
1 / 3 = 33%
```

표시 후 `/start`에서:

```text
1 / 5 = 20%
```

로 변경되는 오류가 확인됨.

수정 후:

```text
snapshot.progress.target = 5
goalProgress.completionThreshold = 5
```

일치 확인.

0 Goal 일시 상태에서도:

```text
0 / 5 = 0%
```

정상 표시 확인.

해당 문제 CLOSED.

---

## 2.4 Goal Cardinality / Self-Heal

정상 V3 writer 경로에서:

```text
1~9 Goals partial commit
```

재현되지 않음.

정상 multi-row INSERT 결과는:

```text
0 또는 10
```

0 Goal + IN_PROGRESS 상태는 서버 중단 시 일시적으로 발생 가능.

그러나 정상 재진입 시:

```text
today-progress
→ POST /api/mission/v3/start
→ 동일 session resume
→ 10 Goals 생성
```

으로 self-heal 확인.

정상 Client에서 `/start` 복구를 우회하여 0 Goal 상태로 `/turn` 진입하는 경로 없음.

해당 항목 CLOSED.

---

## 2.5 Network Recovery

실제 DEV Chromium / Playwright E2E 검증 완료.

### Case A

```text
Q1 durable
Q2 durable
Q3 server commit 전 network abort
→ 다시 시도
→ 동일 clientTurnId 재처리
→ 후속 child turn 성공
→ K response 성공
```

### Case B

```text
Q1 durable
Q2 durable
Q3 server commit 완료
응답만 유실
→ Home
→ Mission 재진입
→ 동일 session resume
→ 후속 child turn 성공
→ K response 성공
```

DB 검증:

- mission_progress 1
- chat_sessions 1
- duplicate turn 0
- duplicate clientTurnId 0
- Goals 10
- duplicate goal_order 0
- unintended reward 0

Recovery E2E PASS.

---

# 3. 이번 Request의 실제 수정 대상

# P1 — V2 Push / Cron Migration Omission

현재 V3 Mission은 하루 1회지만 Push 시스템에는 V2 라운드 개념이 남아 있다.

현재 Cron:

```text
KST 10:00 → missionType=1
KST 13:00 → missionType=1
KST 18:00 → missionType=2
```

현재 Push template:

```text
missionType=1
round_type = round1_day
title = "미션 시작 시간이야!"

missionType=2
round_type = round2_night
title = "저녁 미션 시작 시간이야!"
```

문제:

```text
"저녁 미션"
round1_day
round2_night
```

는 V2 dual Mission 정책의 잔재다.

현재 V3 사용자에게 실제 노출 가능한 reachable migration omission이다.

---

# 4. Push 발송 횟수 정책

중요:

Mission이 하루 1회라고 해서 Push도 하루 1회여야 하는 것은 아니다.

현재 여러 시간대 reminder 자체는 유지 가능하다.

예:

```text
10:00 reminder
13:00 reminder
18:00 reminder
```

단 다음 정책을 따른다.

### COMPLETED
발송 금지.

### IN_PROGRESS
재시작 알림이 아니라 이어하기 reminder.

### NOT_STARTED
오늘 Mission 시작 reminder.

---

# 5. Push 문구 V3화

## NOT_STARTED

권장:

```text
오늘의 미션 시간이야!
케이와 오늘 이야기를 시작해 볼까요?
```

## IN_PROGRESS

권장:

```text
오늘의 미션을 이어가 볼까?
케이가 기다리고 있어요.
```

금지:

```text
1차 미션
2차 미션
낮 미션
저녁 미션
round1_day
round2_night
```

사용자 노출 문구에 V2 라운드 개념을 사용하지 않는다.

---

# 6. Push 내부 식별자

새 V3 Mission Push 기록은 가능하면:

```text
daily_single
```

기준으로 통일한다.

단 기존 V2 historical push log는 수정하거나 삭제하지 않는다.

historical data 보존.

새 Push부터 V3 정책을 적용한다.

---

# 7. Push 대상 선정

현재 완료 사용자 제외 로직은 유지한다.

```text
COMPLETED
→ Push 제외
```

추가 구분:

```text
IN_PROGRESS
→ 이어하기 문구

NOT_STARTED
→ 시작 문구
```

동일 business_date 기준으로 판단한다.

---

# 8. 고*연 고객 복구

확인된 상태:

```text
10 Goals
5 SATISFIED
mission_progress = IN_PROGRESS
reward 없음
event 없음
```

당시 V3 completion 처리 결함 발생 시점과 일치.

복구 예상:

```text
mission_progress
IN_PROGRESS → COMPLETED

gold_key_ledger
mission_v3_complete +1

child_mission_event_completions
mission_complete +1
```

현재 unique/index/idempotency 구조상 중복 방어 확인됨.

단:

> Production 고객 데이터 write는 대표 승인 후에만 실행한다.

Antigravity / Codex 임의 실행 금지.

---

# 9. `LEAST(5, goal_count)` 처리

현재 Production RPC 일부에는:

```sql
LEAST(5, goal_count)
```

방어 로직이 존재한다.

전수 감사 결과:

- 정상 Production runtime에서 Goal 1~9 partial 상태 ingress 재현 안 됨
- 0 Goal 상태는 발생 가능하지만 `/start`에서 10개로 self-heal
- 정상 Client에서 0 Goal 상태로 `/turn` bypass 불가

따라서:

```text
현재 고객 장애 P0로 분류하지 않는다.
```

후속 defensive hardening backlog로 관리한다.

이번 Request에서 수정하지 않는다.

---

# 10. DEV 검증

Push/Cron 수정 후 최소 검증:

## Case A — NOT_STARTED

```text
Cron 대상
→ Push 발송 대상
→ "오늘의 미션" 문구
```

PASS 조건:

- `저녁 미션` 없음
- V2 round 문구 없음

## Case B — IN_PROGRESS

```text
오늘 Mission 진행 중
→ Reminder
```

PASS 조건:

- "미션 시작"이 아닌 이어하기 의미
- 동일 Mission으로 진입

## Case C — COMPLETED

```text
오늘 Mission 완료
```

PASS 조건:

```text
Push 0
```

## Case D — 18:00

PASS 조건:

```text
"저녁 미션" 사용자 노출 0
```

## Case E — Push log

PASS 조건:

- 신규 V3 Push에 V2 round 의미 사용하지 않음
- historical V2 log 변경 없음

---

# 11. 회귀 금지

이번 수정으로 다음을 건드리지 않는다.

- Mission 09:00~23:50
- 하루 Mission 1회
- 10 Goals
- 5 SATISFIED completion
- force_end RPC
- Mission reward
- Event reward
- Free Chat reward
- Recovery
- P0 질문
- Dynamic Question Engine
- 기존 Mission progress
- historical reward/event data

---

# 12. Production 적용 Gate

다음이 모두 PASS한 경우에만 Production 배포:

```text
TypeScript PASS
관련 Unit PASS
Push 대상 선정 테스트 PASS
NOT_STARTED 문구 PASS
IN_PROGRESS 문구 PASS
COMPLETED 발송 0 PASS
18:00 "저녁 미션" 노출 0 PASS
기존 Mission 로직 regression 0
```

---

# 13. Production Smoke

배포 후 READ-ONLY / 비파괴 확인:

1. Cron config V3 문구 반영
2. Push template V2 문구 제거
3. COMPLETED 제외 로직 유지
4. IN_PROGRESS 대상 이어하기 template
5. NOT_STARTED 시작 template
6. Mission API 5xx 증가 없음

실제 사용자에게 테스트 Push를 임의 발송하지 않는다.

---

# 14. 완료 보고

최종 보고에는 다음만 포함:

1. 변경된 Push/Cron 파일
2. 제거한 V2 round 표현
3. 최종 V3 Push template
4. NOT_STARTED 대상 결과
5. IN_PROGRESS 대상 결과
6. COMPLETED 제외 결과
7. DEV 테스트 결과
8. Production 배포 결과
9. Production smoke
10. 고*연 고객 복구 실행 여부
11. 남은 backlog

---

# 15. 최종 완료 정의

다음 상태가 되면 V2→V3 마이그레이션 cleanup을 완료로 본다.

```text
Mission = 하루 1회
운영시간 = 09:00~23:50
Questions = 10
Completion = 5 SATISFIED
Network Recovery = 정상
Push 사용자 문구 = V3 "오늘의 미션"
V2 round1_day / round2_night 개념 사용자 노출 = 0
기존 장애 고객 복구 완료
```

이후부터는 V2와 비교하는 마이그레이션 감사를 반복하지 않는다.

이 시점을 V3 Production Baseline으로 확정하고 이후 변경은 V3 기준 회귀 테스트만 수행한다.
