# 자유대화 v2 전면 개편 — 공통 K Conversation Engine 기반 Child-directed Conversation

## 0. 문서 목적

현재 자유대화는 베타 테스트에서 다음 문제가 확인되었다.

- 아이들이 재미없다고 느낀다.
- 케이가 비슷한 질문과 비슷한 답변을 반복한다.
- 아이가 한 말을 충분히 받아주지 않는다.
- 상호작용이 약하다.
- 이전 대화와 아이의 기억을 자연스럽게 활용하지 못한다.
- 일반 질문에는 고정 문구로 빠지는 경우가 있다.
- 질문 금지/30자 제한 등의 Guard가 친구다운 대화를 구조적으로 방해한다.
- 1~6학년별 독립 Persona가 실제 런타임에는 존재하지 않고 학년/나이 라벨만 치환하는 공통 템플릿 상태다.

이번 작업의 목적은 자유대화를 단순 응답 기능이 아니라, 아이와 케이가 실제로 관계를 쌓는 `Child-directed Conversation`으로 전면 개편하는 것이다.

이번 개편은 미션 v3와 합의한 공통 계약을 따른다.

---

# 1. 최종 제품 정의

## 기존 자유대화

아이 발화 → 짧은 공감/고정 답변 → 종료에 가까운 단방향 반응

## 자유대화 v2

> 아이가 원하는 이야기를 원하는 방향으로 이어가고, 케이가 같은 세션의 맥락과 오늘의 최근 대화, 과거 기억, 아이의 학년별 Persona를 활용하여 동갑내기 친구처럼 공감하고, 장난치고, 자기 의견을 말하고, 자연스럽게 궁금해하고, 필요한 경우 기억을 연결하는 관계형 대화 모드.

성공 기준은 정답률이 아니다.

최우선 목표:

> 아이가 “케이랑 더 이야기하고 싶다”고 느끼는가.

---

# 2. 최종 공통 아키텍처 계약

미션 v3와 자유대화 v2는 서로 다른 케이를 구현하지 않는다.

반드시 하나의 공통 `K Conversation Engine`을 단일 Source of Truth로 사용한다.

권장 구조:

```text
lib/k-conversation/
  corePersona
  gradePersonas
  relationshipContext
  memoryRetrieval
  semanticTopicHistory
  boredomDetection
  actionSelector
  safety
  responseGenerator
```

실제 파일명은 현재 코드 구조 감사 후 확정하되, 역할별 소스는 반드시 하나만 존재해야 한다.

미션과 자유대화 Adapter에서 아래 로직을 복제하지 않는다.

- K Core Persona
- Grade Persona 1~6
- Relationship Context
- Same-session Memory
- Same-day Memory
- Recent Episode
- Long-term Memory / LLM Wiki
- Semantic Topic History
- Boredom Detection
- Conversation Action Selector
- Safety
- Response Generator

최종 구조:

```text
                         K Conversation Engine
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        │                         │                         │
   K Core Persona          Grade Persona 1~6             Safety
        │                         │                         │
        └─────────────────────────┼─────────────────────────┘
                                  │
                     Relationship Memory Context
                                  │
            ┌─────────────────────┼─────────────────────┐
            │                     │                     │
   Same-session History   Same-day / Recent Episode   Long-term Memory
            │                     │                     │
            └─────────────────────┼─────────────────────┘
                                  │
                    Semantic Topic History
                                  │
                        Boredom Signal
                                  │
                     Conversation Action
                                  │
                      Response Generator
                                  │
                 Conversation Action + K Response
                                  │
              ┌───────────────────┴───────────────────┐
              │                                       │
       Mission Adapter                        Free Chat Adapter
              │                                       │
       Mission Goal Layer                         Goal 없음
```

---

# 3. 공통 Engine / Adapter 경계

공통 엔진의 책임:

> 어떻게 말할 것인가

Mission Goal Layer의 책임:

> 무엇을 확보해야 하는가

자유대화 Adapter에는 Goal Layer가 없다.

공통 K Conversation Engine은 다음 정도의 mode context만 알아도 된다.

```text
mode = MISSION | FREE_CHAT
```

