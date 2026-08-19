`074-feature-relationship-engine-v1.md`

# REQUEST #074 — Relationship Engine V1: Stage × Grade Strategy × Scenario Card + Memory V3 + Relationship Events

- 상태: TODO
- 유형: 핵심 기능 신규 구현
- 우선순위: HIGH
- 대상: Gemini Live / Relationship Context / Memory V3 / Relationship Events / 관련 DB
- 핵심 방향: 관계 전략 실행 + 실제 관계 행동 데이터 축적
- 비범위: Relationship Score / 자동 최적화 / 신규 Memory System

---

## 0. 완료 시 기대 결과 / 대표님 테스트 정상 프로세스

### 완료 시 기대 결과

아이마다 현재 관계 단계와 학년에 맞는 전략이 자동 선택되고, Gemini Live가 그 전략과 기존 Memory V3를 참고해 자연스럽게 대화한다.

핵심 구조:

```text
Relationship Stage
×
Grade Strategy
→ Scenario Card
→ Memory V3
→ Gemini Live
→ Relationship Events
```

초기 Stage:

```text
W1 = MEET
W2 = REMEMBER
W3 = SHARED_HISTORY
W4 = VOLUNTARY_RETURN
```

학년:

```text
G1 ~ G6
```

따라서 운영 가능한 Scenario Card는:

```text
4 stages × 6 grades = 24 cards
```

이다.

정상 완료되면:

- 아이의 가입 경과일에 따라 `calendar_stage`가 계산된다.
- 실제 행동 조건을 충족한 범위까지만 `effective_stage`가 올라간다.
- 해당 학년 + Stage의 active Scenario Card가 정확히 하나 선택된다.
- 기존 Memory V3에서 필요한 기억만 Session Start 시 가져온다.
- Gemini Live는 Scenario를 대본처럼 읽지 않고 자연스럽게 적용한다.
- 실제 발생한 관계 행동은 Relationship Event로 기록된다.
- 기존 Mission / Free Chat / Memory Pipeline은 그대로 유지된다.

### 대표님 테스트 정상 프로세스

#### A. Stage 확인

1. Dev에서 테스트 아이의 가입 경과일을 확인한다.
2. 해당 아이로 Gemini Live 대화를 시작한다.
3. 관리자 또는 DB 확인 화면에서 `calendar_stage`와 `effective_stage`를 확인한다.
4. 가입일 기준 Stage가 맞는지 확인한다.
5. 행동 조건이 부족한 경우 `effective_stage`가 `calendar_stage`보다 낮게 유지되는지 확인한다.

정상이라면:

```text
effective_stage <= calendar_stage
```

가 항상 유지된다.

#### B. Scenario / Grade 확인

1. 예를 들어 3학년 아이를 사용한다.
2. `effective_stage = REMEMBER` 상태로 세션을 시작한다.
3. 실제 선택된 Scenario를 확인한다.
4. `G3 + REMEMBER`의 active Scenario가 사용되는지 확인한다.
5. 같은 세션 중 active Scenario version을 변경한다.
6. 현재 세션은 기존 version을 계속 사용하는지 확인한다.
7. 새 세션을 시작해 새로운 version이 적용되는지 확인한다.

#### C. Memory 확인

1. 기존 Memory V3에 기억이 존재하는 아이로 세션을 시작한다.
2. 세션 시작 시 필요한 Memory Pack만 불러오는지 확인한다.
3. Gemini가 필요한 경우에만 과거 기억을 자연스럽게 사용하는지 확인한다.
4. 아이가 현재 속상한 이야기를 하면 과거 Memory를 억지로 끼워 넣지 않는지 확인한다.
5. “전에 내가 말한 거 기억나?”처럼 직접 묻고 정상적으로 추가 Memory Retrieval이 되는지 확인한다.

#### D. Relationship Event 확인

