# Request 074 — Relationship Engine V1: Stage × Grade Strategy × Scenario Card + Memory V3 + Relationship Events

## 0. 목적

내친구 케이의 초기 4주 관계 형성 전략을 코드/DB/런타임에서 안정적으로 실행할 수 있는 **Relationship Engine V1**을 구현한다.

V1의 핵심 목표는 두 가지다.

1. 사전에 설계된 관계 전략이 아이별 학년·관계 단계에 맞게 Gemini Live 대화에 안정적으로 적용될 것
2. 실제 아이 행동을 Relationship Event로 신뢰성 있게 축적할 것

이번 Request에서는 관계 점수화, 자동 최적화, 새로운 메모리 시스템 구축까지 확장하지 않는다.

---

# 1. 확정 아키텍처

관계 구조는 아래 조합으로 구현한다.

```text
Relationship Stage
        ×
Grade Strategy
        ↓
Scenario Card
```

초기 Relationship Stage:

```text
W1 = MEET
W2 = REMEMBER
W3 = SHARED_HISTORY
W4 = VOLUNTARY_RETURN
```

Grade Strategy:

```text
G1
G2
G3
G4
G5
G6
```

운영되는 Scenario Card 수:

```text
4 stages × 6 grades = 24 cards
```

중요:

- 24개의 독립 대화 엔진을 만들지 않는다.
- 24개의 완성 대본을 만들지 않는다.
- Relationship Stage와 Grade Strategy는 분리 관리한다.
- Scenario Card는 두 요소를 조합한 실제 운영 전략 단위다.
- 실제 자연어 발화는 Gemini Live가 생성한다.

---

# 2. 최종 역할 정의

## Relationship Engine

질문:

```text
지금 케이가 이 아이에게 어떤 친구가 되어야 하는가?
```

책임:

- calendar_stage 계산
- effective_stage 결정
- 현재 적용할 Relationship Stage 반환

## Grade Strategy

질문:

```text
이 학년의 아이에게 어떤 방식으로 표현해야 하는가?
```

책임 예:

- 어휘 난이도
- 문장 길이
- 질문 길이
- 질문 빈도
- 케이가 대화를 이끄는 비율
- 놀이/장난 정도
- 감정 반응 방식
- 기억을 언급하는 직접성

## Scenario Card

질문:

```text
이번 관계 단계에서 케이는 어떤 행동 원칙을 따라야 하는가?
```

책임 예:

- primary_goal
- secondary_goal
- strategy
- recommended_memory_types
- forbidden_patterns
- response_style
- expected_events
- version

## Memory V3

질문:

```text
이 아이에 대해 실제로 무엇을 기억하고 있는가?
```

책임:

- 기존 Memory V3를 유일한 memory source of truth로 사용
- Scenario가 요구한 memory type에 맞는 Fact/Evidence 검색
- Session preload용 Memory Pack 반환
- 필요 시 on-demand retrieval 제공

## Gemini Live

질문:

```text
지금 이 순간 아이에게 뭐라고 자연스럽게 말할 것인가?
```

책임:

- 현재 발화 이해
- 자연어 생성
- Scenario 전략을 자연스럽게 적용
- Memory를 필요할 때만 연결
- 예상 밖 발화 대응
- 현재 아이 이야기를 관계 전략보다 우선

## Relationship Events

질문:

```text
실제로 아이와 시스템에서 무슨 일이 일어났는가?
```

책임:

- 관계 관련 사실 이벤트 저장
- 관계 성공/실패 점수 판정은 하지 않음
- 베타 이후 retention 분석을 위한 사실 데이터 축적

---

# 3. 절대 경계

아래 경계를 유지한다.

```text
Relationship Engine
≠ Memory Engine

Scenario Card
≠ Script

Relationship Event
≠ Relationship Score

calendar_stage
≠ effective_stage

Memory preload
≠ 매 발화 retrieval
```

다음 구조를 만들지 않는다.

```text
LLM이 매 세션 관계 단계 자체를 추론
LLM이 매 턴 관계 성공도를 평가
모든 Memory를 Gemini에 dump
24개의 고정 대본
별도 child_memories 신규 구축
매 발화 vector retrieval
```