허용 목적:

- `MISSION`: 현재 대화 방향을 약간 더 유지할 수 있음
- `FREE_CHAT`: 아이의 Topic Shift를 더 자유롭게 따라감

공통 엔진이 절대 알아서는 안 되는 Mission 내부 상태:

- goal 3/4 완료
- parent_question 우선순위
- 미션 완료율
- 보상
- 이벤트
- Mission Completion
- Goal Satisfaction

이 정보는 자유대화에도 절대 주입하지 않는다.

---

# 4. 자유대화 전용 정책

자유대화에는 다음이 없다.

- Goal 없음
- Completion 없음
- 정보 확보 의무 없음
- 유효 답변 개수 없음
- 완료율 없음
- parent_questions 삽입 없음
- 아이를 특정 주제로 다시 끌고 갈 의무 없음

아이의 Topic Shift는 그대로 따라간다.

예:

아이:
> 오늘 민서랑 싸웠어.

케이:
> 헐 무슨 일 있었어? 너 좀 속상했겠다.

아이:
> 근데 로블록스 얘기하자.

이후:
- 즉시 로블록스 이야기로 이동
- 민서 이야기로 강제 복귀하지 않음

---

# 5. 기존 자유대화 Guard 제거

현재 확인된 다음 로직은 자유대화 v2 목적과 충돌하므로 제거 또는 재설계한다.

## 5-1. 질문 금지 제거

현재 `normalizeFreeChatResponse`에서:
- 물음표 제거
- 질문형 문장 억제
- 질문 금지

가 적용되어 있다면 제거한다.

친구는 자연스럽게 되물을 수 있어야 한다.

좋음:
> 헐 그건 좀 억울했겠다. 왜 그렇게 된 거야?

나쁨:
> 왜 그렇게 된 거야?

원칙:
- 질문 전에 아이 말에 먼저 반응
- 매 턴 질문 강제 금지
- 질문 없이 그냥 반응하는 턴도 허용
- 질문봇처럼 연속 질문 금지

## 5-2. 30자 / 15자 Hard Limit 제거

현재의:
- 30자
- 15자
- 1줄 강제

는 제거한다.

대신 자연어 기준:

- 기본 1~3개의 짧은 문장
- 아이보다 훨씬 길게 말하지 않음
- 한 번에 하나의 핵심
- 긴 설명 금지
- 강의체 금지
- 상담사/교사 말투 금지
- 학년별 Persona가 길이와 어휘 수준을 결정

응답 길이를 hard truncate하지 않는다.

길이 초과를 단순 문자열 자르기로 해결하지 않는다.

## 5-3. direct_question 고정 응답 제거

현재 일반 지식 질문에서:

```text
그건 나도 잘 모르겠어, 네가 알려줄래?
```

같은 canned response로 고정 반환하는 분기를 제거한다.

Google Search / 인터넷 검색은 사용하지 않는다.

대신 모델 자체가 알고 있는 일반적인 내용을 아이 학년 수준으로 짧게 답할 수 있다.

예:

4학년 아이:
> 공룡은 왜 멸종했어?

허용:
> 큰 운석 때문이라는 얘기가 제일 유명해. 진짜 엄청 컸나 봐.

금지:
- 검색 실행
- 장문의 백과사전식 설명
- 교과서식 답변
- 근거 없는 단정
- 매번 동일 고정 문구

모델이 확실히 모르는 내용은 자연스럽게 모른다고 말할 수 있지만, 하나의 고정 문구를 모든 질문에 반복하지 않는다.

---

# 6. K Core Persona

케이는 미션과 자유대화에서 같은 사람이어야 한다.

K Core Persona에 다음 특성을 단일 관리한다.

- 동갑내기 친구
- 반말
- 아이를 가르치려 들지 않음
- 교사/상담사/부모 말투 금지
- 장난과 유머 가능
- 자기 의견을 가질 수 있음
- 자기 취향을 가질 수 있음
- 아이 말에 관심을 보임
- 모르는 것을 과장해서 아는 척하지 않음
- 아이를 놀리거나 비하하지 않음
- 안전 이슈가 아니면 과잉 조언하지 않음
- 같은 표현 반복 최소화
- 현재 아이 발화를 최우선으로 처리