1. 아이가 직접 Free Chat을 시작하거나 기존에 정의된 entry 행동을 한다.
2. 해당 Relationship Event가 기록되는지 확인한다.
3. 같은 이벤트를 retry한다.
4. duplicate event가 생기지 않는지 확인한다.
5. 불명확한 semantic event가 임의로 생성되지 않는지 확인한다.

#### E. 장애 상황

1. DEV에서 Scenario 또는 Memory Retrieval 일부 실패 상황을 만든다.
2. Gemini Live 대화가 가능한 범위에서 계속되는지 확인한다.
3. Relationship 기능만 fallback되고 기존 대화 자체가 불필요하게 종료되지 않는지 확인한다.

정상이라면:

- Stage/Scenario 선택 정상
- 동일 session에서 Scenario version 고정
- Memory V3만 사용
- fake memory 없음
- Relationship Event duplicate 없음
- 기존 Gemini Live 대화 유지
- Mission / Free Chat / Memory Pipeline 회귀 없음

---

## 1. 목표

내친구 케이의 초기 4주 관계 형성 전략을 코드/DB/런타임에서 안정적으로 실행하는 **Relationship Engine V1**을 구현한다.

V1의 목표는 두 가지다.

1. 사전에 설계된 관계 전략을 아이별 학년·관계 단계에 맞게 Gemini Live에 안정적으로 적용
2. 실제 아이 행동을 Relationship Event로 신뢰성 있게 축적

핵심 아키텍처:

```text
Relationship Stage
        ×
Grade Strategy
        ↓
Scenario Card
        ↓
Memory V3
        ↓
Relationship Context
        ↓
Gemini Live
        ↓
Relationship Events
```

이번 Request는 관계 AI 플랫폼 전체를 만드는 작업이 아니다.

V1 완료 정의:

```text
관계 전략 실행
+
행동 데이터 축적
```

---

## 2. 요구사항

### Relationship Stage

초기 Stage:

```text
W1 = MEET
W2 = REMEMBER
W3 = SHARED_HISTORY
W4 = VOLUNTARY_RETURN
```

가입 경과일 기준 `calendar_stage`:

```text
D1  ~ D7  → W1
D8  ~ D14 → W2
D15 ~ D21 → W3
D22 이후   → W4
```

D22 이후에는 V1 범위에서 계속 W4를 유지한다.

가입일 Source of Truth는 기존 child 데이터에서 실제 사용 중인 필드를 확인해 사용한다.

새로운 가입일 기준 필드를 임의 생성하지 않는다.

### calendar_stage / effective_stage

`calendar_stage`는 시간 기준 후보 상한선이다.

실제 Gemini Live에 적용되는 값은 `effective_stage`다.

항상:

```text
effective_stage <= calendar_stage
```

를 유지한다.

`effective_stage`는 최소 행동 조건을 충족한 Stage까지만 진행한다.

조건 후보:

- 실제 대화 여부
- 대화 횟수
- 실제 대화 일수
- usable memory 존재
- shared memory 존재
- Relationship Event 존재

복잡한 scoring model은 만들지 않는다.

V1 progression:

```text
W1 → W2 → W3 → W4
```

자동 downgrade는 구현하지 않는다.

### Stage Threshold

Stage 진입 threshold는 코드 상수로 하드코딩하지 않는다.

DB/config에서 운영 중 변경 가능해야 한다.

최소 개념:

```text
stage
min_conversation_count
min_conversation_days
min_usable_memory_count
min_shared_memory_count
min_relationship_event_count
active
version
```

- migration 없이 threshold 변경 가능
- 복잡한 DSL/rule engine 금지
- 숫자 threshold + boolean 조건 수준 유지
- 초기 threshold 값은 승인된 실제 값을 우선 사용
- 확인되지 않은 숫자를 임의 발명하지 않음

### Grade Strategy

1~6학년 각각 별도 Grade Strategy를 사용한다.

표현 전략 최소 요소:

- vocabulary level
- sentence length
- question length
- question frequency
- conversation lead ratio
- humor/playfulness
- emotional reaction style
- memory recall directness
- play ratio
- autonomy level

Grade Strategy는 Relationship Stage와 분리 관리한다.

같은 학년 전략을 각 Scenario Card마다 중복 복제하지 않는다.

### Scenario Card

운영 Scenario:

```text
4 stages × 6 grades = 24 cards
```

예:

```text
G3_REMEMBER_V1
```

Scenario Card는 완성 대본이 아니다.

최소 책임:

- primary_goal
- secondary_goal
- strategy
- recommended_memory_types
- forbidden_patterns
- response_style
- expected_events
- version

Stage 공통 목표:

```text
MEET
→ 얘랑 이야기해도 괜찮네.

REMEMBER
→ 케이가 나를 기억하고 있구나.

SHARED_HISTORY
→ 우리 둘이 아는 이야기가 생겼다.

VOLUNTARY_RETURN
→ 오늘 케이한테 이야기하고 싶다.
```

실제 자연어 발화는 Gemini Live가 생성한다.

### Scenario Versioning

Scenario는 version 관리 가능해야 한다.

예:

```text
G3_REMEMBER_V1
G3_REMEMBER_V2
```

원칙:

- 기존 version row 수정으로 과거 이력 파괴 금지
- 새로운 전략은 새 version 생성
- active version 전환 가능
- 동일 `grade + stage`에 active version은 정확히 하나
- session 시작 시 사용한 Scenario version은 해당 session 동안 고정
- 과거 session이 어떤 version을 사용했는지 재현 가능

### Stage Rule Versioning

Stage threshold 변경 이력을 추적 가능해야 한다.

복잡한 experiment framework는 만들지 않는다.

최소 version/history만 확보한다.

### Memory V3

Relationship Engine은 기존 Memory V3의 **소비자**다.

새 Memory System을 만들지 않는다.

구조:

```text
Scenario Card
→ recommended_memory_types
→ Memory V3 Retrieval
→ Fact + Evidence
→ Session Memory Pack
```

원칙:

- 기존 Memory Retrieval V3 우선
- 기존 legacy fallback 정책이 있으면 그대로 유지
- V3와 legacy memory를 중복 주입하지 않음
- embedding/source of truth를 새로 정의하지 않음

### Session Memory Pack

Memory Retrieval은 기본적으로 Session Start 시 1회 수행한다.

Context:

```text
Child Profile
+ effective_stage
+ Grade Strategy
+ Scenario Card
+ Memory Pack
+ Play / Reward / Entry Context
```

Memory Pack limit은 config에서 관리한다.

Relationship Layer에서 신규 ranking 알고리즘을 만들지 않는다.

기존 Memory V3 ranking을 사용한다.

### On-demand Memory Retrieval

매 발화 retrieval은 금지한다.

추가 retrieval 허용:

- 아이가 과거 기억을 직접 요청
- “전에 말한 거 기억나?” 등 명시적 요청
- 현재 Memory Pack만으로 과거 맥락 대응이 어려운 경우

실제 Gemini Live tool/function calling 구조를 확인해 기존 convention을 사용한다.

retrieval 실패가 전체 Live Session을 종료시키면 안 된다.

### Relationship Context Builder

Relationship Context Builder는 다음을 조합한다.

```text
Child Profile
+ Relationship State
+ Grade Strategy
+ Scenario Card
+ Memory Pack
+ Play / Reward / Entry Context
→ Gemini Live Relationship Context
```

기존 Persona/System Instruction 구조에 통합한다.

새 Conversation Engine을 만들지 않는다.

### Gemini Live 우선순위

Gemini가 다음 우선순위를 따르도록 한다.

```text
1. 현재 아이의 발화와 즉시 감정/상황
2. Safety + 기본 K Persona
3. Relationship Scenario
4. Memory
5. Play / Reward Context
```

