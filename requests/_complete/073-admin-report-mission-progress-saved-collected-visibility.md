# Request 073 — 관리자 리포트 미션 진행도·저장·수집 분리 표시

## 0. 목적

현재 관리자 리포트의 `세션(미션/자유)` 숫자는 당일 생성된 `chat_sessions` 행 개수를 단순 집계한다.

이 때문에:

- 미션 화면만 열고 실제 대화를 하지 않아도 `미션 1회`로 표시됨
- 미션을 끝까지 완료했는지 알 수 없음
- 10개 질문 중 몇 개까지 진행했는지 알 수 없음
- 실제 `chat_messages` 저장 여부를 알 수 없음
- 실제 Collection 수집 여부를 알 수 없음
- `미션 2회`인데 `2차 수집 0건` 같은 화면이 운영자에게 장애처럼 보일 수 있음

관리자 화면 하나에서 각 미션의:

1. 실제 진행도
2. 실제 메시지 저장
3. 실제 Collection 수집

을 서로 분리해서 확인할 수 있도록 개선한다.

---

# 1. 확정 정책

## 미션 시간대

- 미션 1: 10:00 ~ 18:00 KST
- 미션 2: 18:00 ~ 23:55 KST

## 미션 진행도

각 미션은 최대 10개 유효 턴 기준으로 표시한다.

예:

- `0 / 10`
- `2 / 10`
- `7 / 10`
- `10 / 10`

상태는 다음과 같이 해석한다.

- 세션 없음 + 0/10 → `미시작`
- 세션 있음 + 0/10 → `시작만`
- 1~9/10 → `미완료`
- 10/10 → `완료`

중요:
진행도는 `chat_sessions` 개수나 전체 메시지 개수를 나눠서 계산하지 않는다.

실제 미션 진행의 source of truth를 사용한다.

우선 확인 대상:
- `mission_progress`
- valid turn count
- mission completion status

Repository와 Production schema를 확인해 현재 실제 source of truth 컬럼/테이블을 사용한다.

---

# 2. 데이터 수집 정책

미션 완료 여부와 Collection 여부를 절대 묶지 않는다.

예:

```text
미션1 2/10
→ 아이가 중간에 종료
→ chat_messages에 실제 CHILD/K 메시지 저장
→ 해당 저장 메시지는 정상적으로 Collection 대상
```

즉:

- 10/10 완료한 미션만 수집하는 구조 금지
- 1~9턴 진행 후 중도 이탈한 미션도 실제 저장된 메시지는 전부 수집
- 세션만 생성되고 `chat_messages = 0`이면 수집 데이터 0건이 정상

---

# 3. 관리자 리포트 표시 변경

현재 `세션(미션/자유)` 중심 표시를 미션별 운영 상태 중심으로 변경한다.

권장 컬럼:

| 아이 | 미션1 진행 | 미션1 저장 | 1차 수집 | 미션2 진행 | 미션2 저장 | 2차 수집 | 자유대화 |
|---|---:|---:|---:|---:|---:|---:|---:|

예:

| 아이 | 미션1 진행 | 미션1 저장 | 1차 수집 | 미션2 진행 | 미션2 저장 | 2차 수집 | 자유대화 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 안서아 | 10/10 완료 | 21건 | 21건 | 10/10 완료 | 25건 | 25건 | 0 |
| 황유빈 | 4/10 미완료 | 8건 | 8건 | 0/10 시작만 | 0건 | 0건 | 0 |
| 이은수 | 10/10 완료 | 22건 | 22건 | 0/10 시작만 | 0건 | 0건 | 0 |
| 이상 케이스 | 10/10 완료 | 0건 | 0건 | 미시작 | 0건 | 0건 | 0 |

---

# 4. 각 컬럼 정의

## 미션1 진행 / 미션2 진행

표시 형식:

```text
10/10 완료
4/10 미완료
0/10 시작만
미시작
```

기준:

- 실제 mission phase별 progress source of truth
- phase 1 / phase 2 분리
- 동일 phase에 복수 session이 생긴 경우 단순 session count로 계산하지 말 것

복수 session이 있을 경우 실제 진행 상태를 어떻게 합산/대표할지 기존 mission domain logic을 확인하고, 중복 진행도를 만들지 않는다.

## 미션1 저장 / 미션2 저장

해당 미션 phase session에 연결된 실제 `chat_messages` 건수.

포함:
- CHILD
- K

관리자 운영 목적상 CHILD/K를 합산 표시해도 되지만 tooltip/detail에서 필요하면 역할별 건수도 확인 가능하게 한다.

예:

```text
21건
```

중요:
session 생성만으로 저장 건수 증가 금지.

## 1차 수집 / 2차 수집

실제 Raw V3에 들어간 메시지 건수.

V3 실제 source of truth 사용:

- `raw_daily_conversations_v3`
- `raw_daily_conversation_messages_v3`

가능하면 parent JSONB 배열 개수보다 child message table 기준을 우선한다.

Collection Phase 기준으로 집계:

```text
collection_phase = 1
collection_phase = 2
```

또는 현재 Production schema의 동등한 실제 컬럼 사용.

---

# 5. 운영자가 화면만 보고 구분할 수 있어야 하는 상태

## 정상 완료

```text
미션1 10/10 완료
저장 21건
1차 수집 21건
```

## 중도 이탈이지만 데이터 정상

```text
미션1 3/10 미완료
저장 7건
1차 수집 7건
```

이 상태는 Collection 장애가 아니다.