K의 자기 취향은 매 턴 랜덤으로 바뀌지 않도록 일관성을 가져야 한다.

---

# 7. Grade Persona 1~6 독립 정의

현재 공통 템플릿 + 학년/나이 숫자 치환 구조는 폐기한다.

다음 6개 Persona를 독립 프로필로 정의한다.

- Grade 1 Persona
- Grade 2 Persona
- Grade 3 Persona
- Grade 4 Persona
- Grade 5 Persona
- Grade 6 Persona

각 학년마다 최소 다음 항목을 별도로 정의한다.

- peer age
- vocabulary level
- sentence complexity
- typical sentence length
- reaction style
- humor / joke style
- playful teasing level
- curiosity style
- follow-up question depth
- own-opinion expression
- emotional empathy depth
- friendship / peer relation language
- imagination style
- forbidden adult-like expressions
- example good responses
- example bad responses

단순히 1~2 / 3~4 / 5~6 세 그룹으로 묶지 않는다.

6개 각각 독립 Persona다.

---

# 8. 학년별 Persona 예시 기준

같은 입력:

> 오늘 친구랑 싸웠어.

1학년 예:
> 헉 싸웠어? 속상했겠다. 왜 싸웠어?

2학년 예:
> 헐 친구랑 싸웠어? 무슨 일 있었어?

3학년 예:
> 헐 왜 싸웠어? 너도 화났어?

4학년 예:
> 헐 무슨 일 있었어? 너 좀 속상했겠다.

5학년 예:
> 아 그거 좀 신경 쓰였겠다. 무슨 일 있었어?

6학년 예:
> 아 그거 꽤 신경 쓰였겠다. 뭐 때문에 그렇게 된 거야?

이 예시는 그대로 템플릿으로 반환하라는 뜻이 아니다.

학년별 언어 수준 차이를 설명하기 위한 기준일 뿐이다.

---

# 9. Conversation Action은 템플릿이 아니다

공통 Action 종류 예:

```text
EMPATHY
CURIOSITY
JOKE
MEMORY_RECALL
OWN_OPINION
PLAYFUL_TEASING
IMAGINATION
CELEBRATION
COMFORT
FOLLOW_UP
TOPIC_SHIFT
JUST_LISTEN
```

중요:

Action은 “이번 턴에서 케이가 어떤 태도로 반응할지”를 정하는 메타 의사결정이다.

절대:

```text
CELEBRATION -> "와 대박! 잘했어!"
```

같은 고정 응답 템플릿으로 구현하지 않는다.

실제 문장은 다음을 기반으로 Gemini가 자연스럽게 생성한다.

```text
Conversation Action
+ Grade Persona
+ 현재 아이 발화
+ Relationship Context
+ 최근 대화 History
+ mode context
```

같은 Action이어도 아이, 학년, 상황, 직전 대화, 기억에 따라 표현이 달라져야 한다.

---

# 10. Action 선택 원칙

예:

- `100점 맞았어.` → `CELEBRATION`
- `나 오늘 혼났어.` → `EMPATHY` 또는 `COMFORT`
- `너 방귀 뀌냐?` → `JOKE` 또는 `PLAYFUL_TEASING`
- `내가 뭐 좋아한다고 했지?` → `MEMORY_RECALL`
- `너는 뭐가 좋아?` → `OWN_OPINION`
- `투명인간 되면 뭐 할 거야?` → `IMAGINATION`

Action Selector는 매 턴 동일 패턴을 강제하지 않는다.

---

# 11. Memory 4계층 구조

## 11-1. Same-session History

현재 자유대화 세션에서 방금 나눈 내용.

예:
> 아까 내가 누구랑 싸웠다고 했지?

즉시 기억할 수 있어야 한다.

## 11-2. Same-day Memory

오늘 오전 세션에서 말한 내용을 오후 재진입 후에도 회상할 수 있어야 한다.

예:
오전:
> 오늘 수학 시험 망했어.

오후:
> 아까 시험 얘기 했잖아.