---

# 4. 전체 런타임 흐름

```text
Session Start
   ↓
Child Profile
   ↓
Relationship State Engine
   ├─ calendar_stage
   └─ effective_stage
   ↓
Grade Strategy
   +
Active Scenario Card
   ↓
Memory V3 Retrieval
   └─ Session Memory Pack
   ↓
Play / Reward / Entry Context
   ↓
Relationship Context Builder
   ↓
Gemini Live Session
   ↓
Conversation
   ├─ 기본 Memory Pack 사용
   ├─ 필요한 경우만 on-demand Memory V3 retrieval
   └─ Relationship Event 기록
   ↓
Session End
   ↓
Relationship State 재평가용 사실 데이터 축적
```

중요:

**한 세션이 시작되면 effective_stage와 scenario version은 해당 세션 동안 고정한다.**

세션 도중 stage나 scenario version이 바뀌지 않도록 한다.

---

# 5. calendar_stage

가입 경과일을 기반으로 candidate stage를 계산한다.

V1 기준:

```text
D1  ~ D7  → W1 MEET
D8  ~ D14 → W2 REMEMBER
D15 ~ D21 → W3 SHARED_HISTORY
D22 이후   → W4 VOLUNTARY_RETURN
```

V1에서는 30/60/90일 Stage 확장을 구현하지 않는다.

D22 이후는 V1 범위에서 W4를 유지한다.

가입 경과일 계산의 source of truth는 실제 child 가입/활성 시작 필드를 Repository에서 확인하여 사용한다.

필드명을 추측해서 새 source of truth를 만들지 않는다.

---

# 6. effective_stage

calendar_stage는 후보 상한선일 뿐이다.

실제 Gemini Live에 적용할 관계 단계는 `effective_stage`다.

원칙:

```text
effective_stage <= calendar_stage
```

effective_stage는 각 Stage 진입에 필요한 최소 행동 조건을 충족한 범위까지만 올라간다.

V1에서 사용하는 조건 후보:

- 실제 대화 여부
- 실제 대화 일수
- usable memory 존재 여부
- shared memory 존재 여부
- 관계 관련 event 축적 여부

복잡한 scoring model은 만들지 않는다.

---

# 7. Stage Threshold는 코드에 박지 않는다

Stage 진입 조건의 threshold는 반드시 DB/config에서 변경 가능해야 한다.

예시 개념:

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

실제 필드는 Repository/기존 schema convention을 확인해 최소 구조로 설계한다.

중요:

- 숫자를 application constant로 하드코딩하지 않는다.
- 운영 중 migration 없이 threshold 값을 조정할 수 있어야 한다.
- V1에서는 rule expression engine / DSL을 만들지 않는다.
- 단순 숫자 threshold + boolean 조건 수준으로 유지한다.

---

# 8. effective_stage 진행 방향

V1에서는 effective_stage를 관계 진입 조건으로만 사용한다.

기본 progression:

```text
W1 → W2 → W3 → W4
```

V1에서는 자동 stage downgrade를 구현하지 않는다.

예:

```text
W3까지 올라간 아이가 며칠 미접속
→ 자동으로 W1로 내리지 않음
```

장기 미사용 후 복귀 전략은 30/60/90일 Relationship 확장 범위에서 별도 설계한다.

---

# 9. 권장 DB 구조

실제 migration 작성 전 기존 schema, naming convention, RLS, indexes를 확인한다.

기존 테이블/컬럼과 역할이 중복되면 새 테이블을 만들지 말고 현재 구조를 확장한다.

## 9.1 relationship_stages

목적: Stage 공통 정의.

최소 개념 필드:

```text
id
stage_key
stage_order
name
description
primary_goal
active
created_at
updated_at
```

초기 데이터:

```text
MEET
REMEMBER
SHARED_HISTORY
VOLUNTARY_RETURN
```

## 9.2 grade_strategies

목적: 학년별 표현 전략.

최소 개념 필드:

```text
id
grade
version
strategy
response_style
active
created_at
updated_at
```

`strategy`, `response_style`은 프로젝트 convention에 따라 JSONB 또는 구조화 컬럼으로 결정한다.

과도한 schema 분해는 하지 않는다.

## 9.3 relationship_stage_rules

목적: effective_stage 진입 threshold 관리.

최소 개념 필드:

```text
id
stage_key
version
min_conversation_count
min_conversation_days
min_usable_memory_count
min_shared_memory_count
min_relationship_event_count
active
created_at
updated_at
```

각 숫자의 초기값은 임의로 발명하지 않는다.

현재 승인된 값이 Repository/기획 데이터에 없으면 안전한 baseline을 seed/config로 분리하고, 완료 보고에 실제 초기값을 명시한다.

## 9.4 relationship_scenarios

목적: 실제 24개 운영 Scenario Card.

최소 개념 필드:

```text
id
scenario_key
grade
stage_key
version
active
primary_goal
secondary_goal
strategy
recommended_memory_types
forbidden_patterns
response_style
expected_events
created_at
updated_at
```

예:

```text
G3_REMEMBER_V1
G3_REMEMBER_V2
```

중요 제약:

동일한 `grade + stage_key` 조합에는 Production에서 active version이 하나만 존재해야 한다.

DB constraint/index 또는 안전한 activation 로직으로 보장한다.

## 9.5 child_relationship_state

목적: 아이별 현재 relationship state snapshot.

최소 개념 필드:

```text
child_id
calendar_stage
effective_stage
effective_stage_started_at
last_evaluated_at
created_at
updated_at
```

중요:

다음 source data를 이 테이블에 복제해서 별도 진실 공급원으로 만들지 않는다.

- 실제 conversation count
- 실제 conversation days
- memory fact count
- event count

이 값들은 기존 source of truth에서 계산하고, 필요 시 evaluation snapshot metadata로만 저장한다.

## 9.6 relationship_session_context

목적: 과거 세션에서 실제 어떤 관계 전략과 Memory를 사용했는지 재현 가능하게 기록.

최소 개념 필드:

```text
id
session_id
child_id
calendar_stage
effective_stage
scenario_id
scenario_version
grade_strategy_id
grade_strategy_version
memory_fact_ids
entry_source
created_at
```

중요:

- Memory 본문을 복제하지 않는다.
- 기존 Memory V3의 fact ID를 참조한다.
- Scenario가 V2/V3로 변경되어도 과거 세션에서 어떤 version을 사용했는지 남아야 한다.
- session_id 기준 중복 생성 방지.

## 9.7 relationship_events

목적: 관계 관련 사실 이벤트 저장.

최소 개념 필드:

```text
id
event_key
child_id
session_id
scenario_id
scenario_version
event_type
metadata
created_at
```

`event_key`는 idempotency용으로 사용한다.

동일 논리 이벤트가 retry로 여러 번 저장되지 않도록 unique constraint 또는 동등한 idempotency 보장을 둔다.

---

# 10. Scenario Card 24개 Seed

초기 데이터는:

```text
G1 × W1~W4
G2 × W1~W4
G3 × W1~W4
G4 × W1~W4
G5 × W1~W4
G6 × W1~W4
```

총 24개 Scenario Card를 생성한다.

Stage 공통 목표:

```text
MEET
→ "얘랑 이야기해도 괜찮네."

REMEMBER
→ "케이가 나를 기억하고 있구나."

SHARED_HISTORY
→ "우리 둘이 아는 이야기가 생겼다."

VOLUNTARY_RETURN
→ "오늘 케이한테 이야기하고 싶다."
```

중요:

- 24개의 완성 발화 대본은 작성하지 않는다.
- 각 card는 목표/전략/제약/Memory type/표현 방식만 정의한다.
- 승인되지 않은 세부 아동 심리 규칙을 임의로 과도하게 발명하지 않는다.
- 현재 제공된 기획 원칙을 baseline으로 seed한다.
- 추후 DB data update만으로 version을 추가할 수 있어야 한다.

---

# 11. Grade Strategy

