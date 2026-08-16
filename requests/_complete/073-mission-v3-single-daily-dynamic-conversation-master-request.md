`073-feature-mission-v3-single-daily-conversation.md`

# REQUEST #073 — Mission v3 Single Daily Dynamic Conversation 통합 전환

- 상태: TODO
- 유형: 서비스 핵심 정책 전환
- 우선순위: HIGH
- 대상: Mission / Free Chat / Reward / Event / Frontend / Admin / Cron / Report / Analytics
- 선행 조건: 071/072 공통 K Conversation Engine Dev PASS
- 핵심 방향: 하루 2회 Mission 구조를 하루 1회 Goal-directed Mission v3로 전환하고 Free Chat v2와 공통 K Conversation Engine 및 Reward/Event Contract를 공유

---

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과

아이에게 Mission은 더 이상 `MISSION I / MISSION II` 형태의 하루 2회 질문지가 아니다.

신규 정책에서는:

```text
하루 1회 Mission
13:00~23:00
약 3~5분 자연스러운 대화
Conversation Goal 기본 4개
의미 있는 Goal 3개 이상 → Mission 완료
```

로 동작한다.

Mission과 Free Chat은 서로 다른 케이가 아니라 동일한 K Conversation Engine을 사용한다.

하루 보상은:

```text
Mission 정상 완료          → 황금열쇠 +1 / 이벤트 +1
Free Chat 일일 유효대화    → 황금열쇠 +1 / 이벤트 +1

하루 최대                  → 황금열쇠 2 / 이벤트 2
```

가 된다.

30일 이벤트 Target은 기존과 동일하게 `60`을 유지하며 기존 참여자의 누적 progress는 절대 감소하지 않는다.

Free Chat에서 일일 보상 조건을 처음 충족하면 `황금열쇠를 받았습니다` 팝업이 1회 표시되지만 대화는 종료되지 않는다.

### 대표님 테스트 정상 프로세스

#### A. Mission

1. Dev 아이 계정으로 13:00 이후 접속한다.
2. 홈에서 `오늘의 미션` 1개가 활성화되어 있는지 확인한다.
3. Mission을 시작한다.
4. 케이와 자연스럽게 대화한다.
5. 아이가 케이에게 역으로 질문하거나 다른 주제로 이야기해본다.
6. 케이가 대화를 차단하지 않고 자연스럽게 응답하는지 확인한다.
7. 의미 있는 Goal 3개 이상이 확보될 정도로 대화한다.
8. Mission이 정상 완료되는지 확인한다.
9. 황금열쇠 +1 및 이벤트 +1이 반영되는지 확인한다.
10. 같은 날 다시 신규 Mission을 시작하려고 한다.
11. 두 번째 신규 Mission이 생성되지 않는지 확인한다.

#### B. Free Chat

1. 같은 날 Free Chat을 시작한다.
2. 의미 있는 아이 발화 3턴 이상, 60초 이상 대화한다.
3. 최초 eligibility 충족 시 `황금열쇠를 받았습니다` 팝업이 1회 표시되는지 확인한다.
4. 팝업을 닫는다.
5. 이전 대화 내용이 그대로 이어지는지 확인한다.
6. 새로운 Free Chat session으로 바뀌지 않는지 확인한다.
7. 황금열쇠 +1 / 이벤트 +1이 추가되는지 확인한다.
8. 같은 날 Free Chat을 계속하거나 다시 시작해도 추가 보상과 팝업이 발생하지 않는지 확인한다.

#### C. 30일 이벤트

1. 기존 참여자의 현재 progress를 확인한다. 예: `7 / 60`
2. Mission v3를 완료한다.
3. `8 / 60`인지 확인한다.
4. Free Chat eligibility를 충족한다.
5. `9 / 60`인지 확인한다.
6. Target이 계속 `60`인지 확인한다.

#### D. 관리자/과거 데이터

1. 관리자에서 오늘 Mission 상태를 확인한다.
2. 신규 날짜는 `오늘 미션` 기준으로 표시되는지 확인한다.
3. 과거 날짜를 조회한다.
4. 기존 `미션 I / 미션 II` 기록이 그대로 보이는지 확인한다.
5. 기존 Report/Event/Reward history가 유지되는지 확인한다.

정상이라면:

- 하루 신규 Mission은 1개만 생성
- Mission 시작 보상 없음
- Goal 3개 이상에서만 완료/보상
- Side Conversation 정상
- Parent Question 정상
- Free Chat 보상 후 동일 대화 계속
- 하루 Gold Key/Event 각각 최대 2
- 기존 이벤트 progress 보존
- Target 60 유지
- 과거 round1/round2 데이터 정상 조회
- Admin/Report/Cron/Analytics가 신규 정책을 동일하게 해석

---

## 1. 목표

기존:

```text
하루 2회
MISSION_I / MISSION_II
질문 개수 기반 완료
고정/반복 질문 중심
```

구조를 폐기하고 다음 구조로 전환한다.

```text
Mission v3 하루 1회
+
Free Chat v2
→ 동일 K Conversation Engine
→ 공통 Reward / Event Contract
```

Mission v3의 제품 정의:

> 케이가 하루 한 번 아이와 약 3~5분 친구처럼 자연스럽게 이야기하면서, 부모 질문을 포함한 숨겨진 Conversation Goal 약 4개 중 의미 있는 3개 이상을 확보하는 Goal-directed Conversation Mode.

아이는 Goal 목록이나 완료 체크리스트를 보지 않는다.

아이 입장에서는:

> 오늘 케이랑 잠깐 이야기했다.

라고 느껴야 한다.

기존 Production의 다음 데이터는 보존한다.

- mission history
- report history
- event history
- reward ledger
- 기존 참여자 progress
- 과거 round1_day / round2_night

---

## 2. 요구사항

### Mission Daily Policy

신규 정책:

```text
round = daily_single
하루 신규 Mission 최대 1회
timezone = Asia/Seoul
기준 = child business_date
Open = 13:00 KST
Close = 23:00 KST
```

- 13:00 이전 신규 시작 금지
- 23:00 이후 신규 시작 금지
- 완료 후 같은 business_date에 두 번째 신규 Mission 생성 금지
- 기존 session resume 정책은 현재 세션 구조를 기준으로 호환
- 과거 round1_day / round2_night는 historical 데이터로 유지

### Mission Completion

기존 질문 개수/유효답변 개수 기반 완료 조건은 Mission v3 신규 데이터에 적용하지 않는다.

```text
기본 Goal = 4개
정상 완료 = 의미 있는 Goal 3개 이상
```

규칙:

- 질문 개수는 완료 조건이 아님
- 아이 발화 하나가 여러 Goal을 충족할 수 있음
- evidence가 있는 Goal만 만족 처리
- 동일 정보를 표현만 바꿔 재질문하지 않음
- Goal 확보 목적의 반복 추궁 금지

Boredom 조기 종료:

```text
Goal ≥ 3 → 정상 완료 가능
Goal ≤ 2 → 조기 종료 저장 / 정상 완료 아님 / Mission 보상 없음
```

아이 UI에는 `실패` 표현을 사용하지 않는다.

### Goal Priority

```text
P0 Parent Question
P1 Periodic Goal
P2 Weekday Theme
P3 Memory / Fun / Relationship
```

Parent Question은:

- `parent_questions` 재사용
- 가장 높은 Goal 우선순위
- 실제 아이에게 자연스럽게 질문
- 부모가 요청한 질문이라는 사실을 아이에게 노출하지 않음
- `parent_question_id`와 실제 evidence 연결
- SATISFIED / DECLINED / SKIPPED 상태 추적
- 아이가 거절하면 같은 세션 반복 추궁 금지
- Safety와 충돌하면 Safety 우선

### 공통 K Conversation Engine

Mission v3와 Free Chat v2는 동일한 K Conversation Engine을 사용한다.

공통 영역:

- K Core Persona
- Grade Persona 1~6
- Relationship Context
- Same-session History
- Recent Episode
- Long-term Memory / LLM Wiki
- Semantic Topic History
- Boredom Detection
- Conversation Action Selector
- Safety
- Response Generator

Mission 전용:

- Parent Question
- Conversation Goal
- Goal Priority
- Goal Satisfaction
- Weekday / Periodic Goal
- Mission Completion
- Mission Reward/Event

원칙:

```text
공통 K Engine → 어떻게 말할지
Mission Goal Layer → 무엇을 확보할지
```

Mission route에서 Persona / Memory / Action / Safety / Response Generator를 별도 재구현하지 않는다.

### Grade Persona

1~6학년 각각 독립 Persona를 사용한다.

학년 그룹화 금지.

학년 변경 시:

- Grade Persona만 다음 학년으로 전환
- Memory 유지
- Relationship History 유지
- Recent Episode 유지
- K와 아이의 누적 관계 유지

### Conversation Action / Side Conversation