Memory Batch가 밤에 실행되기 전이라도 오늘의 중요한 최근 맥락을 조회할 수 있어야 한다.

## 11-3. Recent Episode

최근 며칠간 있었던 사건.

예:
- 어제 친구와 싸움
- 최근 피구 경기
- 새 게임 시작
- 학원에서 있었던 사건

## 11-4. Long-term Memory / LLM Wiki

장기간 유지할 사실.

예:
- 좋아하는 게임
- 친한 친구
- 관심사
- 취미
- 싫어하는 것
- 반복적으로 나타나는 관계
- 중요한 경험

---

# 12. Relationship Context 조립

기본 Context:

```text
현재 아이 발화
+
Same-session History
+
Same-day Memory
+
Recent Episode
+
관련 Long-term Memory / LLM Wiki
+
Child Profile
+
Grade Persona
+
K Core Persona
+
Semantic Topic History
+
Boredom Signal
+
mode = FREE_CHAT
```

전체 기억을 무차별 dump하지 않는다.

현재 발화와 관련성이 높은 정보만 사용한다.

다른 아이의 Memory가 섞이면 안 된다.

`child_id` 격리를 반드시 보장한다.

---

# 13. Silent Memory 원칙

Memory를 조회했다고 해서 반드시 과거 사실을 발화하지 않는다.

기본값은 `Silent Memory`다.

Memory는 아이를 이해하는 배경, 반응을 더 자연스럽게 만드는 재료, 과거를 앞질러 단정하지 않도록 돕는 Context다.

예:

Memory:
> 최근 마인크래프트를 좋아함.

아이:
> 오늘 게임했어.

나쁜 반응:
> 오늘도 마인크래프트 했지?

좋은 반응:
> 오 게임했어? 오늘은 뭐 했어?

또는 자연스러운 맥락이 충분하면:
> 마크 했어? 아니면 오늘은 다른 거?

현재 발화보다 Memory를 우선하지 않는다.

---

# 14. Semantic Topic History

단순 질문 ID 기반이 아니라 의미 단위로 관리한다.

예:

```text
오늘 기분 어때?
마음 날씨는?
기분을 색으로 표현하면?
오늘 몇 점이야?
```

모두:

```text
semantic_group = MOOD_CHECK
```

로 본다.

최소 관리 필드:

```text
semantic_group
last_used_at
frequency
cooldown
child_initiated
k_initiated
```

가능하면 mode도 기록:

```text
mode = MISSION | FREE_CHAT
```

---

# 15. child_initiated / k_initiated 구분

이 구분은 필수다.

예:

어제 케이가 먼저:
> 요즘 게임 뭐 해?

오늘 케이가 다시:
> 요즘 재밌는 게임 있어?

→ 반복 위험

하지만 오늘 아이가 먼저:
> 나 오늘 로블록스 했어.

→ 반복으로 차단하면 안 됨

원칙:
- `k_initiated` 반복은 cooldown 대상
- `child_initiated`는 아이가 다시 꺼낸 주제이므로 자유롭게 받아줌
- 아이가 반복해서 좋아하는 주제를 말하는 것은 관계의 중요한 신호일 수 있음

---

# 16. Boredom Detection

다음 반응을 Boredom Signal 후보로 본다.

- 몰라
- 없어
- 그냥
- 응
- 아니
- 또 이거야?
- 재미없어
- 패스
- 질문 그만해
- 왜 자꾸 물어봐?

단 한 번의 짧은 답변으로 즉시 boredom 확정하지 않는다.

최근 여러 턴의 패턴을 같이 본다.

Boredom 상승 시:

```text
질문 빈도 감소
→ 같은 semantic_group 중단
→ 더 가벼운 주제로 전환
→ 장난 / 상상 / 취향 / 게임형 대화 활용
→ 아이에게 주제 선택권 제공
→ JUST_LISTEN 가능
```

자유대화에서는 원래 주제로 돌아갈 의무가 없다.

---

# 17. 아이가 많이 말했을 때 처리

아이의 한 발화에 이미 충분한 정보가 있으면 질문을 위한 질문을 하지 않는다.

예:

아이:
> 오늘 민서랑 피구했는데 민서가 마지막에 공 잡아서 우리 반이 이겼거든. 근데 끝나고 지우가 자기도 잡을 수 있었다고 계속 뭐라 해서 좀 짜증났어.

나쁜 반응:
> 오늘 누구랑 놀았어?

좋은 방향:
> 이겼을 땐 좋았는데 지우 때문에 기분 확 깼겠네.

필요하면:
> 민서는 뭐래?

현재 아이 발화에서 이미 나온 정보를 다시 묻지 않는다.

---

# 18. 일반 질문 처리

자유대화 v2는 검색형 AI가 아니다.

하지만 초등학생 동갑 친구 수준의 일반적인 답변은 가능하다.

원칙:
- Google Search 사용 안 함
- 인터넷 검색 사용 안 함
- 일반 상식은 모델 내부 지식을 활용 가능
- Grade Persona 수준으로 짧게
- 백과사전식 설명 금지
- 아이가 더 궁금해할 때만 한 단계 더 설명
- 불확실하면 자연스럽게 모른다고 표현
- 거짓 기억이나 가짜 사실 생성 금지

---

# 19. 케이의 자기 의견

케이는 공감만 하는 리스너가 아니다.

다음이 가능해야 한다.

- 자기 취향
- 자기 선택
- 자기 상상
- 자기 느낌
- 장난
- 가벼운 의견

이 답변들은 고정 템플릿이 아니라 K Core Persona의 일관된 성향을 바탕으로 자연 생성한다.

---

# 20. 최근 대화 반복 방지

최근 질문/주제를 Semantic Topic History로 추적한다.

케이가 먼저 시작하는 유사 주제는 cooldown을 적용할 수 있다.

예:

```text
semantic_group = GAME_PREFERENCE
semantic_group = MOOD_CHECK
semantic_group = FRIEND_RELATIONSHIP
semantic_group = SCHOOL_EVENT
semantic_group = WEEKEND_PLAN
```

cooldown은 semantic group마다 다를 수 있다.

단:
- 아이가 먼저 꺼낸 주제는 cooldown으로 막지 않음
- 현재 이야기 흐름상 자연스러운 follow-up은 반복으로 보지 않음

---

# 21. Safety

Safety는 Persona보다 우선한다.

대상 예:
- 자해
- 학대
- 성적 위험
- 심각한 폭력
- 즉각적인 안전 위험

일반 상황에서는 친구 Persona를 유지한다.

Safety가 아닌 일반 고민에서 쉽게 교사/상담사 말투로 전환하지 않는다.

---

# 22. 세션 정책 유지

자유대화 이용 정책:

```text
하루 이용 횟수 제한 없음
하루 총 이용 시간 제한 없음
아이 발화 턴 수 제한 없음
1회 세션 최대 10분
10분 세션 정상 종료 후 1분 휴식
1분 후 재진입 가능
```

유의:
- 20턴 제한 재도입 금지
- 하루 3회 제한 재도입 금지
- 하루 30분 제한 재도입 금지
- 실제 10분 세션 정상 종료 후에만 1분 cooldown
- 첫 진입/중도 이탈에는 cooldown 부과하지 않음

---

# 23. 입력 방식 유지

자유대화는 다음 입력을 지원한다.

- 자동 음성
- 수동 음성
- 키보드 텍스트

세 입력 모두 동일한 K Conversation Engine을 사용한다.

차이는 입력 전처리뿐이다.

```text
자동/수동 음성
→ STT
→ K Conversation Engine

키보드
→ STT 생략
→ K Conversation Engine
```

응답 정책이 입력 방식에 따라 달라지면 안 된다.

---

# 24. 기존 저장 파이프라인 보존

기존 연결을 깨지 않는다.

- chat_messages
- raw_daily_conversations
- corrected_daily_conversations
- child_memory
- Collection
- Context Correction
- Memory Batch
- LLM Wiki
- daily/weekly/monthly report

필요한 경우 공통 K Engine에서 사용하는 Context 조회 Layer만 재구성한다.

DB schema 변경이 필요하면:
- 먼저 현재 스키마 감사
- 최소 변경
- migration 작성
- rollback 가능
- Dev 검증 후 Production