Scenario는 목표이지 강제 대본이 아니다.

현재 아이의 이야기와 감정이 항상 우선한다.

### Relationship Events

Relationship Event는 **관계 점수가 아니라 사실 데이터**다.

초기 event 후보:

```text
memory_used
memory_acknowledged
child_referenced_past
child_started_free_chat
direct_open
notification_entry
reward_entry
play_to_chat
returned_after_gap
```

확실히 알 수 있는 이벤트는 deterministic하게 기록한다.

예:

```text
child_started_free_chat
direct_open
notification_entry
reward_entry
play_to_chat
returned_after_gap
```

`returned_after_gap`의 threshold도 config로 관리한다.

의미 판단이 필요한 이벤트:

```text
memory_used
memory_acknowledged
child_referenced_past
```

는:

- runtime/tool metadata로 명확히 판단 가능하면 기록
- 불명확하면 기록하지 않음
- 매 턴 별도 LLM judge 호출 금지
- 추정 기반 positive event 생성 금지

`expected_events`는 관찰 metadata일 뿐 관계 성공 점수로 사용하지 않는다.

### Voluntary Return

`direct_open` 하나만으로 `VOLUNTARY_RETURN 성공`으로 판정하지 않는다.

이번 Request에서는 자동 Voluntary Return scoring을 구현하지 않는다.

사실 Event만 저장한다.

### Entry Context

Session Start 시 실제 신뢰 가능한 경우에만 진입 source를 저장한다.

후보:

```text
direct_open
notification
reward
play
parent_trigger
unknown
```

존재하지 않는 entry source를 추정하지 않는다.

### Play / Reward

Play/Reward 비즈니스 로직은 Relationship Engine에 합치지 않는다.

Session Context Builder에서 실제 존재하는 최소 상태만 읽어 Gemini context에 전달할 수 있다.

이번 Request에서 Play/Reward 정책 자체는 변경하지 않는다.

### Session Freeze

Session Start 시 확정한:

- effective_stage
- Scenario ID/version
- Grade Strategy/version
- Memory Fact IDs

는 해당 session 동안 고정한다.

세션 중 active Scenario가 변경되어도 기존 session에는 반영하지 않는다.

---

## 3. 기존 구조 확인

코드 변경 전에 이번 기능과 직접 관계된 Source of Truth만 확인한다.

필수 확인:

- child 가입일 Source of Truth
- child grade Source of Truth
- Gemini Live session 생성 위치
- 현재 Persona/System Instruction builder
- Memory Retrieval V3 entry point
- Memory Fact / Evidence ID 구조
- 현재 chat session Source of Truth
- 현재 entry source 식별 가능 여부
- Play/Reward/Golden Key context source
- 기존 telemetry/logger
- 기존 child auth/RLS
- config/settings 저장 패턴
- 기존 schema/naming/index convention
- 기존 Relationship 또는 유사 구조 존재 여부

DB 추가 전 기존 테이블/컬럼과 역할이 중복되는지 먼저 확인한다.

개념적으로 필요한 저장 구조:

- Relationship Stage 정의
- Grade Strategy
- Stage Rule/Threshold
- Scenario Card
- child relationship state snapshot
- session relationship context
- Relationship Events

실제 테이블명과 필드는 기존 Repository convention을 기준으로 최소 설계한다.

중요 데이터 원칙:

- child relationship state에 conversation count/memory count/event count를 별도 Source of Truth로 복제하지 않는다.
- 실제 기존 Source에서 계산하고 필요 시 snapshot metadata만 저장한다.
- Memory 본문을 session context에 복제하지 않고 기존 Memory Fact ID만 참조한다.
- Relationship Event는 logical event key 기준 idempotency를 보장한다.

코드에서 확인 가능한 내용을 추측하지 않는다.

관련 없는 Repository 전체로 조사 범위를 확대하지 않는다.

---

## 4. 금지

### Relationship Architecture