Grade Strategy는 Relationship Stage와 별도 데이터다.

학년별 차이를 표현하는 요소:

- vocabulary level
- sentence length
- question length
- question frequency
- humor/playfulness
- emotional reaction style
- directness of recalling memory
- conversation lead ratio
- play ratio
- autonomy level

중요:

`G1_REMEMBER`, `G2_REMEMBER`마다 같은 grade rule을 중복 복사하지 않도록 설계한다.

Scenario Card는 Grade Strategy를 참조하거나 조합하여 최종 Context를 만든다.

---

# 12. Memory V3 연동 원칙

새로운 Memory DB를 만들지 않는다.

금지:

```text
new child_memories table
별도 embedding store
별도 memory fact source
Relationship 전용 memory truth
```

Relationship Engine은 기존 Memory V3 Retrieval의 소비자다.

구조:

```text
Scenario Card
  ↓
recommended_memory_types
  ↓
Memory V3 Retrieval
  ↓
Fact + Evidence
  ↓
Memory Pack
```

기존 V3 정책 유지:

- Memory Retrieval V3 우선
- 기존 legacy fallback이 현재 시스템에 존재한다면 기존 정책 그대로 사용
- 같은 memory를 V3 + legacy 양쪽에서 중복 주입하지 않음
- embedding model/source of truth를 Relationship Engine에서 새로 정의하지 않음

---

# 13. Session Memory Pack

Memory Retrieval은 기본적으로 세션 시작 시 1회 수행한다.

Session Context Builder가 다음을 조립한다.

```text
Child Profile
+
effective_stage
+
Grade Strategy
+
Scenario Card
+
Memory Pack
+
Play / Reward / Entry Context
```

Memory Pack 개수는 config에서 조정 가능하게 한다.

예:

```text
relationship_memory_pack_limit
```

숫자를 코드 곳곳에 하드코딩하지 않는다.

Memory Pack은:

- Scenario의 recommended_memory_types
- 현재 relevance
- 기존 Memory V3 retrieval ranking

을 이용한다.

Relationship Layer에서 새로운 ranking 알고리즘을 중복 구현하지 않는다.

---

# 14. on-demand Memory Retrieval

매 발화마다 retrieval하지 않는다.

추가 retrieval은 아래와 같은 상황에서만 허용한다.

- 아이가 과거 기억을 직접 요청
- "전에 말한 거 기억나?"와 같은 명시적 요청
- 현재 Memory Pack만으로 과거 맥락에 대응하기 어려움

구현은 현재 Gemini Live tool/function calling 구조를 확인하여 기존 convention에 맞춘다.

개념 인터페이스:

```text
retrieve_child_memory(query, memory_types)
```

주의:

- speculative API 사용 금지
- 현재 프로젝트에서 실제 사용 중인 Gemini Live SDK/tool calling 방식을 확인 후 구현
- retrieval 호출 실패가 전체 Live Session을 종료시키지 않도록 처리

---

# 15. Relationship Context Builder

신규 핵심 모듈.

책임:

```text
Child Profile
+ Relationship State
+ Grade Strategy
+ Scenario Card
+ Memory Pack
+ Play / Reward / Entry Context
→ Gemini Live용 Relationship Context
```

최종 context는 기존 Persona/System instruction 구조에 통합한다.

기존 Conversation Engine 전체를 새로 만들지 않는다.

기존 Gemini Live 세션 생성 경로에 Relationship Context를 추가하는 방식으로 최소 변경한다.

---

# 16. Gemini Live Context 우선순위

Gemini에게 다음 우선순위를 명확히 전달한다.

```text
1. 현재 아이의 발화와 즉시 감정/상황
2. 안전 정책 및 기본 K Persona
3. Relationship Scenario
4. Memory 활용
5. Play / Reward Context
```

중요:

Scenario는 목표이지 강제 대본이 아니다.

예:

```text
Stage = REMEMBER
Memory Pack에 포켓몬 기억 존재
아이: "오늘 진짜 속상해."
```

잘못된 동작:

```text
"그런데 지난번 포켓몬 말이야!"
```