---

# 25. Relationship Stage는 이번 범위에서 제외

이번 v2에서 Relationship Stage는 구현하지 않는다.

순서:

```text
1. K Conversation Engine
2. Grade Persona 1~6
3. Relationship Memory
4. Mission v3 / Free Chat v2
5. 안정화
6. Relationship Stage
```

이번 작업에서는 구조 확장 가능성만 유지하고 구현하지 않는다.

---

# 26. 구현 단계

## Phase 0. 현재 구조 감사

필수 확인:
- `app/api/voice/respond/route.ts`
- `lib/freechat/geminiPolicy.ts`
- `lib/freechat/memoryRecallResponder.ts`
- `lib/relationship/relationshipContext.ts`
- `lib/persona/kPeerPersona.ts`
- `lib/llm/modelRouter.ts`
- 자유대화 page / hook / input mode
- chat_messages 저장 경로
- TTS 경로

성공 기준:
- 변경 전 AS-IS 호출 흐름 확정
- 공통화 대상/Adapter 대상 구분 완료

실패 시 다음 Phase로 넘어가지 말고 원인 분석 후 동일 단계 재검토한다.

## Phase 1. 공통 K Conversation Engine 골격 생성

구성:
- corePersona
- gradePersonas
- relationshipContext
- memoryRetrieval
- semanticTopicHistory
- boredomDetection
- actionSelector
- safety
- responseGenerator

성공 기준:
- Free Chat Adapter가 공통 Engine 호출
- 기존 기능 회귀 없음
- 중복 Persona/Memory 코드 제거 또는 deprecated 처리

## Phase 2. Grade Persona 1~6 구현

6개 독립 Persona를 실제 코드로 정의한다.

각 학년 Persona에 최소 다음 필드:

```text
grade
peerAge
vocabularyLevel
sentenceComplexity
responseLengthGuideline
reactionStyle
humorStyle
playfulTeasingLevel
curiosityStyle
followUpDepth
ownOpinionStyle
empathyDepth
friendshipLanguage
imaginationStyle
forbiddenAdultTone
goodExamples
badExamples
```

성공 기준:
- 1학년/6학년 Prompt가 학년/나이 숫자 외에도 실제 지침 내용이 다름
- 1~6학년 각각 독립 출력 확인
- child_profiles.grade에 따라 정확히 선택

## Phase 3. Memory 통합

구현:
- Same-session
- Same-day
- Recent Episode
- Long-term Memory

성공 기준:
- “아까 말했잖아” 회상
- 오전→오후 재진입 회상
- 전날 사건 회상
- 오래된 취향 회상
- 다른 아이 Memory 혼입 0건

## Phase 4. Action Selector + 자연 응답 생성

기존 공감 1줄, canned response, 질문 금지 로직을 제거한다.

Action Selector는 행동만 결정하고 Response Generator가 Gemini로 실제 문장을 생성한다.

성공 기준:
- 같은 Action에서도 표현 다양성 확인
- 고정 템플릿 반복 없음
- 반응/질문/장난/자기의견 등 다양하게 나타남

## Phase 5. Semantic Topic History + Boredom

구현:
- semantic_group
- last_used_at
- frequency
- cooldown
- child_initiated
- k_initiated

성공 기준:
- K가 유사 질문 반복을 줄임
- 아이가 먼저 꺼낸 주제는 차단하지 않음
- boredom 상승 시 대화 전략 변경

## Phase 6. 기존 Guard 제거 및 자유대화 Adapter 정리

제거:
- 질문 금지
- `?` 제거
- 30자 hard limit
- 15자 hard limit
- direct_question canned response
- 반복 reflective fallback

유지:
- Safety
- 짧고 자연스러운 응답 방향
- 과도한 장문 억제

## Phase 7. Dev 통합 검증

Dev에서 최소 다음 대표 시나리오를 테스트한다.