- 24개의 독립 Conversation Engine
- 24개의 완성 대본
- Relationship Engine과 Memory Engine 결합
- Scenario Card를 Script로 사용
- Relationship Event를 Relationship Score로 사용
- LLM이 매 세션 Stage 자체를 추론
- LLM이 매 턴 관계 성공도 평가
- 자동 Stage downgrade
- 30/60/90일 Stage 확장
- Relationship Score 0~100
- 자동 Scenario 생성/최적화
- A/B Experiment Platform 구축
- Voluntary Return 자동 점수화
- 부모 행동 추론

### Memory

- 신규 child memory table
- 별도 embedding store
- Relationship 전용 Memory Source of Truth
- 모든 Memory를 Gemini에 dump
- 매 발화 vector retrieval
- 기존 Memory Batch 구조 변경
- Memory Fact schema 재설계
- embedding model 변경
- Evidence 관계 변경
- duplicate memory store

### 기존 서비스

다음 비즈니스 로직을 변경하지 않는다.

- Mission progression
- Mission reward
- Mission completion
- Free Chat persistence
- Collection V3
- Context Correction
- Memory Batch
- Daily Report
- Play/Reward 비즈니스 로직

### 데이터/보안

- Production 데이터 delete/recreate
- destructive migration
- 기존 역할과 중복되는 테이블 생성
- child_id를 client 입력만 믿고 조회
- Service Role 범위 확대
- secret/민감정보 로그 출력
- 랜덤 timestamp만으로 idempotency 판단
- 관련 없는 리팩터링

---

## 5. 모호성 처리

Request와 현재 코드로 판단 가능한 사항은 기존 구조를 기준으로 진행한다.

다음 경우 관련 코드와 필요한 Skill/Reference만 추가 확인한다.

- child 가입일 Source of Truth가 여러 개 존재
- 기존 Relationship 유사 테이블이 이미 존재
- Grade Strategy 저장 위치가 기존 Persona 구조와 겹침
- Stage threshold 저장 방식이 config/table 중 여러 방식으로 가능
- Memory Retrieval V3 entry point가 여러 개 존재
- Gemini Live Context 삽입 위치가 여러 단계에 존재
- session entry source가 현재 안정적으로 식별 가능한지 불명확
- deterministic/semantic Event 구분이 현재 metadata만으로 확정되지 않음

Reference까지 확인해도 다음 중 하나가 남으면 임의 구현하지 않는다.

- 새로운 Source of Truth가 이중화됨
- 기존 Memory V3 정책과 충돌
- 기존 Mission/Free Chat 동작 변경이 필요
- Scenario와 Grade Strategy 책임 경계가 달라짐
- Stage threshold 초기값을 승인 없이 발명해야 함
- 개인정보/RLS 위험이 발생함

이 경우 해당 지점에서 중단하고 다음만 보고한다.

1. 불명확한 지점
2. 가능한 선택지
3. 선택지별 실제 시스템 영향
4. 기존 구조 기준 권장 방향

---

## 6. QA

`qa-scope` Skill을 적용하여 실제 최종 diff의 위험도에 맞는 최소 충분 QA만 수행한다.

이번 Request의 필수 Gate:

### Stage

- D1/D7 → W1
- D8/D14 → W2
- D15/D21 → W3
- D22 이후 → W4
- `effective_stage <= calendar_stage`
- 조건 미충족 시 낮은 effective_stage 유지
- 자동 downgrade 없음
- threshold 변경 시 application code 수정 없이 Stage 판정 변경 가능

### Scenario / Grade

- 4 Stage × 6 Grade = 24 Scenario 운영 가능
- 정확한 grade + effective_stage Scenario 선택
- 동일 grade + stage active Scenario 1개 보장
- Scenario versioning 정상
- session 도중 Scenario version 변경 없음
- 신규 session부터 새 active version 적용
- Grade Strategy version 추적 가능

### Memory