올바른 동작:

```text
현재 속상한 이야기에 먼저 반응
→ 적절한 경우에만 나중에 Memory 활용
```

---

# 17. Relationship Events

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

---

# 18. Event 기록 원칙

Event는 "사실"을 기록한다.

Event 자체로 관계 성공/실패를 판정하지 않는다.

예:

```text
direct_open
```

발생했다고 해서:

```text
VOLUNTARY_RETURN 성공
```

으로 처리하지 않는다.

V1에서는 scoring 없음.

---

# 19. Deterministic Event 우선

애플리케이션에서 확실히 알 수 있는 이벤트는 deterministic하게 기록한다.

예:

```text
child_started_free_chat
direct_open
notification_entry
reward_entry
play_to_chat
returned_after_gap
```

`returned_after_gap`의 gap threshold도 하드코딩하지 말고 config로 관리한다.

---

# 20. 의미 판단 Event

다음 이벤트는 의미 판단이 필요할 수 있다.

```text
memory_used
memory_acknowledged
child_referenced_past
```

V1에서 이 세 이벤트를 얻기 위해 별도의 LLM judge를 매 턴 호출하지 않는다.

원칙:

- 기존 runtime/tool metadata로 명확하게 판단할 수 있으면 기록
- 불명확하면 기록하지 않음
- 추정으로 positive event 생성 금지

false positive를 만드는 것보다 event가 없는 것이 낫다.

---

# 21. expected_events

Scenario Card의 `expected_events`는 관찰 목표 metadata다.

예:

```text
G3_REMEMBER_V1
expected_events:
- memory_used
- memory_acknowledged
- child_referenced_past
```

금지:

```text
3개 중 2개 발생 = 관계 성공
```

V1에서는 expected_events를 점수화하지 않는다.

---

# 22. Voluntary Return

V1에서 `direct_open = voluntary_return`으로 정의하지 않는다.

향후 proxy metric 후보:

```text
direct_open
+ notification_entry 아님
+ reward_entry 아님
+ child_started_free_chat
+ 실제 대화 지속
```

하지만 이번 Request에서 자동 Voluntary Return scoring/판정 시스템을 만들지 않는다.

사실 이벤트만 저장한다.

---

# 23. Scenario Versioning

Scenario Card는 반드시 version 관리 가능해야 한다.

예:

```text
G3_REMEMBER_V1
G3_REMEMBER_V2
```

요구사항:

- 기존 version row 수정으로 과거 실험 이력을 파괴하지 않는다.
- 새로운 전략은 새 version 생성.
- active version 전환 가능.
- 어떤 session이 어떤 version을 사용했는지 `relationship_session_context`에 저장.
- 과거 session 재현 가능.
- 동일 grade + stage에 active version이 여러 개 생기지 않도록 보장.

---

# 24. Stage Rule Versioning

Stage threshold도 version 또는 변경 이력을 추적할 수 있어야 한다.

이유:

베타에서 threshold가 변경됐을 때:

```text
왜 이 아이는 당시 W2였는가?
```

를 재현할 수 있어야 한다.

V1에서 복잡한 experiment framework는 만들지 않는다.

최소 version/history만 확보한다.

---

# 25. Entry Context

가능한 경우 Session Start 시 진입 source를 context에 포함한다.

후보:

```text
direct_open
notification
reward
play
parent_trigger
unknown
```

실제 현재 앱에서 source를 신뢰성 있게 알 수 있는 경우만 저장한다.

존재하지 않는 source를 추정해서 만들지 않는다.

---

# 26. Play / 황금열쇠 Context

Play/Reward 시스템을 Relationship Engine 내부로 합치지 않는다.

다만 Session Context Builder에서 현재 상태를 읽어 Gemini에 필요한 최소 context를 제공할 수 있다.

예:

```text
최근 놀이 경험
현재 놀이 진입 여부
reward entry 여부
황금열쇠 관련 현재 상태
```

이번 Request에서 Play/Reward 비즈니스 로직 자체는 변경하지 않는다.

---

# 27. 실패 처리