매 턴 `공감 + 질문` 패턴을 강제하지 않는다.

Conversation Action은 상황에 따라 EMPATHY, CURIOSITY, JOKE, MEMORY_RECALL, OWN_OPINION, PLAYFUL_TEASING, TOPIC_SHIFT, JUST_LISTEN 등으로 선택한다.

아이 질문이나 화제 전환은 Mission 방해로 처리하지 않는다.

```text
MISSION
→ 아이 질문/다른 이야기
→ SIDE_CONVERSATION
→ 자연스러운 대화
→ 이 과정에서도 Goal 충족 가능
→ 필요한 경우에만 Mission Resume
```

- 아이가 K에게 질문하면 먼저 답변
- “지금은 미션 중이야” 식 차단 금지
- 무조건 원래 질문으로 복귀하지 않음
- 아이 화제를 Goal 확보 목적으로 강제로 끊지 않음

### Goal Satisfaction

질문과 Goal은 1:1이 아니다.

한 발화에서 여러 의미를 확보할 수 있어야 한다.

최소 추적 의미:

```text
goal_id
semantic_group
evidence_source
source_turn_id
confidence
satisfied_at
parent_question_id
status
```

상태:

```text
SATISFIED
PARTIAL
DECLINED
SKIPPED
```

LLM 판정을 사용하는 경우:

- structured output
- runtime validation
- evidence 없는 만족 판정 금지

### Dynamic Conversation Library

기존 학년별 질문 데이터는 삭제하지 않는다.

기존 질문은행을 고정 질문 리스트가 아니라 Conversation Starter Library로 재사용한다.

metadata는 기존 schema를 우선 활용한다.

핵심 개념:

- grade
- semantic_group
- weekday affinity
- topic
- conversation/fun style
- cooldown
- memory usage
- sensitivity
- periodicity

불필요한 DB 컬럼을 추가하지 않는다.

### Semantic Topic History / Cooldown

질문 ID가 달라도 의미가 같으면 같은 topic으로 취급한다.

예:

```text
오늘 기분 어때?
마음 날씨는?
기분을 색깔로 하면?
오늘 몇 점이야?

→ MOOD_CHECK
```

규칙:

- K가 먼저 같은 의미를 반복 질문하는 것 제한
- 아이가 먼저 같은 주제를 꺼내는 것은 제한하지 않음
- Parent Question P0는 일반 cooldown보다 우선 가능
- 동일 Parent Question 반복 추궁 금지
- Rose-Thorn-Bud 및 감정 질문을 매일 고정하지 않음

요일별 정책은 고정 질문 세트가 아니라 **주제/분위기 가중치**로 사용한다.

### Boredom Detection

다음과 같은 반복 신호를 감지한다.

- 몰라
- 없어
- 그냥
- 또 이거야?
- 재미없어
- 패스
- 질문 그만해
- 짧은 비협조 응답 반복
- topic dodge 반복

대응:

```text
question_rate ↓
same_topic_stop
fun_type ↑
child_choice ↑
topic_shift ↑
early_finish 가능
```

Goal을 채우기 위해 질문량을 늘리지 않는다.

### Reward Contract

하루 최대:

```text
Mission 정상 완료             → Gold Key +1
Free Chat Daily Engagement    → Gold Key +1

Daily Gold Key Maximum        → 2
```

Mission 시작 보상은 없다.

Mission Reward 조건:

- daily_single Mission
- Goal 3개 이상
- 정상 완료

Free Chat Daily Reward eligibility:

- 하루 1회
- 화면 진입만으로 지급 금지
- 의미 있는 아이 발화 ≥ 3턴
- session ≥ 60초
- spam/repetition/reward farming 검증 PASS

Reward type:

```text
MISSION_COMPLETE
FREE_CHAT_DAILY_ENGAGEMENT
```

최소 idempotency 의미:

```text
child_id + business_date + reward_type
```

보장:

- refresh duplicate 0
- retry duplicate 0
- resume duplicate 0
- concurrent duplicate 0
- same-day multiple Free Chat duplicate 0

Mission과 Free Chat은 각각 자신의 하루 quota만 사용한다.

### Free Chat Reward UX

Free Chat 최초 일일 eligibility 충족 즉시:

`황금열쇠를 받았습니다`

팝업을 정확히 1회 표시한다.

팝업은:

- Free Chat 종료 금지
- 홈/이벤트/보상 화면 강제 이동 금지
- 현재 session_id 유지
- conversation context 유지
- timer/session 상태 유지
- 닫은 후 동일 세션으로 복귀
- 직전 Context로 그대로 대화 계속