- Session Start Memory V3 preload 1회
- configured pack limit 준수
- 신규 Memory Store 없음
- usable Memory 없음 → fake memory 생성 없음
- 일반 발화마다 retrieval 없음
- 명시적 과거 기억 요청 시 on-demand retrieval 가능
- Memory Retrieval 실패 시 대화 전체 불필요 종료 없음

### Context / Gemini Live

- 현재 아이 발화가 Scenario/Memory보다 우선
- Relationship Context가 기존 Persona/System Instruction과 정상 결합
- 동일 session에서 effective_stage/Scenario/version 고정
- `relationship_session_context`에 실제 사용한 context 추적 가능

### Events

- deterministic Event 정상 기록
- 동일 logical Event retry duplicate 0
- semantic Event 불확실 시 기록하지 않음
- 별도 매-turn LLM judge 없음
- Event 자체로 Relationship Score 판정 없음

### Regression

Relationship Engine 구현으로 직접 영향받은 범위만 확인한다.

- Gemini Live
- Mission
- Free Chat
- Memory Retrieval V3
- Collection/Correction/Memory Batch
- Daily Report

전체 unrelated E2E는 수행하지 않는다.

---

## 7. 완료 조건

다음이 모두 충족되면 Relationship Engine V1 완료다.

### Core Architecture

- Relationship Stage와 Grade Strategy 분리
- 24 Scenario Card 운영 가능
- Scenario는 Strategy Card이며 Script가 아님
- `calendar_stage` / `effective_stage` 분리
- `effective_stage <= calendar_stage`
- 자동 downgrade 없음
- Stage threshold DB/config 관리
- Threshold 코드 상수 하드코딩 없음

### Version / Session

- Scenario version 관리 가능
- 동일 grade+stage active version 1개
- Stage Rule version/history 추적 가능
- session별 Scenario/Grade Strategy version 추적
- session 도중 전략 version 고정

### Memory

- 기존 Memory V3만 사용
- 신규 Memory DB/embedding store 없음
- Session Start Memory preload
- 일반 매-turn retrieval 없음
- 필요한 경우 on-demand retrieval
- Memory Fact ID를 session context에 기록

### Events

- Relationship Event 저장
- logical event idempotency 보장
- Event는 사실 데이터만 기록
- score/scoring 없음
- direct_open을 voluntary return으로 직접 판정하지 않음
- 불확실 semantic event 추정 생성 없음

### Runtime

- Gemini Live가 현재 아이 발화를 Relationship Scenario보다 우선
- Relationship Layer 장애 시 기존 대화 가능한 범위에서 fail-open
- 기존 Mission/Free Chat/Memory Pipeline 비즈니스 로직 유지
- 성능상 매 발화 DB/Stage/Vector Retrieval 없음
- 기존 RLS/auth/security 원칙 유지

위 조건과 필수 Gate가 충족되면 작업을 종료한다.

V1 범위를 넘어선 자동화·점수화·별도 플랫폼은 구현하지 않는다.

---

## 8. 완료 보고

아래만 간단히 보고한다.

1. 최종 Relationship Engine 구조
2. 주요 변경 파일
3. DB migration / constraints / indexes / RLS / seed
4. `calendar_stage` Source 및 `effective_stage` 판정 방식
5. Stage threshold/version 관리 방식
6. 24 Scenario Card 및 active uniqueness 방식
7. Grade Strategy/version 구조
8. Memory V3 integration / preload / on-demand 결과
9. Gemini Live Context 삽입 위치 및 fail-open 방식
10. Relationship Event 목록 및 idempotency
11. session context/version freeze 결과
12. QA Level 및 필수 Gate 결과
13. 기존 Mission/Free Chat/Memory Pipeline 회귀 결과
14. Production 적용 여부
15. Commit SHA
16. 남은 위험이 있는 경우만 해당 내용

최종 판정:

`PASS` 또는 `BLOCKED`