Relationship Layer 장애가 기존 대화를 막으면 안 된다.

예:

- Scenario 조회 실패
- Stage rule 조회 실패
- Memory preload 실패
- Relationship Event insert 실패

원칙:

```text
기존 Gemini Live conversation은 가능한 경우 계속 동작
Relationship enhancement만 fallback
```

Fallback:

- 기본 K Persona
- 기존 Session Context
- 기존 대화 기능

다만 오류를 조용히 삼키지 않는다.

기존 telemetry/logging convention을 사용하여 원인 추적 가능하게 기록한다.

Secret/민감 정보 출력 금지.

---

# 28. 보안 / 데이터 원칙

- 기존 child authorization/RLS 원칙 유지
- child_id를 client 입력만 믿고 데이터 조회하지 않음
- 서버에서 현재 인증/세션 소유권 검증
- Memory V3 조회 권한 기존 정책 유지
- Service Role 사용 범위를 확장하지 않음
- secret 값을 log/response에 출력하지 않음
- Production data delete/recreate 금지

---

# 29. 성능 / Latency

Gemini Live Session Start latency를 불필요하게 증가시키지 않는다.

권장:

- Relationship State / Scenario / Grade Strategy는 가능한 한 병렬 조회
- Memory Pack retrieval은 세션 시작 시 1회
- N+1 query 금지
- 매 발화 DB 조회 금지
- 매 발화 vector retrieval 금지
- 매 발화 stage 계산 금지

한 세션에서는 이미 확정한 context를 재사용한다.

---

# 30. Idempotency

다음은 idempotent해야 한다.

- relationship_session_context 생성
- relationship_event insert
- retry된 session start
- retry된 event delivery

중복 방지 기준은 실제 logical identity를 사용한다.

예:

```text
session_id
event_key
scenario version
```

랜덤 timestamp만으로 중복 여부를 판단하지 않는다.

---

# 31. 구현 모듈 경계

Repository를 확인해 실제 폴더 convention에 맞춰 구현한다.

개념 모듈:

```text
RelationshipStateEngine
ScenarioRepository
GradeStrategyRepository
MemoryV3Adapter
RelationshipContextBuilder
RelationshipEventLogger
```

각 책임을 섞지 않는다.

예:

- `RelationshipStateEngine`에서 직접 Gemini prompt string 생성 금지
- `MemoryV3Adapter`에서 stage 판단 금지
- `RelationshipEventLogger`에서 관계 성공 점수 계산 금지

---

# 32. 기존 Memory Pipeline 변경 금지

이번 Request에서 다음 기존 pipeline을 재설계하지 않는다.

```text
Raw
→ Context Correction
→ Memory Batch
→ Memory Facts
→ Evidence
→ Embedding
→ Retrieval V3
```

허용:

- 기존 Retrieval V3를 호출하는 adapter 추가
- Scenario recommended_memory_types를 retrieval query에 전달
- Session Context에 Memory Fact ID 기록

금지:

- Memory Batch 구조 변경
- Memory fact schema 재설계
- embedding model 변경
- duplicate memory store 생성
- 기존 evidence 관계 변경

---

# 33. 기존 Mission / Free Chat 기능 변경 금지

이번 Request는 Relationship Engine V1 추가다.

다음 비즈니스 로직을 변경하지 않는다.

- Mission progression
- Mission reward
- Mission completion
- Free Chat persistence
- Collection V3
- Context Correction
- Memory Batch
- Daily Report

Relationship context를 기존 Conversation Engine에 안전하게 추가하는 범위만 허용한다.

---

# 34. V1 비범위

이번 Request에서 구현하지 않는다.

```text
Relationship Score 0~100
LLM 기반 Stage 판정
LLM 기반 매 턴 성공도 평가
자동 Scenario 생성
자동 Scenario optimization
완전한 A/B Experiment Platform
30/60/90일 Relationship Stage
Stage 자동 downgrade
별도 Memory System
매 턴 vector retrieval
Voluntary Return 자동 점수화
부모 행동 추론
```

---

# 35. Migration 원칙