같은 날 이미 Free Chat reward를 받은 경우:

- 자유대화 계속 가능
- 추가 Gold Key 없음
- 추가 Event 없음
- 추가 reward popup 없음

Free Chat v2 전체 대화 구현은 별도 Request가 담당한다.

073에서는 위 Reward/Event/Popup/Session Continuity Contract를 확정한다.

### 30일 Event

기존 Target:

```text
60
```

을 유지한다.

신규 활동:

```text
Mission Complete              → Event +1/day
Free Chat Daily Engagement    → Event +1/day

Daily Event Maximum           → 2
30-day Target                 → 60
```

`30`, `30+d`, `34`, `35` 등의 신규 Target 계산은 사용하지 않는다.

기존 참여자 progress를 재계산하거나 감소시키지 않는다.

예:

```text
기존 7/60
→ Mission v3 완료 8/60
→ Free Chat eligible 9/60
```

신규 참여자도 Target 60을 사용한다.

Legacy와 신규 활동은 source/activity type으로 구분 가능해야 한다.

예:

```text
LEGACY_MISSION_ROUND_COMPLETE
MISSION_COMPLETE
FREE_CHAT_DAILY_ENGAGEMENT
```

### Reward/Event 일관성

Mission 완료:

```text
Gold Key +1
Event +1
```

Free Chat eligibility:

```text
Gold Key +1
Event +1
Reward Popup 1회
```

동일 eligibility event 기준으로 처리하며 각 시스템의 idempotency를 보장한다.

한쪽만 성공한 경우 retry로 일관성을 복구할 수 있어야 한다.

기존 transactional/RPC 구조가 있으면 우선 재사용한다.

### Policy Effective Date

Production Cutover는 명시적으로 구분한다.

```text
mission_policy_version = v3_single_daily
effective_at = <Production Cutover KST>
```

의미:

```text
effective_at 이전 → 기존 하루 2회 정책
effective_at 이후 → Mission v3 하루 1회 정책
```

기존 config/metadata/settings 구조가 있으면 재사용한다.

### Cron / Conversation Pipeline

Mission 데이터 수집은 신규 정책에서 하루 1회 마감 구조로 전환한다.

조건:

- 23:00 Mission close 이후
- 04:00 Daily Report 이전 완료
- late write 포함
- retry-safe
- idempotent
- raw/corrected 중복 생성 금지
- 부분 수집 상태에서 Report 생성 금지

Mission / Free Chat source를 정확히 구분한다.

과거 round1/round2 데이터는 계속 조회 가능해야 한다.

### Reports

Daily / Weekly / Monthly / Detail Report에서 신규 날짜에 대한 하루 2회 전제를 제거한다.

신규 Mission v3 날짜에서 `round2_night 없음`을 incomplete로 판단하지 않는다.

과거 날짜는 기존 하루 2회 정책으로 표시한다.

Report에서는 최소 다음을 정책에 맞게 해석한다.

- session count
- mission count
- free chat count
- expected mission/day
- completion
- Goal satisfaction
- missing mission 판단
- report completeness

### Admin / Frontend

신규 날짜:

```text
오늘 미션
완료 / 진행중 / 미완료
```

과거 날짜:

```text
미션 I
미션 II
```

Event/Admin에서 최소 다음을 구분한다.

```text
Legacy Mission
Mission v3
Free Chat Activity
Daily Total
Progress / 60
```

아이/부모 Frontend에서는 하루 2회 Mission 전제를 제거한다.

신규 Mission UI:

- 오늘의 미션 1개
- 13:00~23:00
- 완료 후 신규 Mission 차단
- resume 가능
- 정상 완료 시 Gold Key +1
- Mission 시작 보상 UI 없음

### Analytics

`effective_at` 전후 정책을 분리해 분석한다.

기존 하루 2회 KPI와 신규 하루 1 Mission + Free Chat KPI를 단순 비교해 왜곡하지 않는다.

최소 구분:

- Mission 참여/완료/지속시간
- Goal Satisfaction
- Side Conversation
- Boredom/Early Finish
- Mission Reward
- Free Chat Reward
- Mission Event
- Free Chat Event
- both-activity day
- reward farming rejection
- event progress / 60

---

## 3. 기존 구조 확인

구현 전에 이번 전환과 직접 관계된 Source of Truth만 확인한다.

필수 확인:

- 현재 Mission completion rule
- round enum/constraints
- mission progress
- Mission start/resume/time gate
- parent_questions
- 현재 질문 selection
- 071/072 공통 K Engine
- Grade Persona 1~6
- Memory/Relationship 연결
- Semantic Topic/Boredom/Action 구조
- Gold Key balance/cap
- reward ledger/idempotency
- Free Chat reward 기존 구현 여부
- 현재 Event progress/count source
- Event Target 60
- Event reward trigger
- Cron / data collection
- raw/corrected conversation pipeline
- Report timing/completeness
- 관리자 Mission/Event/Reward 화면
- 아이/부모 Mission UI
- Analytics source

과거 감사에서 완료 기준이 상충한 기록이 있으므로 **현재 실행 코드와 DB를 Source of Truth로 확정**한다.

071/072에 이미 구현된:

- Persona
- Memory
- Semantic Topic History
- Boredom
- Action Selector
- Safety
- Response Generator

는 073에서 재구현하지 않는다.

코드에서 확인 가능한 내용을 Request에서 추정하지 않는다.

관련 없는 프로젝트 영역까지 조사 범위를 확대하지 않는다.

---

## 4. 금지

### 데이터/호환성

- destructive migration
- 기존 Production 데이터 삭제/초기화
- 과거 `round1_day / round2_night` UPDATE/DELETE
- 기존 event progress 감소
- 기존 progress 재계산
- 기존 reward 자동 회수
- historical admin/report 손상

### Mission

- 하루 2개의 신규 Mission 생성
- 질문 개수를 신규 완료 조건으로 사용
- Mission 시작 보상
- Parent Question 제거
- Parent Question 출처 아이에게 노출
- 거절한 Parent Question 반복 추궁
- Goal 확보 목적 반복 질문
- 동일 semantic topic 반복 질문
- 매일 감정 질문 강제
- Goal 체크리스트 아이에게 노출
- Mission 전용 Persona/Memory/Action/Safety 엔진 복제

### Reward/Event

- Target 60 변경
- `30+d` 등 신규 Target 정책 구현
- 하루 Gold Key 2 초과
- 하루 Event Activity 2 초과
- reward/event duplicate
- Free Chat 화면 진입만으로 보상
- 60초 무발화만으로 보상
- 반복 문구 farming 보상
- Mission과 Free Chat quota 혼용

### Free Chat UX

- Reward popup 표시 후 대화 종료
- Reward popup 표시 후 다른 화면 강제 이동
- Popup 닫은 후 새 session 생성
- conversation context 초기화
- 동일 business_date reward popup 중복 표시

### System

- Frontend만 하루 1회로 변경하고 backend/admin/cron/report 방치
- 신규 날짜에서 round2 없음 때문에 incomplete 처리
- Free Chat v2 미준비 상태에서 신규 Event 정책 임의 활성화
- Dev Gate 실패 후 Production 배포
- Phase별 부분 Production Cutover
- 테스트 삭제/완화
- secret/token 출력
- 아이 발화 원문 debug logging
- 관련 없는 리팩터링

---

## 5. 모호성 처리

Request와 현재 코드로 판단 가능한 사항은 현재 구조를 기준으로 진행한다.

다음과 같은 경우 관련 Skill/Reference만 추가 확인한다.

- 기존 completion rule과 문서가 충돌
- round enum 변경 방식이 여러 개 가능
- Mission/Free Chat reward ledger가 서로 다른 구조를 사용
- Event와 Reward의 transactional consistency 방식이 불명확
- 기존 Cron/Report가 하루 2회 정책에 강하게 종속
- Free Chat v2 readiness 상태가 불명확
- `effective_at` 저장 위치가 여러 개 존재
- 기존 Persona/Memory/Goal 코드의 책임 경계가 불명확

Reference까지 확인해도 다음 중 하나가 남으면 임의 구현하지 않는다.

- Production 데이터 손상 가능성
- legacy progress 감소 가능성
- Reward/Event 중복 가능성
- Mission/Free Chat 정책 활성화 시점 충돌
- 아이 UX가 선택지에 따라 달라짐
- 공통 K Engine과 Mission Goal Layer 책임 경계가 달라짐

이 경우 해당 지점에서 중단하고 다음만 보고한다.

1. 불명확한 지점
2. 현재 코드 기준 가능한 선택지
3. 선택지별 사용자/데이터 영향
4. 기존 정책 기준 권장 방향

---

## 6. QA

`qa-scope` Skill을 적용한다.

이번 Request는 여러 핵심 시스템 계약을 변경하므로 실제 diff가 해당 영역을 변경할 경우 필요한 고위험 QA를 수행한다.