## 시작만 하고 대화 없음

```text
미션2 0/10 시작만
저장 0건
2차 수집 0건
```

이 상태도 Collection 장애가 아니다.

## 저장 장애 의심

```text
미션1 10/10 완료
저장 0건
1차 수집 0건
```

진행은 완료됐는데 메시지가 없는 상태이므로 즉시 이상을 식별할 수 있어야 한다.

## Collection 장애 의심

```text
미션2 10/10 완료
저장 24건
2차 수집 0건
```

실제 저장은 됐지만 Collection에 들어가지 않은 상태.

---

# 6. 관리자 API 수정

현재 확인된 관리자 API:

```text
app/api/admin/reporting/children/route.ts
```

현재 `chat_sessions` row count를 기반으로 `counts.mission++` 하는 기존 집계 로직을 그대로 "미션 진행 횟수"로 사용하지 않는다.

API response에 최소 다음 정보를 phase별로 추가한다.

예시 구조:

```ts
mission1: {
  started: boolean,
  validTurns: number,
  targetTurns: 10,
  completed: boolean,
  savedMessageCount: number,
  collectedMessageCount: number
}

mission2: {
  started: boolean,
  validTurns: number,
  targetTurns: 10,
  completed: boolean,
  savedMessageCount: number,
  collectedMessageCount: number
}
```

실제 타입/필드명은 현재 프로젝트 convention에 맞춘다.

---

# 7. 관리자 UI 수정

현재 확인된 UI:

```text
app/admin/(dashboard)/ManualReportingTab.tsx
```

기존 `세션(미션/자유)` 표시를 운영자가 오해하지 않는 형태로 변경한다.

우선순위:
1. 미션1 진행
2. 미션1 저장
3. 1차 수집
4. 미션2 진행
5. 미션2 저장
6. 2차 수집
7. 자유대화

화면 폭 문제가 있으면 compact layout/2-line header 등을 사용하되 핵심 정보는 숨기지 않는다.

---

# 8. 기존 Pipeline 로직 변경 금지

이번 Request의 목적은 관리자 리포트 가시성 개선이다.

다음은 변경하지 않는다.

- Collection candidate 정책
- Context Correction
- Memory Batch
- Daily Report
- mission turn persistence
- reward logic
- mission completion logic

단, 관리자 화면 집계 중 실제 source of truth를 읽기 위해 필요한 query/API 변경은 허용한다.

---

# 9. 성능

관리자 목록 한 화면에서 N명의 child를 표시하므로 N+1 query를 과도하게 만들지 않는다.

가능하면 날짜 기준 bulk query 후 child별 group-by 처리.

필요 데이터:

- child_profiles
- chat_sessions
- mission progress source
- chat_messages
- raw_daily_conversation_messages_v3

를 필요한 범위만 조회한다.

---

# 10. QA

Target QA만 수행한다.

## Case 1 — 완전 완료

```text
M1 10/10
saved > 0
collected = saved
```

화면:
`10/10 완료 / N건 / N건`

## Case 2 — 중도 이탈

```text
M1 2/10
saved > 0
collected = saved
```

화면:
`2/10 미완료 / N건 / N건`

## Case 3 — 시작만

```text
session 존재
validTurns = 0
saved = 0
collected = 0
```

화면:
`0/10 시작만 / 0건 / 0건`

## Case 4 — 미시작

```text
session 없음
```

화면:
`미시작 / 0건 / 0건`

## Case 5 — 저장 이상 식별

```text
10/10 completed
saved = 0
```

화면에서 명확히 확인 가능해야 한다.

## Case 6 — Collection 이상 식별

```text
saved = N
collected = 0
```

화면에서 명확히 확인 가능해야 한다.

## Case 7 — 실제 Production 사례 확인

2026-08-08 기준 최소:

- 황유빈
- 이은수
- 안서아
- 안서현
- 윤도건

으로 표시 결과 대조.

황유빈/이은수는 실제 조사 결과:

```text
Mission 1 session = 메시지 존재
Mission 2 session = 생성됨
Mission 2 chat_messages = 0
```

이므로 관리자 화면에서 미션2가 단순 `미션 2회`처럼 보이지 않고 실제 진행도/저장/수집 상태가 구분되어야 한다.

---

# 11. Acceptance Criteria

- [ ] 미션 세션 생성 수와 미션 진행도를 구분
- [ ] 미션1 / 미션2 진행도를 각각 0~10으로 표시
- [ ] `미시작 / 시작만 / 미완료 / 완료` 구분
- [ ] 미션별 실제 chat_messages 저장 건수 표시
- [ ] Phase별 실제 Raw 수집 건수 표시
- [ ] 미완료 미션의 저장 메시지도 Collection 정상 대상임을 유지
- [ ] 세션만 생성 + 메시지 0건 상태를 정확히 표현
- [ ] 완료 10/10 + 저장 0건 이상 상태를 화면에서 즉시 식별 가능
- [ ] 저장 N건 + 수집 0건 Collection 이상 상태를 즉시 식별 가능
- [ ] 기존 Collection/Correction/Memory/Report 동작 변경 없음
- [ ] Target QA 통과

---

# 12. 완료 보고

완료 시 다음만 보고한다.

1. 변경 파일
2. 관리자 API response 변경
3. UI 변경
4. 미션 진행도 source of truth
5. QA 결과
6. 2026-08-08 황유빈/이은수/안서아/안서현/윤도건 실제 표시 결과