- forward-only migration
- Production 데이터 보존
- drop/recreate 금지
- 기존 table이 동일 역할을 이미 수행하면 중복 생성 금지
- unique/index/RLS 포함
- rollback을 위해 데이터 삭제를 전제로 하지 않음
- migration 적용 전 실제 Production schema와 충돌 여부 확인

---

# 36. 구현 전 필수 Repository Audit

코드 변경 전에 실제 source of truth를 확인한다.

최소 확인:

1. child 가입일 source
2. child grade source
3. Gemini Live session 생성 위치
4. 현재 Persona/System instruction builder
5. Memory Retrieval V3 entry point
6. Memory fact/evidence ID 구조
7. session entry source를 현재 알 수 있는지
8. play/reward/golden key current context source
9. chat session source of truth
10. 기존 telemetry/logger
11. 기존 RLS/auth convention
12. 기존 config table 또는 feature setting 패턴

확인 결과 기존 구조를 재사용할 수 있으면 재사용한다.

추측 API/추측 테이블 생성 금지.

---

# 37. Target QA

전체 unrelated E2E를 돌리지 않는다.

Relationship Engine 관련 Target QA만 수행한다.

## QA 1 — calendar_stage

```text
D1  → W1
D7  → W1
D8  → W2
D14 → W2
D15 → W3
D21 → W3
D22 → W4
D60 → W4 (V1)
```

## QA 2 — effective_stage cap

```text
calendar_stage = W3
W3 condition 미충족
W2 condition 충족
→ effective_stage = W2
```

## QA 3 — no downgrade

```text
current effective_stage = W3
오늘 activity 감소
→ W1/W2로 자동 downgrade 금지
```

## QA 4 — threshold config

DB/config threshold 값을 변경하고 application code 변경 없이 Stage 판정이 달라지는지 확인.

## QA 5 — Scenario selection

```text
grade = 3
effective_stage = REMEMBER
→ active G3_REMEMBER_Vn 정확히 1개 선택
```

## QA 6 — Scenario active uniqueness

동일 `grade=3 + stage=REMEMBER`에 active scenario가 2개 동시에 생기지 않음.

## QA 7 — session version freeze

세션 시작 시 `G3_REMEMBER_V1`을 사용했다면 세션 도중 active가 V2로 변경되어도 기존 session은 V1 유지. 다음 신규 session부터 V2 사용.

## QA 8 — Memory preload

Session Start에서 Memory V3 Retrieval이 1회 수행되고 configured pack limit 내 memory만 전달.

## QA 9 — no memory

REMEMBER stage지만 usable memory가 없거나 retrieval 결과가 0일 때:

- fake memory 생성 금지
- 대화 실패 금지
- 현재 상황 기반 자연 대화 유지

Stage rule이 usable memory를 요구하면 해당 rule에 따라 낮은 stage 사용.

## QA 10 — on-demand retrieval

명시적 과거 기억 요청 시 on-demand retrieval 가능. 일반 매 발화에서는 retrieval 발생하지 않음.

## QA 11 — current utterance priority

Scenario Memory보다 현재 아이 발화를 우선. 감정/긴급 맥락이 있을 때 과거 기억을 억지로 끼워 넣지 않음.

## QA 12 — session context persistence

`relationship_session_context`에 아래가 정확히 저장됨.

```text
effective_stage
scenario_id/version
grade strategy version
memory_fact_ids
entry source
```

## QA 13 — event idempotency

동일 event retry 시 duplicate 0.

## QA 14 — deterministic events

앱에서 확정 가능한 entry/free-chat/play events가 정확히 저장.

## QA 15 — semantic events

불확실한 `memory_acknowledged`, `child_referenced_past`를 별도 LLM judge로 추정 생성하지 않음.

## QA 16 — fail-open

Scenario/Memory/Event 일부 장애 시 기존 Gemini Live 대화가 가능한 범위에서 계속 유지됨.

## QA 17 — Memory V3 only

Relationship Engine이 신규 memory table/embedding store를 사용하지 않고 기존 Retrieval V3를 통해서만 memory를 공급받음.

## QA 18 — existing pipeline regression