이번 Request의 필수 Gate:

### Mission

- 12:59 신규 시작 차단
- 13:00 신규 시작 성공
- 23:00 이후 신규 시작 차단
- 같은 business_date 두 번째 Mission 차단
- resume 정상
- Goal 4개 구성
- Goal 3개 이상 완료
- Goal 2개 이하 조기 종료 시 미완료/무보상
- multi-goal evidence 정상
- Parent Question P0 정상
- declined 반복 추궁 없음
- Side Conversation 정상
- Boredom/cooldown 정상
- Grade Persona 1~6 정상

### Reward / Event

- Mission 시작 보상 0
- Mission 완료 Gold Key +1 / Event +1
- Free Chat 미충족 +0
- Free Chat eligibility Gold Key +1 / Event +1
- Reward popup 정확히 1회
- Popup 전후 동일 session_id/context
- same-day Free Chat 추가 reward/popup 0
- retry/refresh/resume/concurrent duplicate 0
- 하루 Gold Key ≤ 2
- 하루 Event ≤ 2

### Legacy / Data

- 기존 progress 감소 0건
- Target 60 유지
- 과거 round1/round2 조회 정상
- 신규 날짜 round2 missing으로 incomplete 처리하지 않음
- raw/corrected 중복 없음
- Cron/Report 정상
- Mission/Free Chat source 구분 정상

### Admin / Frontend

- 신규 날짜 daily_single 표시 정상
- 과거 날짜 Mission I/II 표시 정상
- Reward/Event source 구분 정상
- 이벤트 progress `/60` 정상

모든 Dev 필수 Gate 통과 전 Production Cutover 금지.

---

## 7. 완료 조건

다음이 모두 일관되게 동작하면 완료한다.

### Mission

- 하루 1회 `daily_single`
- 13:00~23:00 신규 시작
- 약 3~5분 Goal-directed Conversation
- 기본 Goal 4개
- 의미 있는 Goal 3개 이상 정상 완료
- Side Conversation 지원
- Parent Question P0
- Semantic Cooldown
- Boredom Detection
- Grade Persona 1~6
- Memory/Relationship 유지
- 공통 K Conversation Engine 재사용

### Reward/Event

- Mission 정상 완료 +1/+1
- Free Chat eligibility +1/+1
- 하루 최대 각각 2
- Free Chat reward popup 1회
- 동일 session/context 유지
- idempotency 보장
- Target 60 유지
- 기존 참여자 progress 보존

### System

- Frontend 신규 정책 반영
- Admin policy-aware rendering
- Cron 하루 1회 정책 대응
- Raw/Corrected Pipeline 정상
- Daily/Weekly/Monthly/Detail Report 정상
- Analytics effective_at 전후 구분
- 과거 데이터 하위호환
- 기존 Production history 보존

Production Cutover는 전체 Dev Gate 통과 후 하나의 명시적인 `effective_at` 기준으로 수행한다.

Free Chat v2가 Production-ready가 아닌 경우 신규 Event/Reward Contract는 준비하되 임의 활성화하지 않는다.

요구사항을 넘어선 추가 시스템 개편은 수행하지 않는다.

---

## 8. 완료 보고

아래만 간단히 보고한다.

1. AS-IS → TO-BE
2. 주요 수정 파일
3. DB migration 유무
4. `effective_at`
5. Mission completion / Goal Engine 결과
6. Parent Question / Dynamic Conversation / Cooldown 결과
7. Grade Persona / Memory 공통 Engine 재사용 결과
8. Mission Reward / Free Chat Reward Contract 결과
9. Free Chat popup / session continuity 결과
10. Event Target 60 / legacy progress 보존 결과
11. Daily max 2 / idempotency 결과
12. Cron / Pipeline / Report 결과
13. Admin / Frontend / Analytics 결과
14. QA Level 및 필수 Gate 결과
15. Production Cutover / Smoke 결과
16. Commit SHA
17. 남은 위험이 있는 경우만 해당 내용

최종 판정:

`PASS` 또는 `BLOCKED`

다음과 같은 문제가 남으면 PASS 처리하지 않는다.

- Production 데이터 손상 위험
- legacy progress 감소
- Reward/Event 중복
- 하루 최대 2 위반
- Parent Question/Safety 오류
- sibling Memory 혼합
- historical Admin/Report 손상
- Cron/Report 실패
- Free Chat session continuity 손상
- 지속적인 Production 5xx