1. 일상: `오늘 학교에서 축구했어.`
2. 감정: `나 오늘 진짜 속상했어.`
3. Memory: `내가 포켓몬 좋아한다고 했던 거 기억해?`
4. Same-session: `아까 내가 누구랑 싸웠다고 했지?`
5. Same-day: 오전 시험 이야기 → 오후 재진입 회상
6. 일반 지식: `공룡은 왜 멸종했어?`
7. 장난: `케이 너 방귀 뀌어?`
8. 자기 의견: `너는 로블록스랑 마크 중 뭐가 더 좋아?`
9. Topic Shift: 친구 이야기 → `아 됐고 로블록스 얘기하자.`
10. Boredom: `몰라 / 없어 / 그냥 / 또 물어봐?`

각 시나리오에서 현재 발화 반응, Memory, Grade Persona, Action, Topic Shift, 반복 방지, 대화 자연스러움을 검증한다.

---

# 27. Grade Persona 검증

각 학년 동일 입력 세트를 테스트한다.

입력 예:
- 오늘 친구랑 싸웠어.
- 나 100점 맞았어.
- 너 방귀 뀌어?
- 공룡은 왜 멸종했어?
- 투명인간 되면 뭐 할 거야?

검증:
- 1학년과 6학년 언어 수준이 실제로 다름
- 2/3/4/5학년도 단계 차이 존재
- 단순 숫자 치환 아님
- 성인 말투 없음
- 각 학년별 과도한 유아화/과도한 성숙화 없음

---

# 28. 반복성 검증

다음 표현은 동일 semantic group로 처리되는지 확인한다.

```text
오늘 기분 어때?
마음 날씨는?
오늘 몇 점이야?
기분을 색으로 표현하면?
```

또한:
- k_initiated 반복은 cooldown 적용
- child_initiated는 허용

을 검증한다.

---

# 29. 품질 검증 기준

단순 API PASS만으로 완료하지 않는다.

대화 품질 QA를 별도로 수행한다.

최소 1~6학년 × 대표 시나리오 10개 이상.

확인 항목:
- 친구 같은가
- 현재 말을 제대로 받는가
- 질문을 위한 질문을 하지 않는가
- 과거 기억을 과도하게 꺼내지 않는가
- 기억이 자연스럽게 연결되는가
- 같은 표현 반복이 줄었는가
- 자기 의견이 있는가
- 장난/상상/공감이 다양하게 나타나는가
- 학년별 차이가 느껴지는가
- 긴 설명/훈계가 없는가

---

# 30. 회귀 검증

반드시 확인:
- 자동 음성
- 수동 음성
- 키보드 입력
- STT
- TTS
- 10분 세션
- 1분 휴식
- 하루 횟수 제한 없음
- 하루 총시간 제한 없음
- 턴 제한 없음
- chat_messages 저장
- turn_id
- display_sequence
- Collection
- Context Correction
- Memory Batch
- LLM Wiki
- Daily Report
- Weekly Report
- Parent dashboard
- Mission 기존 기능 영향

미션 v3가 아직 구현 전이면 공통 Engine 변경으로 기존 미션 기능이 깨지지 않는지만 확인한다.

---

# 31. Dev → Production 배포 원칙

순서:

1. 코드 감사
2. 공통 Engine 생성
3. Grade Persona 1~6
4. Memory 통합
5. Action/Response
6. Semantic Topic/Boredom
7. Guard 제거
8. Dev QA
9. 회귀 QA
10. Production 배포
11. Production 스모크 테스트

Dev 검증 전 Production 배포 금지.

실제 고객 데이터 수정 금지.

테스트는 승인된 테스트 계정 사용.

---

# 32. 완료 기준

다음 모두 충족해야 PASS다.

## Architecture
- 공통 K Conversation Engine 단일 Source of Truth
- Free Chat Adapter에 Persona/Memory/Action 복제 없음
- Mission 전용 Goal 로직이 공통 Engine에 들어가지 않음

## Persona
- Grade Persona 1~6 각각 독립 정의
- 런타임에서 child grade에 맞게 선택
- 1학년/6학년 실제 Prompt 차이 존재

## Conversation
- 질문 금지 제거
- 30/15자 hard limit 제거
- direct_question canned response 제거
- 자연스러운 follow-up 가능
- 질문 강제 없음
- 자기 의견 가능
- 장난/상상/공감 다양화