Relationship Engine 추가 후 기존 Mission / Free Chat / Collection / Correction / Memory Batch / Daily Report 핵심 동작을 변경하지 않았음을 targeted regression으로 확인.

---

# 38. Acceptance Criteria

- [ ] Relationship Stage와 Grade Strategy가 분리 관리됨
- [ ] 4 Stage × 6 Grade = 24 Scenario Card 운영 가능
- [ ] Scenario는 script가 아니라 strategy card임
- [ ] calendar_stage / effective_stage 분리
- [ ] effective_stage는 calendar_stage를 초과하지 않음
- [ ] V1에서 stage 자동 downgrade 없음
- [ ] Stage threshold는 DB/config 변경 가능
- [ ] Threshold가 코드 상수로 박혀 있지 않음
- [ ] Scenario versioning 가능
- [ ] 동일 grade+stage active scenario 1개 보장
- [ ] session마다 실제 사용 scenario version 추적 가능
- [ ] Grade Strategy version 추적 가능
- [ ] 신규 Memory DB 없음
- [ ] 기존 Memory V3 Retrieval만 사용
- [ ] Session Start 기본 Memory preload
- [ ] 매 발화 retrieval 없음
- [ ] 필요한 경우만 on-demand retrieval
- [ ] Memory fact IDs가 session context에 기록
- [ ] Relationship Events 저장
- [ ] Event retry duplicate 없음
- [ ] Event 자체를 관계 score로 사용하지 않음
- [ ] direct_open을 voluntary return과 동일시하지 않음
- [ ] 별도 LLM judge/relationship scorer 없음
- [ ] Gemini Live가 현재 아이 발화를 Scenario보다 우선
- [ ] Relationship Layer 장애가 기존 대화 전체를 불필요하게 중단시키지 않음
- [ ] 기존 Memory Pipeline 변경 없음
- [ ] 기존 Mission/Free Chat/Collection/Report 로직 변경 없음
- [ ] Target QA 통과

---

# 39. 완료 보고 형식

구현 완료 시 아래만 보고한다.

## 1. ROOT DESIGN

실제 최종 구조를 한 문단으로 설명.

## 2. 변경 파일

실제 변경/추가 파일 목록.

## 3. DB Migration

- 생성/변경 테이블
- constraints
- indexes
- RLS
- seed
- Production 적용 여부

## 4. Relationship Stage Engine

- calendar_stage source
- effective_stage rule
- threshold source
- no-downgrade 보장 방식

## 5. Scenario / Grade Strategy

- 24 cards 생성 여부
- versioning 방식
- active uniqueness 보장 방식

## 6. Memory V3 Integration

- 실제 호출 entry point
- preload 방식
- pack limit source
- on-demand retrieval 방식
- 신규 memory store가 없음을 확인

## 7. Gemini Live Integration

- 실제 session context 삽입 위치
- 기존 Persona와 결합 방식
- fail-open 동작

## 8. Relationship Events

- 구현 event 목록
- deterministic/semantic 구분
- idempotency 방식

## 9. QA

각 Target QA를 `PASS / FAIL`과 실제 증거로 보고.

## 10. Production Verification

Production 반영 시 최소 아래를 실제 데이터로 확인.

- 신규 session 1건 이상
- relationship_session_context 생성
- 올바른 effective_stage
- 올바른 scenario version
- Memory Pack fact IDs
- Gemini Live 대화 정상
- Relationship Event 저장
- 기존 Mission/Free Chat 정상

---

# 40. 구현 원칙

이번 Request의 목표는 "관계 AI 플랫폼을 한 번에 완성"하는 것이 아니다.

V1 목표는 정확히:

```text
관계 전략 실행
+
행동 데이터 축적
```

이다.

필요 이상으로 자동화, 점수화, 실험 플랫폼, 별도 메모리 계층을 추가하지 않는다.

기존 시스템을 최대한 재사용하고 최소 변경으로 구현한다.

추측 구현 금지.

Repository와 Production schema를 먼저 확인한 뒤 실제 source of truth를 기준으로 구현한다.