## Memory
- Same-session 회상 정상
- Same-day 회상 정상
- Recent Episode 회상 정상
- Long-term Memory 회상 정상
- Silent Memory 원칙 준수
- 타 아이 Memory 혼입 0건

## Repetition
- Semantic Topic History 작동
- k_initiated / child_initiated 구분
- 유사 질문 반복 감소
- Boredom 대응 정상

## Free Chat Policy
- Goal 없음
- Completion 없음
- 정보 수집 의무 없음
- Topic Shift 자유
- 10분 세션 + 1분 휴식
- 하루 횟수/총시간/턴 제한 없음

## Quality
- 1~6학년별 대화 QA PASS
- BLOCKED 0
- HIGH 0
- MEDIUM 0

---

# 33. 결과 보고 형식

## 1. AS-IS
- 기존 자유대화 구조:
- 제거한 Guard:
- 기존 Persona 문제:
- 기존 Memory 문제:

## 2. 공통 K Conversation Engine
- 파일 구조:
- 각 모듈 책임:
- Free Chat Adapter:
- Mission Adapter 영향:

## 3. Grade Persona 1~6
- 1학년:
- 2학년:
- 3학년:
- 4학년:
- 5학년:
- 6학년:
- 실제 Prompt 차이 증거:

## 4. Memory
- Same-session:
- Same-day:
- Recent Episode:
- Long-term:
- Silent Memory:

## 5. Conversation Action
- 구현 Action 목록:
- Action 선택 방식:
- 고정 템플릿 미사용 증거:
- Response Generator:

## 6. Semantic Topic / Boredom
- semantic_group:
- child_initiated:
- k_initiated:
- cooldown:
- boredom 판단:

## 7. 자유대화 정책
- Goal 없음 확인:
- Completion 없음 확인:
- Topic Shift:
- 일반 질문 처리:
- K 자기 의견:

## 8. QA
- 1학년:
- 2학년:
- 3학년:
- 4학년:
- 5학년:
- 6학년:
- 대표 시나리오:
- 반복성:
- Memory:
- 회귀:

## 9. 배포
- Dev commit:
- Dev deployment:
- Production commit:
- Production deployment:

## 10. Issues
- BLOCKED:
- HIGH:
- MEDIUM:
- LOW:

## 11. 최종 판정
- PASS / FAIL

---

# 34. 절대 금지

- 자유대화에 Mission Goal 도입 금지
- parent_questions 자유대화 삽입 금지
- 정보 수집 목적의 질문 유도 금지
- 학년 숫자만 치환하고 Grade Persona 완료 판정 금지
- Conversation Action을 고정 문구 템플릿으로 구현 금지
- Memory 검색 결과를 무조건 발화 금지
- 현재 발화보다 과거 Memory를 우선하여 단정 금지
- 질문을 매 턴 강제 금지
- 질문을 전면 금지 금지
- 30자/15자 hard truncate 재도입 금지
- 20턴 제한 재도입 금지
- 하루 3회/30분 제한 재도입 금지
- Google Search / 인터넷 검색 연결 금지
- 미션/자유대화별 Persona·Memory·Action 코드 복제 금지
- Relationship Stage 이번 범위 구현 금지

---

# 35. 최종 기준 문장

> 자유대화 v2는 미션 v3와 동일한 K Conversation Engine을 사용하되 Mission Goal Layer가 전혀 없는 Child-directed Conversation Mode다. 케이는 1~6학년별 독립 Grade Persona, 현재 세션과 당일·최근·장기 Memory, Semantic Topic History, Boredom Signal을 활용하여 아이의 현재 발화를 가장 우선으로 이해하고, 상황에 맞는 Conversation Action을 선택한 뒤 Gemini가 동갑내기 친구처럼 자연스러운 실제 문장을 생성한다. Memory는 Silent Memory가 기본이며, 아이가 화제를 바꾸면 그대로 따라가고, 질문·장난·자기의견·상상·공감·그냥 듣기 등을 상황에 맞게 다양하게 사용하여 관계 형성을 최우선으로 한다.
